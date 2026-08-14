import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { CONFIG_DIR, CONFIG_FILE } from '../src/core/layout.js';
import type { RunRecord } from '../src/core/runs.js';
import { writeRun } from '../src/store/run-store.js';
import { openTestProject, tempDir } from './helpers.js';

// The README's admitted gap, closed through an endpoint rather than in the browser: ONE statement of
// the arithmetic, read by the UI and by the auto-pilot service that enforces the budget. Two copies of
// "what has this cost" would eventually disagree, and the one enforcing the cap must be right.

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: '20260803-100000-aaaa',
  card: 'E-001',
  board: 'engineering',
  skill: 'implement',
  status: 'success',
  started: '2026-08-03T10:00:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

async function accounting(app: Awaited<ReturnType<typeof openTestProject>>['app']) {
  const res = await app.inject({ method: 'GET', url: '/api/accounting' });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('the project ledger', () => {
  it('reports no cost at all for a project that has never run anything', async () => {
    const { app } = await openTestProject();
    const body = await accounting(app);
    expect(body.project).toEqual({ runs: 0, withCost: 0, withoutCost: 0 });
    expect(body.cards).toEqual([]);
  });

  it('sums card runs and project runs together', async () => {
    const { app, root } = await openTestProject();
    await writeRun(root, run({ usage: { costUsd: 1 } }));
    // A checkup: about the project, so it counts against the budget but belongs to no card.
    await writeRun(
      root,
      run({
        run: '20260803-110000-bbbb',
        card: undefined,
        board: undefined,
        skill: 'checkup',
        usage: { costUsd: 4 },
      }),
    );
    const body = await accounting(app);
    // Everything a model does counts against every cap — checkup runs included.
    expect(body.project.costUsd).toBe(5);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({ board: 'engineering', card: 'E-001' });
    expect(body.cards[0].spend.costUsd).toBe(1);
  });

  it('counts attempts per skill, not per card', async () => {
    const { app, root } = await openTestProject();
    await writeRun(root, run({ run: '20260803-100000-a1', skill: 'implement', status: 'failed' }));
    await writeRun(root, run({ run: '20260803-100000-a2', skill: 'implement', status: 'attention' }));
    await writeRun(root, run({ run: '20260803-100000-a3', skill: 'implement', status: 'cancelled' }));
    await writeRun(root, run({ run: '20260803-100000-a4', skill: 'review', status: 'failed' }));
    const body = await accounting(app);
    // The cancelled run burns nothing — you stopped it — and the JUDGING run has its own tally. That
    // separation is what the review and fix caps are counted on; the skill answering it used to be the
    // critic and is now `review`.
    expect(body.cards[0].attempts).toEqual({ implement: 2, review: 1 });
    expect(body.attemptCap).toBe(3);
  });

  it('names the cap that is actually bounding the project', async () => {
    const { app, root } = await openTestProject();
    await writeRun(root, run({ usage: { costUsd: 1 } }));
    expect((await accounting(app)).cap.cap).toBe('budget');
  });

  // A pre-slice-A project: no `autopilot` block, so auto-pilot cannot start at all. It used to be told
  // "Auto-pilot will stop when this project's runs have cost $20" — a budget nobody set, taken from
  // DEFAULT_AUTOPILOT and rendered in the indicative about this project.
  it('names no cap for a project that has no auto-pilot', async () => {
    const { app, root } = await openTestProject();
    const config = join(root, CONFIG_DIR, CONFIG_FILE);
    const yaml = await readFile(config, 'utf8');
    // Removes the block and everything indented under it, leaving the rest of the config intact.
    const stripped = yaml.replace(/^autopilot:\n(?: +.*\n|\n)*/m, '');
    expect(stripped).not.toContain('autopilot:');
    await writeFile(config, stripped, 'utf8');
    await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });

    const body = await accounting(app);
    expect('cap' in body).toBe(false);
    // The attempt cap still comes from the default, because the card pane always shows one.
    expect(body.attemptCap).toBe(3);
  });

  // S10: for a subscription-backed or local model the figure is zero or not what you are billed, so a
  // dollar dial would never trip and the tab must say which cap really applies.
  it('says iterations when nothing has reported a cost', async () => {
    const { app, root } = await openTestProject();
    await writeRun(root, run());
    const body = await accounting(app);
    expect(body.cap.cap).toBe('iterations');
    expect(body.project.withoutCost).toBe(1);
    expect('costUsd' in body.project).toBe(false);
  });
});

describe('who may read the ledger', () => {
  // A real app with no auth-injecting wrapper: each request presents exactly the credential it is
  // given. The scope table is the rule, and this is the boundary that applies it.
  async function openBare() {
    const { buildApp } = await import('../src/server/app.js');
    const { CredentialStore } = await import('../src/server/auth/credentials.js');
    const { ProjectSession } = await import('../src/server/boards/session.js');
    const session = new ProjectSession();
    const store = new CredentialStore('admin-token');
    const app = buildApp(session, { credentials: store, logger: false });
    const root = await tempDir();
    onTestFinished(async () => {
      await app.close();
      await session.close();
    });
    await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      headers: { authorization: 'Bearer admin-token' },
      payload: { path: root, name: 'A', mode: 'greenfield' },
    });
    return { app, store, root };
  }

  // The service enforces the budget between dispatches and is a separate process reaching the board
  // over HTTP, so it needs the numbers.
  it('is open to the auto-pilot service', async () => {
    const { app, store, root } = await openBare();
    const cred = store.mintRun('service', 'r1', root);
    const res = await app.inject({
      method: 'GET',
      url: '/api/accounting',
      headers: { authorization: `Bearer ${cred.token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // An agent that can see how much room is left in the budget is an agent reasoning about its own
  // leash, which is not its business.
  it('is closed to a work agent and to the checkup', async () => {
    const { app, store, root } = await openBare();
    for (const scope of ['work', 'checkup'] as const) {
      const cred = store.mintRun(scope, `r-${scope}`, root, 'E-001');
      const res = await app.inject({
        method: 'GET',
        url: '/api/accounting',
        headers: { authorization: `Bearer ${cred.token}` },
      });
      expect(res.statusCode, scope).toBe(403);
    }
  });
});
