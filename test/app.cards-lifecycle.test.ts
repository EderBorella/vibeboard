import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/credentials.js';
import { ProjectSession } from '../src/server/session.js';
import { TEST_SANDBOX, tempDir } from './helpers.js';

// Where a RUN may create a card, what vertical it belongs to, and which run made it — all three enforced at
// the endpoint, because decision 10 makes endpoints the only write path and a prompt is a request rather than
// a rule.
//
// Every test here goes through HTTP with a real run credential. That is the whole point: the skill files say
// the same things in prose, and the first hand-run showed prose is not enough.

const ADMIN = 'admin-token-for-card-lifecycle';
const admin = { authorization: `Bearer ${ADMIN}` };
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

async function open(): Promise<{ app: FastifyInstance; store: CredentialStore; root: string }> {
  const session = new ProjectSession();
  const store = new CredentialStore(ADMIN);
  // The sandbox gate refuses every dispatch before the request is even resolved, so a test about what a
  // DISPATCH does has to satisfy it first — otherwise the answer is 412 about the machine, not about the rule.
  const app = buildApp(session, { credentials: store, logger: false, sandbox: TEST_SANDBOX });
  const root = await tempDir();
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  // greenfield, so the sample cards give every board a card a run can be scoped to.
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    headers: admin,
    payload: { path: root, name: 'L', mode: 'greenfield' },
  });
  return { app, store, root };
}

const create = (
  app: FastifyInstance,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: () => Record<string, string> }> =>
  app.inject({ method: 'POST', url: '/api/cards', headers, payload }) as unknown as Promise<{
    statusCode: number;
    json: () => Record<string, string>;
  }>;

// WHICH BOARD, and it is the PHASE's `creates` rather than the column a skill is dispatched from (ruling 56).
// A column dispatches nothing under this machine, so the old question — "does this column dispatch the skill
// this run is doing?" — has no answer; and the loop it closed is closed by the machine itself, because
// `feature-breakdown` is chosen from the position rather than from a column.
describe('which board a run may create a card on', () => {
  it('lets a break-down run on a feature create a card on product', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-1', root, 'F-001', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'As a user I can ask for JSON',
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a break-down run on a feature creating a card on features', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-2', root, 'F-001', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'features',
      columnSlug: 'backlog',
      title: 'Another feature',
    });
    // 409 rather than 400: the request is well formed, and it is the project's lifecycle that makes it wrong.
    expect(res.statusCode).toBe(409);
    // A refusal must say what to do instead: an agent told only "no" tries the same thing again.
    expect(res.json().error).toContain('product/backlog');
  });

  // THE ONE THAT MATTERS: one skill, two phases, two different `creates`. Resolved on the skill alone, a
  // story's break-down would carry the authority to create features.
  it('refuses a break-down run on a STORY creating a card on product', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-3', root, 'P-001', { board: 'product', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A sibling story',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('engineering/backlog');
  });

  it('refuses an implement run creating any card', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-4', root, 'E-001', { board: 'engineering', skill: 'implement' });
    for (const board of ['features', 'product', 'engineering'] as const) {
      const res = await create(app, bearer(run.token), {
        board,
        columnSlug: 'backlog',
        title: 'Something I noticed',
      });
      expect(res.statusCode, board).toBe(409);
      // The work it found is real; it just is not a card this run may make.
      expect(res.json().error, board).toContain('POST /api/suggestions');
    }
  });

  it('refuses a run whose skill no phase names', async () => {
    // `execute`, `research`, `summarise` — hand-dispatch skills the lifecycle never uses. The endpoint must
    // not invent a `creates` for them.
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-5', root, 'E-001', { board: 'engineering', skill: 'execute' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('POST /api/suggestions');
  });

  // DECISION 47: a story checkup may create the siblings it believes were missed, on its own board.
  it('lets a story checkup create a card on product — its own board', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-6', root, 'P-001', { board: 'product', skill: 'checkup-story' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'The bit we missed',
    });
    expect(res.statusCode).toBe(200);
  });

  it('lets a feature checkup create a story on product, one board down from its own card', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-7', root, 'F-001', {
      board: 'features',
      skill: 'checkup-feature',
    });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'The story we missed',
    });
    expect(res.statusCode).toBe(200);
  });

  it('lets the bootstrap project run create features', async () => {
    // No `cred.board` at all: a project run has no card, and `bootstrap` is the only card-less phase.
    const { app, store, root } = await open();
    const boot = store.mintRun('work', 'run-boot', root, undefined, { skill: 'derive-features' });
    const res = await create(app, bearer(boot.token), {
      board: 'features',
      columnSlug: 'backlog',
      title: 'Emit JSON output',
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses the bootstrap creating a card on product', async () => {
    const { app, store, root } = await open();
    const boot = store.mintRun('work', 'run-boot-2', root, undefined, { skill: 'derive-features' });
    const res = await create(app, bearer(boot.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story it should not be making',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('features/backlog');
  });

  // A person at the browser is not a run: they may put a card anywhere, on any board, and dragging one into
  // a column is exactly how a human hands work to auto-pilot.
  it('leaves a person at the browser unconstrained', async () => {
    const { app } = await open();
    const res = await create(app, admin, {
      board: 'features',
      columnSlug: 'backlog',
      title: 'A rough idea I had',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('the column a created card enters', () => {
  // THE SECOND THING THE FIRST HAND-RUN GOT WRONG, and it was worse than a wrong label. `break-down` created
  // its three user stories in `product/in-progress`, where nothing could ever move them.
  it('stamps a cross-board card into the target board’s FIRST column whatever was asked for', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-8', root, 'F-001', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'in-progress',
      title: 'As a user I can ask for JSON',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().columnSlug).toBe('backlog');
  });

  // RULING 61. The bug it prevents is the one that manufactures a false success: unstamped, a checkup's
  // sibling could be created straight into `product/done`, where it becomes `complete`'s positive evidence.
  it('stamps a story checkup’s sibling into product/backlog, not the column it asked for', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-9', root, 'P-001', { board: 'product', skill: 'checkup-story' });
    const created = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'done',
      title: 'missed',
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().columnSlug).toBe('backlog');
  });

  // RULING 61 APPLIES TO THE BOOTSTRAP TOO, which is the caller the rule it replaced deliberately excused —
  // and excusing it here is what let `derive-features` manufacture a `complete`: five features created into
  // `features/done` read as the board having grown, so `createdNothing` passes; `stampSetup` then finds no
  // feature in `backlog` and withholds the flag; and the next tick derives an empty position with a live card
  // in a terminal column, which is `complete`'s positive evidence, on a project where nothing was built.
  it('stamps the bootstrap’s own features into features/backlog, whatever was asked for', async () => {
    const { app, store, root } = await open();
    const boot = store.mintRun('work', 'run-10', root, undefined, { skill: 'derive-features' });
    const asked = await create(app, bearer(boot.token), {
      board: 'features',
      columnSlug: 'done',
      title: 'Emit JSON output',
    });
    expect(asked.statusCode).toBe(200);
    expect(asked.json().columnSlug).toBe('backlog');
  });

  it('still excuses the bootstrap its GROUP, because a project run is about no card', async () => {
    // The one surviving half of the skip: a feature is the root of its own vertical, so there is no parent
    // for it to take one from.
    const { app, store, root } = await open();
    const boot = store.mintRun('work', 'run-11', root, undefined, { skill: 'derive-features' });
    const res = await create(app, bearer(boot.token), {
      board: 'features',
      columnSlug: 'todo',
      title: 'Emit JSON output',
    });
    expect(res.json().group).toBeUndefined();
  });

  // NOT MERELY THE FIRST COLUMN. "Every board opens with a Backlog" is a scaffolder default rather than an
  // invariant — columns are renameable and reorderable — and on a board whose first column is terminal this
  // stamp would put every child card into it: a live card in a terminal column is exactly the positive
  // evidence `complete` reads, so the stamp would have been manufacturing false successes.
  it('refuses when the target board’s first column is terminal', async () => {
    const { app, store, root } = await open();
    const config = await app.inject({ method: 'GET', url: '/api/config', headers: admin });
    await app.inject({
      method: 'PATCH',
      url: '/api/config',
      headers: admin,
      payload: {
        boards: { ...config.json().boards, product: { columns: ['Done', 'Backlog', 'Todo', 'In Progress'] } },
        autopilot: config.json().autopilot,
      },
    });

    const run = store.mintRun('work', 'run-11', root, 'F-001', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('product');
    expect(res.json().error).toContain('done');
  });

  it('does not move a person’s card to the entry column', async () => {
    const { app } = await open();
    const res = await create(app, admin, {
      board: 'product',
      columnSlug: 'in-progress',
      title: 'I know where I want this',
    });
    expect(res.json().columnSlug).toBe('in-progress');
  });
});

// A DISPATCH THAT NAMES A RUN IT CANNOT READ IS REFUSED. `readRun` swallows every failure and answers null, and
// mapping that to "no previous run" failed open exactly where it hurts: a judging dispatch whose subject went
// missing gets the GENERAL judging contract, with no run named — verbatim the state that let a judge score a
// dead run 1 and advance the card over it. The loop could not notice, because the dispatch answered 200.
describe('a dispatch naming a previous run', () => {
  it('is refused when that run cannot be read, rather than quietly losing its subject', async () => {
    const { app } = await open();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: admin,
      payload: { board: 'features', card: 'F-001', skill: 'critic', previous: '20260806-000000-nope' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('20260806-000000-nope');
    expect(res.json().error).toMatch(/nothing for this run to continue or to judge/i);
  });
});

describe('the vertical a run’s new card belongs to', () => {
  // One group is one feature: the feature, its user stories, their tasks. Stamped from the credential like
  // every other fact the server knows better than the agent — a value the caller supplies is one the caller
  // can mistype, and one wrong group silently splits a vertical in two.
  it('is stamped from the run’s own card when the new card is a level down', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-12', root, 'F-001', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'As a user I can ask for JSON',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().group).toBe('F-001');
  });

  it('carries the parent’s own group down, so a task names its feature and not its story', async () => {
    const { app, store, root } = await open();
    // A story already inside feature F-001's vertical.
    const breakingDown = store.mintRun('work', 'run-13', root, 'F-001', {
      board: 'features',
      skill: 'break-down',
    });
    const story = await create(app, bearer(breakingDown.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'As a user I can ask for JSON',
    });
    expect(story.json().group).toBe('F-001');

    // Now break THAT down into a task. The task must name the feature, not the story it came from.
    const splittingStory = store.mintRun('work', 'run-14', root, story.json().id, {
      board: 'product',
      skill: 'break-down',
    });
    const task = await create(app, bearer(splittingStory.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Add the --json flag',
    });
    expect(task.json().group).toBe('F-001');
  });

  // RULING 61's other half: a sibling inherits the group of the card the run is ABOUT, not that card's
  // parent's — otherwise a story checkup's siblings would land in no vertical at all.
  it('stamps a story checkup’s sibling with the group of the card it ran on', async () => {
    const { app, store, root } = await open();
    // A person's story, already labelled with its feature's vertical.
    const story = await create(app, admin, {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story in F-001',
      group: 'F-001',
    });
    const run = store.mintRun('work', 'run-15', root, story.json().id, {
      board: 'product',
      skill: 'checkup-story',
    });
    const sibling = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'The bit we missed',
    });
    expect(sibling.json().group).toBe('F-001');
  });

  it('overrides a group the agent sent, because the server knows which vertical this is', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-16', root, 'F-001', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story',
      group: 'whatever-the-agent-felt-like',
    });
    expect(res.json().group).toBe('F-001');
  });

  // A missing parent must not cost a card. The run's card may have been archived under it, and refusing real
  // work over a label would be the wrong trade — the card is created, simply without a group.
  it('creates the card anyway when the run’s own card cannot be found', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-17', root, 'F-404', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'An orphan story',
      // SENT BY THE AGENT, and it must not survive. A review found this value coming through when the parent
      // could not be found, which is exactly the guess the stamp exists to replace — and the comment beside
      // the code claimed the opposite. No group is honest; a wrong one splits a vertical silently.
      group: 'whatever-the-agent-felt-like',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().group).toBeUndefined();
  });

  it('leaves a person’s own group label alone', async () => {
    const { app } = await open();
    const res = await create(app, admin, {
      board: 'product',
      columnSlug: 'backlog',
      title: 'Mine',
      group: 'sync-epic',
    });
    expect(res.json().group).toBe('sync-epic');
  });
});

// RULING 58. `Card.createdBy` is what makes "has this already been done?" a board question with nothing to
// trust: a re-run sees its own earlier output, and unlike `RunRecord.created` — frontmatter the agent wrote
// about itself — this is unforgeable.
describe('the run that created a card', () => {
  it('stamps createdBy with the run id from the credential', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'RUN-1', root, 'F-001', { board: 'features', skill: 'break-down' });
    const created = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story',
    });
    expect(created.json().createdBy).toBe('RUN-1');
  });

  it('stamps it even when the caller sent a different one', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'RUN-1', root, 'F-001', { board: 'features', skill: 'break-down' });
    const created = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story',
      createdBy: 'RUN-99',
    });
    expect(created.json().createdBy).toBe('RUN-1');
  });

  // Even the bootstrap's own features, which are the one case nothing else is stamped on: the creating round
  // is read off `createdBy`, so a card without one is a card no run can be shown to have made.
  it('stamps it on the bootstrap’s own features too, which nothing else stamps', async () => {
    const { app, store, root } = await open();
    const boot = store.mintRun('work', 'RUN-BOOT', root, undefined, { skill: 'derive-features' });
    const created = await create(app, bearer(boot.token), {
      board: 'features',
      columnSlug: 'backlog',
      title: 'Emit JSON output',
    });
    expect(created.json().createdBy).toBe('RUN-BOOT');
  });

  it('stamps no creator for a card a person made', async () => {
    // There is no run, and inventing one would make a hand-made card look like an agent's output.
    const { app } = await open();
    const created = await create(app, admin, {
      board: 'features',
      columnSlug: 'backlog',
      title: 'A rough idea I had',
    });
    expect(created.json().createdBy).toBeUndefined();
  });
});
