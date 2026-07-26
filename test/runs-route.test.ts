import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '../src/core/runs.js';
import { buildApp } from '../src/server/app.js';
import { readRun, writeRun } from '../src/server/run-store.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject, shimArgsLog, type TestProject, wsClient } from './helpers.js';

const SHIM = join(process.cwd(), 'test', 'fixtures', 'fake-agent.mjs');

beforeEach(() => {
  process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
  process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'success';
});
afterEach(() => {
  delete process.env.VIBEBOARD_CLAUDE_BIN;
  delete process.env.VIBEBOARD_SHIM_BEHAVIOUR;
});

// A scaffolded project has sample cards and the seeded skills, which is exactly what a dispatch
// needs. Returns the engineering sample card's id.
async function projectWithCard(): Promise<TestProject & { card: string }> {
  const project = await openTestProject();
  const state = (await project.app.inject({ method: 'GET', url: '/api/state' })).json() as {
    snapshot: { boards: { engineering: { id: string }[] } };
  };
  return { ...project, card: state.snapshot.boards.engineering[0].id };
}

async function settled(project: TestProject, card: string, run: string): Promise<RunRecord> {
  for (let i = 0; i < 100; i++) {
    const record = await readRun(project.root, 'engineering', card, run);
    if (record && record.status !== 'running' && record.status !== 'queued') return record;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run never settled');
}

describe('POST /api/runs', () => {
  it('dispatches a skill against a card and answers with the record', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { board: 'engineering', card: project.card, skill: 'execute', prompt: 'go on then' },
    });
    expect(res.statusCode).toBe(200);
    const { run } = res.json() as { run: RunRecord };
    expect(run.status).toBe('running');
    expect(run.skill).toBe('execute');
    expect(run.card).toBe(project.card);
    expect(run.prompt).toBe('go on then');
    // Backend/model/effort come from the project's saved selection when the request names none.
    expect(run.backend).toBe('claude-code');
    expect(run.model).toBe('opus');

    const final = await settled(project, project.card, run.run);
    expect(final.status).toBe('success');
  });

  it('falls back to the project SAVED selection, not the built-in default', async () => {
    // Asserting 'opus' proves nothing on its own: that is also the built-in default, so the same
    // assertion passes with the config ignored entirely. Changing the saved slot first is what
    // distinguishes "read the project's choice" from "fell back to the built-in".
    const project = await projectWithCard();
    await project.app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { copilot: { backends: { 'claude-code': { model: 'haiku', effort: 'low' } } } },
    });
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute' },
      })
    ).json() as { run: RunRecord };
    expect([run.model, run.effort]).toEqual(['haiku', 'low']);
    await settled(project, project.card, run.run);
  });

  it('honours an explicit model, effort and mode', async () => {
    const project = await projectWithCard();
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          board: 'engineering',
          card: project.card,
          skill: 'execute',
          model: 'sonnet',
          effort: 'low',
          mode: 'plan',
        },
      })
    ).json() as { run: RunRecord };
    expect([run.model, run.effort, run.mode]).toEqual(['sonnet', 'low', 'plan']);
    await settled(project, project.card, run.run);
  });

  it('passes the card and its linked cards into the prompt', async () => {
    // The sample project links product to feature and engineering, so a dispatch on the engineering
    // card must see P-001 quoted — that is the intent it would otherwise have to guess.
    // Per-process path from the helper, never a fixed one in the repo: two test files sharing one
    // log is what made Stryker's verdicts non-deterministic before.
    const argsLog = shimArgsLog();
    process.env.VIBEBOARD_SHIM_ARGS = argsLog;
    await writeFile(argsLog, '', 'utf8');
    const project = await projectWithCard();
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute' },
      })
    ).json() as { run: RunRecord };
    await settled(project, project.card, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const prompt = JSON.parse((await readFile(argsLog, 'utf8')).trim().split('\n').at(-1) as string).at(
      -1,
    ) as string;
    expect(prompt).toContain('# Execute');
    expect(prompt).toContain(`## The card: ${project.card}`);
    expect(prompt).toContain('## Linked cards');
    expect(prompt).toContain('### P-001');
    expect(prompt).toContain(`.vibeboard/runs/${run.run}.report.md`);
  });

  it('refuses an unknown skill, card or board rather than dispatching something wrong', async () => {
    const project = await projectWithCard();
    const post = (payload: object) => project.app.inject({ method: 'POST', url: '/api/runs', payload });

    expect((await post({ board: 'nope', card: project.card, skill: 'execute' })).statusCode).toBe(400);
    expect((await post({ board: 'engineering', card: 'E-999', skill: 'execute' })).statusCode).toBe(404);
    expect(
      (await post({ board: 'engineering', card: project.card, skill: 'no-such-skill' })).statusCode,
    ).toBe(404);
  });

  it('refuses to run against an archived card', async () => {
    // An archived card is not on the board, so nothing could show what the run did to it.
    const project = await projectWithCard();
    await project.app.inject({
      method: 'POST',
      url: `/api/cards/engineering/${project.card}/archive`,
    });
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { board: 'engineering', card: project.card, skill: 'execute' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'That card is archived' });
  });

  it('refuses a second dispatch while one is in flight, and says why', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'hang';
    const project = await projectWithCard();
    const first = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute' },
      })
    ).json() as { run: RunRecord };

    const second = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { board: 'engineering', card: project.card, skill: 'execute' },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: string }).error).toBe('A run is already in flight');

    await project.app.inject({ method: 'POST', url: `/api/runs/${first.run.run}/cancel` });
    await settled(project, project.card, first.run.run);
  });

  it('refuses with 409 when no project is open', async () => {
    const app = buildApp(new ProjectSession());
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No project open' });
    await app.close();
  });
});

describe('GET /api/runs', () => {
  it('lists every run newest first, with the ids currently in flight', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'hang';
    const project = await projectWithCard();
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute' },
      })
    ).json() as { run: RunRecord };

    const body = (await project.app.inject({ method: 'GET', url: '/api/runs' })).json() as {
      runs: RunRecord[];
      active: string[];
    };
    expect(body.runs.map((r) => r.run)).toEqual([run.run]);
    expect(body.active).toEqual([run.run]);

    await project.app.inject({ method: 'POST', url: `/api/runs/${run.run}/cancel` });
    await settled(project, project.card, run.run);
  });

  it('lists one card history oldest first', async () => {
    const project = await projectWithCard();
    const base: RunRecord = {
      run: '',
      card: project.card,
      board: 'engineering',
      skill: 'execute',
      status: 'success',
      started: 'T',
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
      mode: 'bypassPermissions',
      report: '',
    };
    await writeRun(project.root, { ...base, run: '20260726-150000-b' });
    await writeRun(project.root, { ...base, run: '20260726-090000-a' });

    const body = (
      await project.app.inject({ method: 'GET', url: `/api/runs/engineering/${project.card}` })
    ).json() as { runs: RunRecord[] };
    expect(body.runs.map((r) => r.run)).toEqual(['20260726-090000-a', '20260726-150000-b']);
  });

  it('rejects an unknown board in a card history', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({ method: 'GET', url: '/api/runs/nope/E-001' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/runs/:run/cancel', () => {
  it('stops a run in flight and records it as cancelled', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'hang';
    const project = await projectWithCard();
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute' },
      })
    ).json() as { run: RunRecord };

    const res = await project.app.inject({ method: 'POST', url: `/api/runs/${run.run}/cancel` });
    expect(res.statusCode).toBe(200);
    expect((await settled(project, project.card, run.run)).status).toBe('cancelled');
  });

  it('says so for a run that is not in flight', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({ method: 'POST', url: '/api/runs/nope/cancel' });
    expect(res.statusCode).toBe(404);
  });
});

describe('run updates over the socket', () => {
  it('pushes every status change, so the UI needs no polling', async () => {
    const project = await projectWithCard();
    const address = await project.app.listen({ port: 0 });
    const client = wsClient<{ type: string; record?: RunRecord }>(address);
    await client.open;

    await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { board: 'engineering', card: project.card, skill: 'execute' },
    });
    await client.waitFor((m) => m.type === 'run:update' && m.record?.status === 'running');
    const done = await client.waitFor((m) => m.type === 'run:update' && m.record?.status === 'success');
    expect(done.record?.summary).toBe('did the thing');
    client.close();
  });
});

describe('runs interrupted by a restart', () => {
  it('are marked interrupted when the project is opened again', async () => {
    // The child died with the server that spawned it, so a record still claiming to run is stale.
    const project = await openTestProject();
    await writeRun(project.root, {
      run: '20260726-080000-zz',
      card: 'E-001',
      board: 'engineering',
      skill: 'execute',
      status: 'running',
      started: '2026-07-26T08:00:00.000Z',
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
      mode: 'bypassPermissions',
      report: '',
    });

    const session = new ProjectSession();
    await session.open(project.root);
    await session.close();

    const record = await readRun(project.root, 'engineering', 'E-001', '20260726-080000-zz');
    expect(record?.status).toBe('interrupted');
    expect(record?.note).toBe('VibeBoard restarted while this run was in flight');
  });

  it('leaves a project with no runs alone', async () => {
    const project = await openTestProject();
    await mkdir(join(project.root, 'engineering', 'results'), { recursive: true });
    const session = new ProjectSession();
    await expect(session.open(project.root)).resolves.toBeTruthy();
    await session.close();
  });
});
