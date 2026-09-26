import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { boardRel, FOUNDATION_DIR, RESULTS_DIR, RUNS_DIR } from '../src/core/layout.js';
import type { RunRecord } from '../src/core/runs.js';
import { endpointsFor } from '../src/server/auth/auth.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { forgiveRefusal } from '../src/server/runs/routes.js';
import { writeAutopilotState } from '../src/store/autopilot-store.js';
import { readProjectRun, readRun, writeRun } from '../src/store/run-store.js';
import { openTestProject, shimArgsLog, type TestProject, testApp, wsClient } from './helpers.js';

// The executable bit a sandbox copy does not carry is restored for every stub at once in
// test/global-teardown.ts — it used to be restored for this one file here, which is why the other six
// stubs stayed unspawnable.
const SHIM = join(process.cwd(), 'test', 'fixtures', 'fake-agent.mjs');

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

// The sample project's product card, read off the board rather than assumed to be P-001: ids are assigned
// by the scaffolder and an assumed one dispatches 404 into a poll that only ends as a timeout.
async function productCard(project: TestProject): Promise<string> {
  const state = (await project.app.inject({ method: 'GET', url: '/api/state' })).json() as {
    snapshot: { boards: { product: { id: string }[] } };
  };
  return state.snapshot.boards.product[0].id;
}

// NO AGENT IS TOLD THIS ROUTE EXISTS BUT A REPAIR, checked against the pattern the app REALLY serves. Fix board's
// `repair` is the one scope that may clear attempts (decision 88), so its catalogue must name the route — an
// agent handed the authority and not told of it reads the gap as a broken tool — and every other must not.
//
// `not.toContain('/reset')` was the shape this replaced, and it goes inert the moment somebody renames
// the route: the new path cannot contain the old segment, so the assertion passes over a catalogue it is
// no longer describing. So the pattern is looked up in Fastify's own route table first — that table is
// what hands `req.routeOptions.url` to `allows`, and it is what the scope table is keyed on, so a rename
// fails here and has to be answered rather than absorbed.
//
// A CARD IS PASSED TO `endpointsFor`, and that is not decoration: with none, it SKIPS every own-card row,
// so a planted rule granting `work` confined to its own card would be invisible to this check while
// `allows` returned true for it.
async function namedOnlyForRepair(pattern: string): Promise<void> {
  const app = testApp(new ProjectSession());
  await app.ready();
  expect(app.hasRoute({ method: 'POST', url: pattern }), pattern).toBe(true);
  await app.close();
  for (const scope of ['work', 'checkup', 'service', 'assist'] as const) {
    expect(endpointsFor(scope, 'E-001').join('\n'), scope).not.toContain(pattern);
  }
  expect(endpointsFor('repair').join('\n'), 'repair').toContain(`POST ${pattern}`);
}

// The prompt the shim was spawned with: the last line of the args log, last argument of the call.
async function promptFrom(argsLog: string): Promise<string> {
  const line = (await readFile(argsLog, 'utf8')).trim().split('\n').at(-1) as string;
  // `.prompt`, not the last argv entry: the prompt reaches the agent on stdin, because it carries
  // the run's credential and a command line is world readable through /proc.
  return (JSON.parse(line) as { prompt: string }).prompt;
}

// Records what the shim is spawned with, for a test that asserts on the prompt. Per-process path from
// the helper, never a fixed one in the repo: two test files sharing one log is what made Stryker's
// verdicts non-deterministic.
async function recordingShimArgs(): Promise<string> {
  const argsLog = shimArgsLog();
  process.env.VIBEBOARD_SHIM_ARGS = argsLog;
  await writeFile(argsLog, '', 'utf8');
  return argsLog;
}

// The board is a parameter because a break-down does not run on engineering: `settled` below reads the
// engineering board, and a run on another one is never found — a 30s poll that ends as a test timeout
// naming nothing, which cost a debugging round.
async function settledOn(
  project: TestProject,
  board: 'features' | 'product' | 'engineering',
  card: string,
  run: string,
): Promise<RunRecord> {
  for (let i = 0; i < 300; i++) {
    const record = await readRun(project.root, board, card, run);
    if (record && record.status !== 'running' && record.status !== 'queued') return record;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`run never settled on ${board}/${card}`);
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

  // A REVIEW run JUDGES rather than builds, and a person can dispatch one from the card. Without this the
  // seeded skill said "give a verdict" while the prompt asked for an ordinary report — no `verdict:` field
  // and no values — so the answer would have been unreadable by the thing that acts on it.
  //
  // NO THRESHOLD, and that is the change: the verdict is `done`/`sent-back` rather than a score against a
  // bar, so there is no number for the prompt to quote.
  it('gives a review run the judging contract, and no threshold to quote', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    // A STORY, since decision 80: the judging contract is `review-story`'s, and that phase sits on product.
    const story = await productCard(project);
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'product', card: story, skill: 'review-story' },
      })
    ).json() as { run: RunRecord };
    await settledOn(project, 'product', story, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const prompt = await promptFrom(argsLog);
    expect(prompt).toContain('## Judging (required)');
    expect(prompt).toContain('verdict: done');
    expect(prompt).toContain('sent-back');
    expect(prompt).not.toMatch(/at or above 0\.6/i);
    // And NOT the board-changing contract: a judge told to PATCH its own card and, three lines later,
    // not to, has two required instructions and no reading that satisfies both.
    expect(prompt).not.toContain('## Changing the board (required)');
    expect(prompt).not.toContain('## Reporting (required)');
  });

  // EXPRESS MODE REACHES THE PROMPT, and this is the assertion that stops `autopilot.mode` becoming the
  // third key this config block has shipped that was read by nothing. `setupFeatureFlag` was typed,
  // defaulted, validated and mirrored to the UI, and renaming it lifted a barrier in silence; the header of
  // src/core/autopilot.ts names it and `autoPilotConcurrency` for the same reason.
  //
  // So it goes through the REAL route with the REAL config on disk, and reads the prompt the agent was
  // actually spawned with — not the assembler called directly, which would only prove the assembler.
  it('renders the express sizing section when the project config asks for it', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    // Through the config route, so the write is the one a person's dropdown makes.
    const saved = await project.app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { autopilot: { ...DEFAULT_AUTOPILOT, mode: 'express' } },
    });
    expect(saved.statusCode).toBe(200);
    const story = await productCard(project);
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { board: 'product', card: story, skill: 'break-down' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { run } = res.json() as { run: RunRecord };
    await settledOn(project, 'product', story, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const prompt = await promptFrom(argsLog);
    expect(prompt).toContain('## How this project sizes its cards');
    // A STORY break-down, so the size is one task — the feature's instruction here would mean the phase was
    // resolved on the skill alone, which is the bug `phaseForRun` takes a board to avoid.
    expect(prompt).toMatch(/exactly one task/i);
    expect(prompt).not.toMatch(/one story per bullet/i);
  });

  it('leaves the prompt untouched on a standard project', async () => {
    // The other half, and it is not redundant: a section rendered unconditionally would pass the test above
    // while changing every existing project's behaviour.
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    const story = await productCard(project);
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'product', card: story, skill: 'break-down' },
      })
    ).json() as { run: RunRecord };
    await settledOn(project, 'product', story, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    expect(await promptFrom(argsLog)).not.toContain('## How this project sizes its cards');
  });

  it('passes the card, its linked cards and the project columns into the prompt', async () => {
    // The sample project links product to feature and engineering, so a dispatch on the engineering
    // card must see P-001 quoted — that is the intent it would otherwise have to guess.
    const argsLog = await recordingShimArgs();
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

    const prompt = await promptFrom(argsLog);
    expect(prompt).toContain('# Execute');
    expect(prompt).toContain(`## The card: ${project.card}`);
    expect(prompt).toContain('## Linked cards');
    expect(prompt).toContain('### P-001');
    expect(prompt).toContain(`${RUNS_DIR}/${run.run}.report.md`);
    // A scaffolded project has the default columns, and all three boards are listed — the `execute`
    // skill is scoped to engineering, but where a skill RUNS is not where it may WRITE.
    expect(prompt).toContain(
      [
        '- **features**: Backlog (backlog), Todo (todo), In Progress (in-progress), Done (done)',
        '- **product**: Backlog (backlog), Todo (todo), In Progress (in-progress), Blocked (blocked), Done (done)',
        '- **engineering**: Backlog (backlog), In Progress (in-progress), Review (review), Blocked (blocked), Done (done)',
      ].join('\n'),
    );
    expect(prompt).toContain('Do NOT create a new column');
  });

  it("lists the OPEN project's columns, not the built-in defaults", async () => {
    // The assertion that would have caught the bug. Asserting the defaults proves nothing on its own:
    // the same assertion passes with the config never read. Renaming engineering's columns first is
    // what distinguishes "read this project's config" from "printed what the defaults happen to say".
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    // Renamed one-for-one, derived from what the project actually has. A literal list of names also
    // fixes a COUNT, and dropping a column that still holds a card is refused with a 409 — so a
    // change to the defaults broke this test for a reason that had nothing to do with what it tests.
    const current = (await project.app.inject({ method: 'GET', url: '/api/config' })).json() as {
      boards: { engineering: { columns: string[] } };
    };
    const renamed = current.boards.engineering.columns.map((_, i) => `Stage ${i + 1}`);
    const patched = await project.app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { boards: { engineering: { columns: renamed } } },
    });
    expect(patched.statusCode).toBe(200);

    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute' },
      })
    ).json() as { run: RunRecord };
    await settled(project, project.card, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const prompt = await promptFrom(argsLog);
    expect(prompt).toContain(
      `- **engineering**: ${renamed.map((name, i) => `${name} (stage-${i + 1})`).join(', ')}`,
    );
    // Review is engineering's alone among the defaults, so its absence — not merely the new names'
    // presence — is what rules out a hardcoded list.
    expect(prompt).not.toContain('Review (review)');
    // The boards that were not patched are still there, and still their own columns.
    expect(prompt).toContain(
      '- **product**: Backlog (backlog), Todo (todo), In Progress (in-progress), Blocked (blocked), Done (done)',
    );
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
    const argsLog = await recordingShimArgs();
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

    const prompt = await promptFrom(argsLog);
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
    const app = testApp(new ProjectSession());
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
    // The ledger line comes back even for a card with no history: the answer to "what has this cost"
    // is "nothing yet", and a missing key would make the pane guess.
    expect([res.statusCode, res.json()]).toEqual([
      200,
      {
        runs: [],
        account: { spend: { runs: 0, withCost: 0, withoutCost: 0 }, attempts: {}, attemptCap: 3 },
      },
    ]);
  });
});

// THE VERDICT ENDPOINT, which nothing exercised at all: a gate prover deleted its auth row, its validation,
// its 404 and even the write itself, and all 2,764 tests passed each time. Decision 18 says a verdict belongs
// on the record of the run it judged so "why did this card advance?" is answerable from disk — and none of
// that was held by anything.
describe('POST /api/runs/:board/:card/:run/verification', () => {
  const RUN = '20260806-100000-a';
  const verdict = { mode: 'gates', passed: true, at: '2026-08-06T10:05:00Z' };

  async function judged(): Promise<TestProject & { card: string }> {
    const project = await projectWithCard();
    await writeRun(project.root, {
      run: RUN,
      card: project.card,
      board: 'engineering',
      skill: 'implement',
      status: 'success',
      started: 'T',
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
      mode: 'bypassPermissions',
      report: '',
    });
    return project;
  }

  const url = (project: TestProject & { card: string }, run = RUN) =>
    `/api/runs/engineering/${project.card}/${run}/verification`;

  it('writes the verdict onto the run it judged, on disk', async () => {
    const project = await judged();
    const res = await project.app.inject({ method: 'POST', url: url(project), payload: verdict });
    expect(res.statusCode).toBe(200);
    // FROM DISK, not from the reply: the reply could be assembled and never written, which is exactly what a
    // plant proved — deleting the `writeRun` call changed no test.
    const stored = await readRun(project.root, 'engineering', project.card, RUN);
    expect(stored?.verification).toEqual(verdict);
  });

  it('is reachable by the service and by nobody else who runs', async () => {
    // Decision 3's whole subject: a run that could write its own verification is a run advancing itself on
    // self-assessment. Widening the row to the working scopes changed no test before this.
    const project = await judged();
    const service = project.mint('service', 'run-svc');
    const asService = await project.app.inject({
      method: 'POST',
      url: url(project),
      headers: { authorization: `Bearer ${service.token}` },
      payload: verdict,
    });
    expect(asService.statusCode).toBe(200);

    for (const scope of ['work', 'checkup'] as const) {
      const cred = project.mint(scope, `run-${scope}`, project.card);
      const refused = await project.app.inject({
        method: 'POST',
        url: url(project),
        headers: { authorization: `Bearer ${cred.token}` },
        payload: verdict,
      });
      expect(refused.statusCode, scope).toBe(403);
    }
  });

  it('refuses a body that is not a verification', async () => {
    const project = await judged();
    const res = await project.app.inject({ method: 'POST', url: url(project), payload: { passed: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('not a verification');
  });

  // `asVerification` is reused precisely so this cannot get through, and the case has MOVED rather than
  // been deleted: it used to send a critic score disagreeing with its own threshold, which stopped being
  // what it tested the moment `critic` left VERIFY_MODES — the body was then refused on the mode and the
  // test passed for the wrong reason. The disagreement check retired with the critic; what is live is that
  // the retired mode cannot be written onto a run through this endpoint.
  it('refuses a verdict claiming the retired critic mode', async () => {
    const project = await judged();
    const res = await project.app.inject({
      method: 'POST',
      url: url(project),
      payload: { mode: 'critic', passed: true, at: 'T' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('not a verification');
  });

  it('refuses an unknown board, a malformed run id, and a run that does not exist', async () => {
    const project = await judged();
    const wrongBoard = await project.app.inject({
      method: 'POST',
      url: `/api/runs/nonsense/${project.card}/${RUN}/verification`,
      payload: verdict,
    });
    expect([wrongBoard.statusCode, wrongBoard.json()]).toEqual([400, { error: 'Unknown board' }]);

    // A TRAVERSAL guard rather than a shape check — `isRunId` allows any `[A-Za-z0-9_-]+`, deliberately, so
    // that readable fixture ids stay legal. What it excludes is the three characters that could turn a run id
    // into a path: `.`, `/` and `\`. A dot routes fine as a path segment and is refused here, which is the
    // boundary; `..` never reaches the handler because the router does not match it at all.
    const badId = await project.app.inject({
      method: 'POST',
      url: url(project, 'run.id'),
      payload: verdict,
    });
    expect([badId.statusCode, badId.json()]).toEqual([400, { error: 'That is not a run id.' }]);

    const missing = await project.app.inject({
      method: 'POST',
      url: url(project, '20260806-999999-z'),
      payload: verdict,
    });
    expect([missing.statusCode, missing.json()]).toEqual([404, { error: 'No such run' }]);
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
    ['POST', '/api/runs/engineering/E-001/forgive'],
    ['POST', '/api/runs/engineering/E-001/reset'],
    ['POST', '/api/runs/r1/cancel'],
  ])('%s %s', async (method, url) => {
    const app = testApp(new ProjectSession());
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

  // The route for a run with no card in its path to find it by: a checkup or a pre-flight. `grep -rn
  // "project-runs" test/` returned nothing before this — the store function was well covered, the route
  // that reaches it was not.
  it('resolves a run that is about the project, idempotently, and 404s an unknown one', async () => {
    const project = await projectWithCard();
    const checkup: RunRecord = {
      run: '20260803-120000-cc11',
      skill: 'checkup',
      status: 'attention',
      started: '2026-08-03T12:00:00.000Z',
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
      mode: 'plan',
      report: 'the board is circling',
    };
    await writeRun(project.root, checkup);
    const url = `/api/project-runs/${checkup.run}/resolve`;

    const first = await project.app.inject({ method: 'POST', url });
    expect(first.statusCode).toBe(200);
    const stamp = (first.json() as { run: RunRecord }).run.resolved;
    expect(stamp).toBeTruthy();
    // Two clicks are one decision, here as on the card route.
    const second = await project.app.inject({ method: 'POST', url });
    expect((second.json() as { run: RunRecord }).run.resolved).toBe(stamp);
    // And the status is untouched: how it ended is not what the user decided about it.
    expect((second.json() as { run: RunRecord }).run.status).toBe('attention');

    const missing = await project.app.inject({
      method: 'POST',
      url: '/api/project-runs/20260803-999999-zzzz/resolve',
    });
    expect(missing.statusCode).toBe(404);
  });

  // Fastify matches the route FIRST and decodes the segment after, so `%2F` is a real separator by the
  // time a handler reads it. Written as an encoded request rather than a call to the validator, because
  // the validator being right is not the same fact as the route reaching it.
  it.each([
    ['POST', '/api/runs/engineering/E-001/..%2F..%2F..%2Fsecret/resolve'],
    ['POST', '/api/project-runs/..%2F..%2Fsecret/resolve'],
    ['POST', '/api/project-runs/%2e%2e%2f%2e%2e%2fetc%2fpasswd/resolve'],
  ])('refuses %s %s rather than reading a file outside the store', async (method, url) => {
    const project = await projectWithCard();
    const res = await project.app.inject({ method: method as 'POST', url });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('run id');
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
    const app = testApp(new ProjectSession());
    const res = await app.inject({ method: 'POST', url: '/api/runs/engineering/E-001/r/resolve' });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});

// The way out of a card the machine spent. Attempts are counted from the run records, so a card at the
// cap stayed there for ever and auto-pilot would not dispatch it — the state the project was actually
// left in on 2026-08-15, with no remedy but moving files by hand.
describe('POST /api/runs/:board/:card/forgive', () => {
  const spent = (card: string, run: string, over: Partial<RunRecord> = {}): RunRecord => ({
    run,
    card,
    board: 'engineering',
    skill: 'execute',
    status: 'failed',
    started: '2026-08-15T09:00:00.000Z',
    backend: 'claude-code',
    model: 'opus',
    effort: 'high',
    mode: 'bypassPermissions',
    report: 'the credential was refused',
    ...over,
  });

  const forgive = (project: TestProject & { card: string }) =>
    project.app.inject({ method: 'POST', url: `/api/runs/engineering/${project.card}/forgive` });

  it('clears the card’s attempts, says how many, and leaves the runs on disk', async () => {
    const project = await projectWithCard();
    for (const n of [1, 2, 3]) await writeRun(project.root, spent(project.card, `r-${n}`));

    const res = await forgive(project);
    expect([res.statusCode, res.json()]).toEqual([200, { forgiven: 3 }]);
    // FROM DISK, and through the ledger the pane actually reads: a reply assembled and never written
    // is exactly the shape a plant found on the verification route.
    const account = (
      await project.app.inject({ method: 'GET', url: `/api/runs/engineering/${project.card}` })
    ).json() as { runs: RunRecord[]; account: { attempts: Record<string, number> } };
    expect(account.account.attempts.execute).toBe(0);
    // The history is the point: three records still there, each stamped and still saying it failed.
    expect(account.runs).toHaveLength(3);
    expect(account.runs.map((r) => r.status)).toEqual(['failed', 'failed', 'failed']);
    expect(account.runs.every((r) => r.forgiven !== undefined)).toBe(true);
    expect(account.runs[0].report).toBe('the credential was refused');
  });

  it('says nothing was counting rather than implying it fixed something', async () => {
    const project = await projectWithCard();
    const res = await forgive(project);
    expect([res.statusCode, res.json()]).toEqual([200, { forgiven: 0 }]);
  });

  it('refuses while a run on the card has not finished, and says why', async () => {
    // It would settle into an attempt moments later and put the count straight back, which reads as a
    // button that did nothing.
    const project = await projectWithCard();
    await writeRun(project.root, spent(project.card, 'r-done'));
    await writeRun(project.root, spent(project.card, 'r-live', { status: 'running' }));

    const res = await forgive(project);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/has not finished/);
    // And it refused rather than half-doing it: the finished run is untouched.
    expect((await readRun(project.root, 'engineering', project.card, 'r-done'))?.forgiven).toBeUndefined();
  });

  it('refuses a board that is not one, rather than reading a folder by that name', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({ method: 'POST', url: '/api/runs/nonsense/E-001/forgive' });
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'Unknown board' }]);
  });

  // A person overruling the machine, so it is written down. This is the one write that makes a card
  // the caps had stopped dispatchable again, and months later "why did this card get four tries" is a
  // question nothing else answers.
  it('writes down who cleared what, and how many', async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        for (const line of String(chunk).split('\n').filter(Boolean)) {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        }
        cb();
      },
    });
    const project = await openTestProject({ runBin: SHIM, logger: { level: 'info', stream } });
    const state = (await project.app.inject({ method: 'GET', url: '/api/state' })).json() as {
      snapshot: { boards: { engineering: { id: string }[] } };
    };
    const card = state.snapshot.boards.engineering[0].id;
    await writeRun(project.root, spent(card, 'r-1'));
    await writeRun(project.root, spent(card, 'r-2'));

    await project.app.inject({ method: 'POST', url: `/api/runs/engineering/${card}/forgive` });

    const line = lines.find((l) => l.msg === "a person cleared a card's attempts");
    expect(line).toBeDefined();
    // The card and the count, not merely that something happened: a line saying only "attempts
    // cleared" leaves the reader with the same question they came with.
    expect([line?.card, line?.board, line?.forgiven]).toEqual([card, 'engineering', 2]);
    expect(line?.by).toBe('admin');
  });

  it('refuses with 409 when no project is open', async () => {
    const app = testApp(new ProjectSession());
    const res = await app.inject({ method: 'POST', url: '/api/runs/engineering/E-001/forgive' });
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'No project open' }]);
    await app.close();
  });

  // NOT THE TEST OF THE AUTH ROW — that is the grid in test/auth.test.ts, which drives `allows` itself.
  // `testApp` fills an admin bearer into every request, so nothing driven through this app can tell a
  // route refused to agents from an open one. What is asserted here is the other half: an agent is not TOLD
  // it may call this unless it may, which is what keeps it from trying and reading the 403 as a broken tool.
  it('is named in no agent’s endpoint catalogue but a repair’s', async () => {
    await namedOnlyForRepair('/api/runs/:board/:card/forgive');
  });
});

// THE WAY OUT OF A CARD ITS OWN SUCCESSES STOPPED, which the route above cannot reach by design: it
// spares a run that succeeded, and a feature whose checkup ran, created work and closed cleanly three
// times is at its cap with nothing left for it to clear.
describe('POST /api/runs/:board/:card/reset', () => {
  const worked = (card: string, run: string, over: Partial<RunRecord> = {}): RunRecord => ({
    run,
    card,
    board: 'engineering',
    skill: 'execute',
    status: 'success',
    started: '2026-09-20T09:00:00.000Z',
    backend: 'claude-code',
    model: 'opus',
    effort: 'high',
    mode: 'bypassPermissions',
    report: 'done, and it created two cards',
    ...over,
  });

  const reset = (project: TestProject & { card: string }) =>
    project.app.inject({ method: 'POST', url: `/api/runs/engineering/${project.card}/reset` });

  it('clears the successes the forgive spares, and takes the card back to zero', async () => {
    const project = await projectWithCard();
    for (const n of [1, 2, 3]) await writeRun(project.root, worked(project.card, `r-${n}`));

    // THE PREMISE FIRST, through the route a person actually has: it clears nothing at all.
    const forgave = await project.app.inject({
      method: 'POST',
      url: `/api/runs/engineering/${project.card}/forgive`,
    });
    expect([forgave.statusCode, forgave.json()]).toEqual([200, { forgiven: 0 }]);

    const res = await reset(project);
    expect([res.statusCode, res.json()]).toEqual([200, { forgiven: 3 }]);
    // FROM DISK, through the ledger the pane reads, rather than from the reply: a count assembled and
    // never written is the exact shape a plant found on the verification route.
    const account = (
      await project.app.inject({ method: 'GET', url: `/api/runs/engineering/${project.card}` })
    ).json() as { runs: RunRecord[]; account: { attempts: Record<string, number> } };
    expect(account.account.attempts.execute).toBe(0);
    // Nothing is deleted, and each record still reads as the success it was.
    expect(account.runs).toHaveLength(3);
    expect(account.runs.map((r) => r.status)).toEqual(['success', 'success', 'success']);
    expect(account.runs.every((r) => r.forgiven !== undefined)).toBe(true);
    expect(account.runs[0].report).toBe('done, and it created two cards');
  });

  it('says nothing was counting rather than implying it fixed something', async () => {
    const project = await projectWithCard();
    const res = await reset(project);
    expect([res.statusCode, res.json()]).toEqual([200, { forgiven: 0 }]);
  });

  it('refuses while a run on the card has not finished, and says why', async () => {
    // Same reason as the forgive: the unfinished run lands as an attempt moments later and puts the
    // count straight back, which reads as a button that did nothing.
    const project = await projectWithCard();
    await writeRun(project.root, worked(project.card, 'r-done'));
    await writeRun(project.root, worked(project.card, 'r-live', { status: 'running' }));

    const res = await reset(project);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/has not finished/);
    // And it refused rather than half-doing it.
    expect((await readRun(project.root, 'engineering', project.card, 'r-done'))?.forgiven).toBeUndefined();
  });

  it('refuses a board that is not one, rather than reading a folder by that name', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({ method: 'POST', url: '/api/runs/nonsense/E-001/reset' });
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'Unknown board' }]);
  });

  // Its own line and not the forgive's: this is the write that can re-open a creating run, so "why did
  // this feature grow a second set of stories" is a question only this answers.
  it('writes down who reset what, and how many', async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        for (const line of String(chunk).split('\n').filter(Boolean)) {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        }
        cb();
      },
    });
    const project = await openTestProject({ runBin: SHIM, logger: { level: 'info', stream } });
    const state = (await project.app.inject({ method: 'GET', url: '/api/state' })).json() as {
      snapshot: { boards: { engineering: { id: string }[] } };
    };
    const card = state.snapshot.boards.engineering[0].id;
    await writeRun(project.root, worked(card, 'r-1'));
    await writeRun(project.root, worked(card, 'r-2'));

    await project.app.inject({ method: 'POST', url: `/api/runs/engineering/${card}/reset` });

    const line = lines.find((l) => l.msg === 'a person reset a card');
    expect(line).toBeDefined();
    expect([line?.card, line?.board, line?.forgiven]).toEqual([card, 'engineering', 2]);
    expect(line?.by).toBe('admin');
  });

  // NOT THE TEST OF THE AUTH ROW — that is the grid in test/auth.test.ts, and an agent that could reset
  // its own card would have unlimited retries AND could clear the creating run that bounds it. This is
  // the catalogue half: nothing tells an agent the route is there, except the repair that may call it.
  it('is named in no agent’s endpoint catalogue but a repair’s', async () => {
    await namedOnlyForRepair('/api/runs/:board/:card/reset');
  });
});

// The sentence is the only part of the refusal a person sees, so it is asserted without a run anywhere
// near it — the same reason `dispatchLock` is exported.
describe('forgiveRefusal', () => {
  it('says nothing when the card is quiet', () => {
    expect(forgiveRefusal(0)).toBeUndefined();
  });

  it('names what is still going, and what to do instead', () => {
    expect(forgiveRefusal(1)).toMatch(/A run on this card has not finished/);
    expect(forgiveRefusal(1)).toMatch(/stop it from the report list/);
    expect(forgiveRefusal(3)).toMatch(/^3 runs on this card have not finished/);
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
    await mkdir(join(project.root, boardRel('engineering', RESULTS_DIR)), { recursive: true });
    const session = new ProjectSession();
    await expect(session.open(project.root)).resolves.toBeTruthy();
    await session.close();
  });
});

// The documents a run is bound by have to reach the agent, and only the ones that exist: a path list
// naming a file that is not there teaches an agent that these paths are approximate.
describe('POST /api/runs — the foundation', () => {
  const dispatch = async (project: TestProject & { card: string }): Promise<void> => {
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute' },
      })
    ).json() as { run: RunRecord };
    await settled(project, project.card, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;
  };

  it('says nothing about a foundation the project does not have', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    await dispatch(project);
    // An empty heading is the same lie as a wrong path.
    //
    // THE HEADING, NOT THE WORD. This asserted `not.toContain('foundation')` until ruling 67 added
    // `POST /api/foundation/smoke` to the scope table, whose one-line description names both foundation
    // documents — and the endpoint catalogue is generated into EVERY prompt. The bare word was a proxy that
    // happened to be unique, so a legitimate mention elsewhere in the prompt failed a test about the section.
    expect(await promptFrom(argsLog)).not.toContain("## The project's foundation");
  }, 30000);

  it('sends the documents that exist, with the gates in full and the missing ones absent', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    // Written through the editor endpoint, which is the only write path — the OS denies this folder
    // to every agent, the run about to be dispatched included.
    const put = (name: string, content: string) =>
      project.app.inject({
        method: 'PUT',
        url: '/api/control/file',
        payload: { path: `${FOUNDATION_DIR}/${name}`, content },
      });
    await put('STACK.md', 'Node 22.\n');
    await put('CODE-QUALITY.md', '---\ngates:\n  - name: tests\n    command: npm test\n---\nThe bar.\n');

    await dispatch(project);

    const prompt = await promptFrom(argsLog);
    expect(prompt).toContain(`- ${FOUNDATION_DIR}/STACK.md`);
    expect(prompt).toContain(`- ${FOUNDATION_DIR}/CODE-QUALITY.md`);
    expect(prompt).toContain('command: npm test'); // in full, not by reference
    // The three nobody wrote are not LISTED: these paths are exact or they are useless. Scoped to the list
    // itself for the same reason as the test above — the endpoint catalogue names foundation/TESTING.md in
    // the description of the route that declares the smoke command (ruling 67), which is not this list.
    expect(prompt).not.toContain(`- ${FOUNDATION_DIR}/DESIGN.md`);
    expect(prompt).not.toContain(`- ${FOUNDATION_DIR}/TESTING.md`);
  }, 30000);

  // AND THE BOARD AROUND IT (decision 90), computed by the route off the board it already read — which no unit
  // test of the section can see, and which a card run with no such phase must not be handed.
  it('hands a break-down the board around its card, and an ordinary run none', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    const story = await productCard(project);
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'product', card: story, skill: 'break-down' },
      })
    ).json() as { run: RunRecord };
    await settledOn(project, 'product', story, run.run);
    expect(await promptFrom(argsLog)).toContain('## What is already on the board around this card');

    await dispatch(project);
    delete process.env.VIBEBOARD_SHIM_ARGS;
    expect(await promptFrom(argsLog)).not.toContain('What is already on the board');
  }, 30000);

  // AND A BREAK-DOWN GETS THE COMMANDS, NOT THE PROSE (decision 89) — through the app, because the list is
  // parsed in `dispatchFrame` and nothing in a unit test of the section can see that it is handed over.
  it('hands a break-down the gate commands rather than the document', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    await project.app.inject({
      method: 'PUT',
      url: '/api/control/file',
      payload: {
        path: `${FOUNDATION_DIR}/CODE-QUALITY.md`,
        content: '---\ngates:\n  - name: tests\n    command: npm test\n---\nThe bar.\n',
      },
    });
    const story = await productCard(project);
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'product', card: story, skill: 'break-down' },
      })
    ).json() as { run: RunRecord };
    await settledOn(project, 'product', story, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const prompt = await promptFrom(argsLog);
    expect(prompt).toContain('- tests: `npm test`');
    expect(prompt).not.toContain('The bar.');
  }, 30000);

  it('does not claim to carry gates when the document declares none', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    // Exists and is non-empty, so `foundation.present` includes it — but there is no bar in it.
    await project.app.inject({
      method: 'PUT',
      url: '/api/control/file',
      payload: { path: `${FOUNDATION_DIR}/CODE-QUALITY.md`, content: '# Quality\n\nBe careful out there.\n' },
    });

    await dispatch(project);

    const prompt = await promptFrom(argsLog);
    // Still listed as a document to read — it is real, and the agent should see it.
    expect(prompt).toContain(`- ${FOUNDATION_DIR}/CODE-QUALITY.md`);
    // But not under a heading promising the gates it does not contain.
    expect(prompt).not.toContain('The gates your work must pass');
    expect(prompt).not.toContain('Be careful out there');
  }, 30000);
});

// A run about the PROJECT, dispatched with no card at all. It exists because the loop shipped a
// contradiction: the skill on the first features column derives the feature list from the README, so an empty
// board is a project auto-pilot can start — but a per-card dispatch needs a card, and the card is the thing
// the run exists to create (the `bootstrap` row of core/phases.ts).
describe('POST /api/runs with no card', () => {
  const BOOTSTRAP = { project: true, skill: 'derive-features' };

  // The loop's own credential, in the one state that gives it authority.
  async function asService(): Promise<TestProject & { headers: { authorization: string } }> {
    const project = await openTestProject({ runBin: SHIM, mode: 'brownfield' });
    await writeAutopilotState(project.root, { ...IDLE_STATE, state: 'running' });
    const service = project.mint('service', 'run-svc');
    return { ...project, headers: { authorization: `Bearer ${service.token}` } };
  }

  async function settledProjectRun(project: TestProject, run: string): Promise<RunRecord> {
    for (let i = 0; i < 300; i++) {
      const record = await readProjectRun(project.root, run);
      if (record && record.status !== 'running' && record.status !== 'queued') return record;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('project run never settled');
  }

  it('records it with neither card nor board, in the project store', async () => {
    const project = await asService();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: project.headers,
      payload: BOOTSTRAP,
    });
    expect(res.statusCode).toBe(200);
    const { run } = res.json() as { run: RunRecord };
    expect(run.card).toBeUndefined();
    expect(run.board).toBeUndefined();
    // FROM DISK and from the project store specifically: `card`/`board` are what route a record to its home,
    // so a record that kept them would be written beside a card that does not exist.
    const settled = await settledProjectRun(project, run.run);
    expect(settled.skill).toBe('derive-features');
  }, 30000);

  // ONLY the loop. A card-less run is the only run confined to no card, and everyone at the browser is
  // dispatching FROM a card and has one to name.
  //
  // Asked on an IDLE project, so the refusal is this rule's own: while auto-pilot is running, `dispatchLock`
  // refuses every by-hand dispatch first with a 409, and the test would pass with this check deleted.
  it('is refused to a browser, which has a card to name', async () => {
    const project = await openTestProject({ runBin: SHIM, mode: 'brownfield' });
    const res = await project.app.inject({ method: 'POST', url: '/api/runs', payload: BOOTSTRAP });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Only auto-pilot');
  });

  // The flag is explicit rather than inferred from a missing card, so a request that simply forgot which card
  // it meant keeps getting its 400 instead of quietly becoming a more powerful run.
  it('does not turn a request that forgot its card into a project run', async () => {
    const project = await asService();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: project.headers,
      payload: { skill: 'derive-features' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Unknown board');
  });

  it('still refuses a skill the project does not have', async () => {
    const project = await asService();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: project.headers,
      payload: { project: true, skill: 'no-such-skill' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('tells the agent there is no card, and points it at the README', async () => {
    // The awkward half: the skill file was written for a per-card dispatch and says "the column this card is
    // in". Unaddressed, an agent hunts for a card it will not find or invents one to reason about.
    const argsLog = await recordingShimArgs();
    const project = await asService();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: project.headers,
      payload: BOOTSTRAP,
    });
    const { run } = res.json() as { run: RunRecord };
    await settledProjectRun(project, run.run);
    const prompt = await promptFrom(argsLog);
    expect(prompt).toContain('This run is about the project, not a card');
    expect(prompt).toContain('README at the project root is the brief');
    // No card heading, and no promise of a card-confined endpoint: `allows` DENIES the own-card rows to a
    // credential minted without one, so listing them would describe the one authority it cannot have.
    expect(prompt).not.toContain('## The card:');
    expect(prompt).not.toContain('and no other card');
    // But it still gets the columns and the credential — it has cards to create.
    expect(prompt).toContain('POST /api/cards');
  }, 30000);
});

// RULING 63. Evidence the LOOP computes reaches a prompt on a `service`-only field, and the reason is a
// security one rather than a tidiness one: a field on `POST /api/runs` is a field its caller can set, so a
// review agent able to send `gatesPassed: true` could talk its own reviewer into a pass — decision 40 defeated
// through a side door.
//
// The precedent is exact and already in this file: `project: true` is refused from every scope but `service`,
// the browser included. This follows it, including that.
describe('POST /api/runs — the loop’s own evidence', () => {
  const REVIEWING = (review: unknown) => ({ skill: 'review-story', review });

  async function asService(): Promise<TestProject & { card: string; headers: Record<string, string> }> {
    const project = await projectWithCard();
    await writeAutopilotState(project.root, { ...IDLE_STATE, state: 'running' });
    const service = project.mint('service', 'run-svc');
    return { ...project, headers: { authorization: `Bearer ${service.token}` } };
  }

  // THE BROWSER, which is the only non-service caller that reaches the handler at all: the scope table already
  // denies `POST /api/runs` to both working scopes. Asked on an IDLE project so the refusal is this rule's
  // own — while auto-pilot runs, `dispatchLock` refuses every by-hand dispatch first.
  it('refuses the gate result from a browser, which does not run the gates', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { board: 'engineering', card: project.card, ...REVIEWING({ gatesPassed: true }) },
    });
    expect(res.statusCode).toBe(403);
    // And it says what to do instead, like every refusal in this file.
    expect(res.json().error).toMatch(/auto-pilot/i);
  });

  it('refuses it from a work credential too', async () => {
    // Refused twice over, and deliberately: the scope table denies the whole route to a working scope, and
    // this rule denies the field. Neither is a substitute for the other — a route the table later widened
    // would still not carry the loop's own facts.
    const project = await projectWithCard();
    const cred = project.mint('work', 'run-w', project.card);
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { authorization: `Bearer ${cred.token}` },
      payload: { board: 'engineering', card: project.card, ...REVIEWING({ gatesPassed: true }) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts it from the service credential', async () => {
    const project = await asService();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: project.headers,
      payload: {
        board: 'engineering',
        card: project.card,
        ...REVIEWING({ gatesPassed: true, setupSubtree: false }),
      },
    });
    expect(res.statusCode).toBe(200);
    await settled(project, project.card, (res.json() as { run: RunRecord }).run.run);
  }, 30000);

  // THE SAME RULE FOR THE CHECKUP'S EVIDENCE (ruling 60 carried by ruling 63). The blocked list and the smoke
  // result are facts only the loop holds, and a card run able to supply them could describe its own children.
  it('refuses the checkup’s evidence from anyone but the loop', async () => {
    const project = await projectWithCard();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        board: 'engineering',
        card: project.card,
        // Any skill: the field is refused before the skill is even resolved, because it is about who may
        // supply the loop's own facts rather than about what the run is for.
        skill: 'execute',
        checkup: { children: [], blocked: [], suggestions: [] },
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/auto-pilot/i);
  });

  it('accepts the checkup’s evidence from the service credential', async () => {
    const project = await asService();
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: project.headers,
      payload: {
        board: 'engineering',
        card: project.card,
        skill: 'execute',
        checkup: { children: [], blocked: [], suggestions: [] },
      },
    });
    expect(res.statusCode).toBe(200);
    await settled(project, project.card, (res.json() as { run: RunRecord }).run.run);
  }, 30000);

  // THE POINT OF THE REFUSAL, and the half that a status code alone does not prove.
  it('does not reach the prompt when refused', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    const refused = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        board: 'engineering',
        card: project.card,
        ...REVIEWING({ gatesPassed: true, setupSubtree: true }),
      },
    });
    expect(refused.statusCode).toBe(403);

    // The same dispatch without the field is allowed, and is told the truth about the gates instead.
    const story = await productCard(project);
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'product', card: story, skill: 'review-story' },
      })
    ).json() as { run: RunRecord };
    await settledOn(project, 'product', story, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const prompt = await promptFrom(argsLog);
    expect(prompt).not.toContain('gates have already passed');
    expect(prompt).not.toContain('no gate set yet');
    expect(prompt).toMatch(/nobody has run the gates/i);
  }, 30000);
});

// AND THE KIND REACHES THE PROMPT THROUGH THE APP, which is the other half of the same argument: the unit
// test on `boxSection` proves the two wordings exist, and nothing in it can see that `dispatchFrame` reads
// the project's config at all. Without this, the browserless variant could be unreachable and every test
// would still pass — the run would be told about a browser its box was never built with.
describe('POST /api/runs — a research project is not told it has a browser', () => {
  it('reads the kind off the project config and drops the claim from the prompt', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    // Through the route that a person's Settings save goes through, not by writing the file underneath
    // the open session: the config the dispatch reads is the session's, and this is what refreshes it.
    const patched = await project.app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { box: { kind: 'research' } },
    });
    expect(patched.statusCode).toBe(200);

    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { board: 'engineering', card: project.card, skill: 'execute' },
      })
    ).json() as { run: RunRecord };
    await settled(project, project.card, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const prompt = await promptFrom(argsLog);
    expect(prompt).toContain('No browser is installed in this container');
    expect(prompt).not.toContain('Chromium for Playwright');
  }, 30000);
});

// AND THE VERDICT REACHES THE PROMPT THROUGH THE APP, which is the half a unit test on `buildRunPrompt` cannot
// prove: the record already carries `verification` — the verdict path wrote it — so this is a render rather than
// a new fact, and what had to be shown is that nothing between the record and the prompt drops it.
describe('POST /api/runs — a fix run is told what failed', () => {
  it('carries the failing verdict off the previous run’s record into the prompt', async () => {
    const argsLog = await recordingShimArgs();
    const project = await projectWithCard();
    await writeRun(project.root, {
      run: '20260813-100000-impl',
      card: project.card,
      board: 'engineering',
      skill: 'implement',
      status: 'success',
      started: '2026-08-13T10:00:00.000Z',
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
      mode: 'bypassPermissions',
      report: 'added the flag',
      // Written by the loop's gate step, onto the run it judged (decision 18).
      verification: {
        mode: 'gates',
        passed: false,
        at: '2026-08-13T10:05:00.000Z',
        command: 'npm test',
        output: 'Tests  1 failed | 40 passed',
        reason: '`npm test` exited with 1.',
      },
    });
    const { run } = (
      await project.app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          board: 'engineering',
          card: project.card,
          skill: 'execute',
          previous: '20260813-100000-impl',
        },
      })
    ).json() as { run: RunRecord };
    await settled(project, project.card, run.run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const prompt = await promptFrom(argsLog);
    expect(prompt).toContain('npm test');
    expect(prompt).toContain('Tests  1 failed | 40 passed');
  }, 30000);
});

// THE WAY BACK FROM A SPENT BOOTSTRAP, which is the one position with no card and therefore no button.
//
// An empty board plus a README is derived by a card-less run, and its cap is counted over PROJECT runs of
// that skill. On 2026-08-16 the calculator's three attempts were spent by an OpenCode server that could not
// be reached — 449ms each, no model, no tokens — and auto-pilot stopped saying the README might be too thin
// to derive from. Clearing them meant deleting files out of `project-runs/` by hand.
describe('POST /api/runs/project/forgive', () => {
  const derivation = (run: string, over: Partial<RunRecord> = {}): RunRecord => ({
    run,
    skill: 'derive-features',
    status: 'failed',
    started: '2026-08-16T22:55:40.473Z',
    backend: 'opencode',
    model: 'opencode/deepseek-v4-flash-free',
    effort: 'high',
    mode: 'bypassPermissions',
    report: '[opencode failed: fetch failed]',
    ...over,
  });

  const forgive = (project: TestProject) =>
    project.app.inject({ method: 'POST', url: '/api/runs/project/forgive' });

  it('clears the derivation’s attempts, says how many, and keeps the records', async () => {
    const project = await openTestProject({ runBin: SHIM });
    for (const n of [1, 2, 3]) await writeRun(project.root, derivation(`p-${n}`));

    const res = await forgive(project);

    expect([res.statusCode, res.json()]).toEqual([200, { forgiven: 3 }]);
    // From disk, and still saying what happened: the history is the point of stamping rather than deleting.
    const kept = await readProjectRun(project.root, 'p-1');
    expect(kept?.forgiven).toBeDefined();
    expect(kept?.status).toBe('failed');
    expect(kept?.report).toBe('[opencode failed: fetch failed]');
  });

  it('says nothing was counting rather than implying it fixed something', async () => {
    const project = await openTestProject({ runBin: SHIM });
    const res = await forgive(project);
    expect([res.statusCode, res.json()]).toEqual([200, { forgiven: 0 }]);
  });

  it('refuses while a derivation has not finished, and touches nothing', async () => {
    // Same reason as the card route: an in-flight run lands as an attempt of its own moments later, so
    // clearing now reads as a button that did nothing.
    const project = await openTestProject({ runBin: SHIM });
    await writeRun(project.root, derivation('p-done'));
    await writeRun(project.root, derivation('p-live', { status: 'running' }));

    const res = await forgive(project);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/has not finished/);
    expect((await readProjectRun(project.root, 'p-done'))?.forgiven).toBeUndefined();
  });
});
