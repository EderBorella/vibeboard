import { chmodSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../src/core/runs.js';
import { buildApp } from '../src/server/app.js';
import { readRun, writeRun } from '../src/server/run-store.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject, shimArgsLog, type TestProject, wsClient } from './helpers.js';

const SHIM = join(process.cwd(), 'test', 'fixtures', 'fake-agent.mjs');
// Stryker runs the suite from a sandbox COPY of the repo, and the copy does not carry the executable
// bit — so the shim could not be spawned there and every run was recorded as failed, which failed
// the dry run before any mutant existed. Restoring it here costs nothing and works either way.
chmodSync(SHIM, 0o755);

// The shim is passed to the app rather than set in the environment, and its behaviour travels in the
// dispatch prompt: env is shared with every other test file in the process, and a sibling rewriting
// it mid-run is what made Stryker's dry run fail where `npm test` passed.
const hang = '[[behaviour:hang]]';

// A scaffolded project has sample cards and the seeded skills, which is exactly what a dispatch
// needs. Returns the engineering sample card's id.
async function projectWithCard(): Promise<TestProject & { card: string }> {
  const project = await openTestProject({ runBin: SHIM });
  const state = (await project.app.inject({ method: 'GET', url: '/api/state' })).json() as {
    snapshot: { boards: { engineering: { id: string }[] } };
  };
  return { ...project, card: state.snapshot.boards.engineering[0].id };
}

async function settled(project: TestProject, card: string, run: string): Promise<RunRecord> {
  // 30s: these spawn a real child, and the suite is run with heavy concurrency by Stryker.
  for (let i = 0; i < 300; i++) {
    const record = await readRun(project.root, 'engineering', card, run);
    if (record && record.status !== 'running' && record.status !== 'queued') return record;
    await new Promise((r) => setTimeout(r, 100));
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
    // The MESSAGE as well as the code: it is what the dispatch pane shows the user, so "something
    // was refused" and "that skill no longer exists" are not interchangeable.
    const project = await projectWithCard();
    const post = (payload: object) => project.app.inject({ method: 'POST', url: '/api/runs', payload });

    const badBoard = await post({ board: 'nope', card: project.card, skill: 'execute' });
    expect([badBoard.statusCode, badBoard.json()]).toEqual([400, { error: 'Unknown board' }]);

    const badCard = await post({ board: 'engineering', card: 'E-999', skill: 'execute' });
    expect([badCard.statusCode, badCard.json()]).toEqual([404, { error: 'No such card' }]);

    const badSkill = await post({ board: 'engineering', card: project.card, skill: 'no-such-skill' });
    expect([badSkill.statusCode, badSkill.json()]).toEqual([404, { error: 'No such skill' }]);
  });

  it('refuses a board that is not even a string', async () => {
    // The body is JSON from a client, not a typed call: `isBoard` has to reject the wrong TYPE, not
    // just an unknown name, or a number reaches findCard as a folder.
    const project = await projectWithCard();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { board: 7, card: project.card, skill: 'execute' },
    });
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'Unknown board' }]);
  });

  it('defaults mode and attaches nothing when the request says neither', async () => {
    // Both defaults are load-bearing: an agent with no mode must still be allowed to work, and an
    // empty attachment list must stay empty rather than becoming a path the agent tries to read.
    const project = await projectWithCard();
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute' },
      })
    ).json() as { run: RunRecord };
    expect(run.mode).toBe('bypassPermissions');
    expect(run.attached).toBeUndefined();
    await settled(project, project.card, run.run);
  });

  it('resolves links against the live board, dropping ids that no longer exist', async () => {
    // The client's view of a card's links can be stale, and a card can be deleted between renders.
    // A dangling id must not reach the prompt — the agent would go looking for a card that is gone.
    const argsLog = shimArgsLog();
    process.env.VIBEBOARD_SHIM_ARGS = argsLog;
    await writeFile(argsLog, '', 'utf8');
    const project = await projectWithCard();

    const raw = (
      await project.app.inject({ method: 'GET', url: `/api/cards/engineering/${project.card}/raw` })
    ).json() as { raw: string };
    // Straight into the file: the links API refuses an id that does not exist, which is exactly the
    // state we need to arrive at some other way.
    await project.app.inject({
      method: 'PUT',
      url: `/api/cards/engineering/${project.card}/raw`,
      payload: { raw: raw.raw.replace('links:', 'links:\n  - E-404-gone') },
    });

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
    // The id itself still appears — it is in the card's own frontmatter, which is quoted verbatim.
    // What must not appear is a SECTION for it: that is the part built from resolved cards, and an
    // unresolved one would render as a heading with nothing, or as `undefined`.
    const sections = [...prompt.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(sections).toEqual(['P-001 — Sample product card']);
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

  it('queues a second dispatch rather than refusing it', async () => {
    // The default cap is 3, so this needs the project's own cap lowered to one.
    const project = await projectWithCard();
    await project.app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { maxConcurrentRuns: 1 },
    });
    const post = () =>
      project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute', prompt: hang },
      });

    const first = (await post()).json() as { run: RunRecord };
    const second = await post();
    expect(second.statusCode).toBe(200);
    expect((second.json() as { run: RunRecord }).run.status).toBe('queued');

    const listed = (await project.app.inject({ method: 'GET', url: '/api/runs' })).json() as {
      active: string[];
      queued: string[];
    };
    expect(listed.active).toEqual([first.run.run]);
    expect(listed.queued).toEqual([(second.json() as { run: RunRecord }).run.run]);

    for (const id of [...listed.active, ...listed.queued]) {
      await project.app.inject({ method: 'POST', url: `/api/runs/${id}/cancel` });
    }
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
    const project = await projectWithCard();
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute', prompt: hang },
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
    const project = await projectWithCard();
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute', prompt: hang },
      })
    ).json() as { run: RunRecord };

    const res = await project.app.inject({ method: 'POST', url: `/api/runs/${run.run}/cancel` });
    expect(res.statusCode).toBe(200);
    expect((await settled(project, project.card, run.run)).status).toBe('cancelled');
  });

  it('says so for a run that is not in flight', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({ method: 'POST', url: '/api/runs/nope/cancel' });
    expect([res.statusCode, res.json()]).toEqual([404, { error: 'That run is not in flight' }]);
  });

  it('confirms a stop with the time it happened', async () => {
    // `ok: true` and a real timestamp: the dashboard uses the acknowledgement to stop offering Stop,
    // and a `false` or missing flag would leave the button live on a run already dying.
    const project = await projectWithCard();
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute', prompt: hang },
      })
    ).json() as { run: RunRecord };
    const body = (
      await project.app.inject({ method: 'POST', url: `/api/runs/${run.run}/cancel` })
    ).json() as { ok: boolean; at: string };
    expect(body.ok).toBe(true);
    expect(Number.isNaN(Date.parse(body.at))).toBe(false);
    await settled(project, project.card, run.run);
  });
});

describe('GET /api/runs/:board/:card', () => {
  it('refuses a board that is not one, rather than reading a folder by that name', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({ method: 'GET', url: '/api/runs/nonsense/E-001' });
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'Unknown board' }]);
  });

  it('is empty for a card that has never been run', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({ method: 'GET', url: '/api/runs/features/F-001' });
    expect([res.statusCode, res.json()]).toEqual([200, { runs: [] }]);
  });
});

describe('every run route refuses when no project is open', () => {
  // One test per route rather than one for the group: each handler carries its own guard, and a
  // missing one answers 500 from a null root instead of saying what is wrong.
  it.each([
    ['GET', '/api/runs'],
    ['GET', '/api/runs/engineering/E-001'],
    ['POST', '/api/runs'],
    ['POST', '/api/runs/engineering/E-001/r1/resolve'],
    ['POST', '/api/runs/r1/cancel'],
  ])('%s %s', async (method, url) => {
    const app = buildApp(new ProjectSession());
    const res = await app.inject({ method: method as 'GET' | 'POST', url, payload: {} });
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'No project open' }]);
    await app.close();
  });
});

describe('POST /api/runs/:board/:card/:run/resolve', () => {
  // A run that ended needing a decision asked for ever before this: status is written once, so
  // nothing could ever say "answered". This is the write that says it.
  const asking = (card: string): RunRecord => ({
    run: 'r-asking',
    card,
    board: 'engineering',
    skill: 'execute',
    status: 'attention',
    started: '2026-07-26T21:00:00.000Z',
    backend: 'opencode',
    model: 'nemotron',
    effort: 'max',
    mode: 'build',
    report: 'three cards, not one',
  });

  it('stamps the run and answers with the record as it now reads', async () => {
    const project = await projectWithCard();
    await writeRun(project.root, asking(project.card));
    const res = await project.app.inject({
      method: 'POST',
      url: `/api/runs/engineering/${project.card}/r-asking/resolve`,
    });
    expect(res.statusCode).toBe(200);
    const { run } = res.json() as { run: RunRecord };
    expect(run.resolved).toBeTruthy();
    // The status is untouched: how it ended is not what the user decided about it.
    expect(run.status).toBe('attention');
    expect((await readRun(project.root, 'engineering', project.card, 'r-asking'))?.resolved).toBeTruthy();
  });

  it('is idempotent — two clicks are one decision', async () => {
    const project = await projectWithCard();
    await writeRun(project.root, asking(project.card));
    const url = `/api/runs/engineering/${project.card}/r-asking/resolve`;
    const first = (await project.app.inject({ method: 'POST', url })).json() as { run: RunRecord };
    const second = (await project.app.inject({ method: 'POST', url })).json() as { run: RunRecord };
    expect(second.run.resolved).toBe(first.run.resolved);
  });

  it('404s for a run that does not exist', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({
      method: 'POST',
      url: `/api/runs/engineering/${project.card}/nope/resolve`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No such run' });
  });

  it('400s for a board that is not one', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({
      method: 'POST',
      url: `/api/runs/nonsense/${project.card}/r-asking/resolve`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Unknown board' });
  });

  it('refuses with 409 when no project is open', async () => {
    const app = buildApp(new ProjectSession());
    const res = await app.inject({ method: 'POST', url: '/api/runs/engineering/E-001/r/resolve' });
    expect(res.statusCode).toBe(409);
    await app.close();
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
