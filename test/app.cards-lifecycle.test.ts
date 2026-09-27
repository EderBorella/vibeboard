import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { endpointsFor } from '../src/server/auth/auth.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { SEED_SKILLS } from '../src/store/project/seed-skills.js';
import { fixedSandbox, TEST_SANDBOX, tempDir } from './helpers.js';

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
  const app = buildApp(session, { credentials: store, logger: false, sandbox: fixedSandbox(TEST_SANDBOX) });
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

  // DECISION 96: a person's `split` creates one level down, as its board's break-down would, and no further.
  it.each([
    ['features', 'F-001', 'product', 200],
    ['features', 'F-001', 'features', 409],
    ['product', 'P-001', 'engineering', 200],
    ['product', 'P-001', 'product', 409],
    ['engineering', 'E-001', 'engineering', 409],
  ] as const)('lets a split on %s %s create on %s: %i', async (board, card, onto, code) => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', `run-split-${board}-${onto}`, root, card, { board, skill: 'split' });
    const res = await create(app, bearer(run.token), {
      board: onto,
      columnSlug: 'backlog',
      title: 'A split card',
    });
    expect(res.statusCode).toBe(code);
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

  // DECISION 47: a story's judgement may create the siblings it believes were missed, on its own board —
  // the authority it kept when it absorbed the story checkup (decision 80).
  it('lets a story judgement create a card on product — its own board', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-6', root, 'P-001', { board: 'product', skill: 'review-story' });
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

  // THE OTHER HALF OF THAT, and it is the defect decision 69 shipped with rather than a hypothetical.
  //
  // `smokeSection` told a feature checkup facing a failed smoke to file its findings "on the engineering
  // board". This is what the server does with that: the refusal below fired on every card the instruction
  // asked for, so the run created nothing, `boardGrew` was false, decision 69 held the feature open, and the
  // round repeated to the attempt cap. It rendered only for the last open feature with a failing smoke
  // command — the one case the whole mechanism exists for.
  //
  // Kept as a test rather than deleted with the wording, because the wording is not what makes it safe: the
  // prompt now reads `phase('feature-checkup').creates`, and this asserts the server still refuses the board
  // that field does not name. Widening `creates` to engineering would make both go green and orphan every
  // card created — `derivePosition` walks feature -> story -> task, so a task parented to a feature is
  // reached by no phase.
  it('refuses a feature checkup a card on engineering, two boards down', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-7b', root, 'F-001', {
      board: 'features',
      skill: 'checkup-feature',
    });
    const res = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Fix what the smoke test found',
    });
    expect(res.statusCode).not.toBe(200);
    // The sentence matters as much as the code: it is what an agent reads, and it names where the card does
    // belong rather than only saying no.
    expect(res.json().error).toContain('may create cards on product only, not on engineering');
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
  it('stamps a story judgement’s sibling into product/backlog, not the column it asked for', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-9', root, 'P-001', { board: 'product', skill: 'review-story' });
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
      payload: { board: 'features', card: 'F-001', skill: 'break-down', previous: '20260806-000000-nope' },
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
  // parent's — otherwise a story judgement's siblings would land in no vertical at all.
  it('stamps a story judgement’s sibling with the group of the card it ran on', async () => {
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
      skill: 'review-story',
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

// RULING 58's CORRECTION, forced by the first real run: `break-down` created `E-001` and `E-002` both titled
// "Create package.json with metadata" in ONE pass, and the stamp cannot see that — it answers "has a RE-RUN
// already done this". The duplicate cost a full implement-and-review cycle on work that was already done.
describe('a second card with the same title', () => {
  it('is refused, and names the card that already holds the title', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-dup-1', root, 'P-001', { board: 'product', skill: 'break-down' });
    const first = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Create package.json with metadata',
    });
    expect(first.statusCode).toBe(200);

    const second = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Create package.json with metadata',
    });
    // 409 like every other lifecycle refusal: the request is well formed, and it is the board that makes it
    // wrong.
    expect(second.statusCode).toBe(409);
    // NAMED, because an agent told only "no" tries again — and the id is what it should have found by reading
    // the board first.
    expect(second.json().error).toContain(first.json().id);
    expect(second.json().error).toContain('Create package.json with metadata');
  });

  it('is refused across a difference of case or surrounding whitespace', async () => {
    // The differences a model re-typing its own title actually produces. Compared this way rather than
    // exactly, because an agent that has lost track of its work does not lose track of it verbatim.
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-dup-2', root, 'P-001', { board: 'product', skill: 'break-down' });
    const first = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Add the --json flag',
    });
    expect(first.statusCode).toBe(200);

    const second = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: '  ADD THE --json FLAG  ',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toContain(first.json().id);
  });

  // A SECOND RUN TOO, not merely the same one twice: the refusal is about the board's state, and a re-run that
  // has forgotten its own output is the case the stamp was supposed to cover on its own.
  it('is refused for a different run of the same phase', async () => {
    const { app, store, root } = await open();
    const one = store.mintRun('work', 'run-dup-3a', root, 'P-001', { board: 'product', skill: 'break-down' });
    const two = store.mintRun('work', 'run-dup-3b', root, 'P-001', { board: 'product', skill: 'break-down' });
    await create(app, bearer(one.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Write the tests',
    });
    const again = await create(app, bearer(two.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Write the tests',
    });
    expect(again.statusCode).toBe(409);
  });

  // THE COLUMN IT ENTERS, not the one it asked for. The stamp decides that (ruling 61), so a comparison made
  // before the stamp would look in a column the card was never going to land in — and the two together would
  // let a run create its duplicate by asking for a different column.
  it('is refused even when the second create asks for a different column', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-dup-4', root, 'P-001', { board: 'product', skill: 'break-down' });
    const first = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Parse the arguments',
    });
    expect(first.json().columnSlug).toBe('backlog');
    const second = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'in-progress',
      title: 'Parse the arguments',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toContain(first.json().id);
  });

  // NOT ACROSS COLUMNS. A card advancing through the board must not collide with itself: the task it is
  // breaking down moved on, and a new card of that name is a new card.
  it('allows a title a card in ANOTHER column of the same board holds', async () => {
    const { app, store, root } = await open();
    // A person's card, parked where a run's create can never land.
    const mine = await create(app, admin, {
      board: 'engineering',
      columnSlug: 'in-progress',
      title: 'Read the config file',
    });
    expect(mine.statusCode).toBe(200);
    const run = store.mintRun('work', 'run-dup-5', root, 'P-001', { board: 'product', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Read the config file',
    });
    expect(res.statusCode).toBe(200);
  });

  // NOR AGAINST THE ARCHIVE, for the same reason one level further on: a card the user threw away must not
  // veto the work being done properly, and `readBoard` reads the live columns only.
  //
  // TWO GUARDS MASK EACH OTHER HERE, verified rather than assumed: concatenating `readArchive` onto the list
  // leaves this test GREEN, because an archived card's `columnSlug` is `archive` and the column filter above
  // excludes it anyway. Both mutations at once is what turns this red. So this asserts the behaviour and not
  // the mechanism — the mechanism is held by the test above it.
  it('allows a title only an ARCHIVED card holds', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-dup-6', root, 'P-001', { board: 'product', skill: 'break-down' });
    const first = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Print the usage text',
    });
    const archived = await app.inject({
      method: 'POST',
      url: `/api/cards/engineering/${first.json().id}/archive`,
      headers: admin,
    });
    expect(archived.statusCode).toBe(200);

    const again = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Print the usage text',
    });
    expect(again.statusCode).toBe(200);
  });

  // NOT ACROSS BOARDS either, which falls out of reading one board: a task legitimately carries the title of
  // the story above it, and that is the hierarchy working rather than a duplicate.
  it('allows a story and its task to share a title', async () => {
    const { app, store, root } = await open();
    const breakingDown = store.mintRun('work', 'run-dup-7', root, 'F-001', {
      board: 'features',
      skill: 'break-down',
    });
    const story = await create(app, bearer(breakingDown.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'As a user I can ask for JSON',
    });
    expect(story.statusCode).toBe(200);
    const splitting = store.mintRun('work', 'run-dup-8', root, story.json().id, {
      board: 'product',
      skill: 'break-down',
    });
    const task = await create(app, bearer(splitting.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'As a user I can ask for JSON',
    });
    expect(task.statusCode).toBe(200);
  });

  // IT APPLIES TO A RUN, NOT TO A PERSON, and that line is drawn on `req.credential?.run` exactly as
  // `stampForRun` and `wrongBoardForRun` draw it: someone at the browser may legitimately want two cards with
  // one title, and it is not the server's business to argue.
  it('lets a person at the browser create two cards with one title', async () => {
    const { app } = await open();
    const first = await create(app, admin, {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Tidy the helpers',
    });
    const second = await create(app, admin, {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Tidy the helpers',
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).not.toBe(first.json().id);
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

// RULING 65, and it is the fact the loop cannot function without. The first real run's `break-down` created two
// tasks with `links: ["P-002"]` in the POST body, was answered 200 echoing that back, and produced two pure
// orphans: `createCard` wrote the field into the new card's frontmatter without going through `setCardLinks`,
// and both `childrenOf` and `parentOf` read the PARENT's side. The loop then behaved perfectly — the story had
// no children, the phase re-dispatched, the agent saw its own earlier work, three attempts, an honest stop.
//
// Read off the BOARD as well as out of the response, because the response body is exactly what was already
// truthful about a link that did not exist.
describe('the parent a run’s new card hangs off', () => {
  const linksOn = async (app: FastifyInstance, board: string, id: string): Promise<string[] | undefined> => {
    const res = await app.inject({ method: 'GET', url: '/api/state', headers: admin });
    const boards = (res.json() as { snapshot: { boards: Record<string, { id: string; links: string[] }[]> } })
      .snapshot.boards;
    return boards[board].find((c) => c.id === id)?.links;
  };
  const linksIn = (res: { json: () => Record<string, string> }): string[] =>
    (res.json() as unknown as { links: string[] }).links;

  it('is the run’s own card for a feature break-down, on both sides', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-p1', root, 'F-001', { board: 'features', skill: 'break-down' });
    const story = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'As a user I can ask for JSON',
    });
    expect(story.statusCode).toBe(200);
    expect(linksIn(story)).toEqual(['F-001']);
    // THE HALF THAT WAS MISSING. `childrenOf` reads the parent's list, so without this the story is invisible
    // to the machine in both directions and its feature has no children.
    expect(await linksOn(app, 'features', 'F-001')).toContain(story.json().id);
  });

  it('is the run’s own card for a story break-down', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-p2', root, 'P-001', { board: 'product', skill: 'break-down' });
    const task = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Add the --json flag',
    });
    expect(linksIn(task)).toEqual(['P-001']);
    expect(await linksOn(app, 'product', 'P-001')).toContain(task.json().id);
  });

  // THE LOOP'S OWN CREATE (decision 92): the service credential is about no card, so nothing is derived, and it
  // names the story whose one task this is. Both sides are written, as for every derived parent.
  it('is the story the loop names, for the task it writes', async () => {
    const { app, store, root } = await open();
    const loop = store.mintRun('service', 'svc-1', root);
    const task = await create(app, bearer(loop.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'The whole of the story',
      links: ['P-001'],
    });
    expect(task.statusCode).toBe(200);
    expect(linksIn(task)).toEqual(['P-001']);
    expect(await linksOn(app, 'product', 'P-001')).toContain(task.json().id);
  });

  it('is one parent however many the loop names, and none a run names', async () => {
    const { app, store, root } = await open();
    const loop = store.mintRun('service', 'svc-2', root);
    const two = await create(app, bearer(loop.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Named twice',
      links: ['P-001', 'P-002'],
    });
    expect(linksIn(two)).toEqual(['P-001']);
    // A RUN STILL CANNOT NAME ONE: its parent is derived from the card it is about, whatever it sends.
    const run = store.mintRun('work', 'run-p9', root, 'P-001', { board: 'product', skill: 'break-down' });
    const task = await create(app, bearer(run.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Asked for a different parent',
      links: ['P-002'],
    });
    expect(linksIn(task)).toEqual(['P-001']);
  });

  // A RUN WHOSE DERIVATION IS EMPTY still cannot name one: the bootstrap's features sit under nothing, and the
  // scope check is what keeps the loop's rule from reaching it.
  it('is nothing a bootstrap run names, since only the loop may name a parent', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-b1', root, undefined, { skill: 'derive-features' });
    const made = await create(app, bearer(run.token), {
      board: 'features',
      columnSlug: 'backlog',
      title: 'A feature that asked for a parent',
      links: ['P-001'],
    });
    expect(made.statusCode).toBe(200);
    expect(linksIn(made)).toEqual([]);
  });

  it('is only a live card on the board directly above, for the loop', async () => {
    const { app, store, root } = await open();
    const loop = store.mintRun('service', 'svc-3', root);
    // Two boards up, and a sibling on its own board: neither is the parent a derivation would produce.
    for (const [title, parent] of [
      ['Under a feature', 'F-001'],
      ['Under a task', 'E-001'],
    ] as const) {
      const made = await create(app, bearer(loop.token), {
        board: 'engineering',
        columnSlug: 'backlog',
        title,
        links: [parent],
      });
      expect(made.statusCode, parent).toBe(409);
      expect(made.json().error).toContain('may hang only off a live card on the board above it');
    }
  });

  it('carries its story’s group, as a break-down’s task does', async () => {
    const { app, store, root } = await open();
    const loop = store.mintRun('service', 'svc-4', root);
    const task = await create(app, bearer(loop.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Grouped with its story',
      links: ['P-001'],
    });
    const state = (await app.inject({ method: 'GET', url: '/api/state', headers: admin })).json() as {
      snapshot: { boards: Record<string, { id: string; group?: string }[]> };
    };
    const story = state.snapshot.boards.product.find((c) => c.id === 'P-001');
    expect(task.json().group).toBe(story?.group ?? 'P-001');
  });

  it('is the run’s own card for a feature checkup, which creates one board down', async () => {
    // The orphan that costs the most, and the only one that is silent: a story invisible to `allSettled` lets
    // the feature close to `done` with real work parked for ever and nothing said.
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-p3', root, 'F-001', {
      board: 'features',
      skill: 'checkup-feature',
    });
    const story = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'The story we missed',
    });
    expect(linksIn(story)).toEqual(['F-001']);
    expect(await linksOn(app, 'features', 'F-001')).toContain(story.json().id);
  });

  // THE CASE THAT MAKES "link to the run's own card" WRONG, and getting it wrong would silently do nothing: a
  // story judgement creates SIBLINGS on its own board, and a sibling linked to its sibling is nobody's child.
  it('is the card ABOVE the run’s own card for a story judgement, which creates siblings', async () => {
    const { app, store, root } = await open();
    // The scaffolded P-001 already hangs off F-001, which is the vertical the sibling belongs in.
    const run = store.mintRun('work', 'run-p4', root, 'P-001', { board: 'product', skill: 'review-story' });
    const sibling = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'The bit we missed',
    });
    expect(linksIn(sibling)).toEqual(['F-001']);
    expect(await linksOn(app, 'features', 'F-001')).toContain(sibling.json().id);
    // And NOT to the card it ran on: two stories that name each other are two orphans.
    expect(await linksOn(app, 'product', 'P-001')).not.toContain(sibling.json().id);
  });

  it('is nobody for the bootstrap, because nothing sits above a feature', async () => {
    const { app, store, root } = await open();
    const boot = store.mintRun('work', 'run-p5', root, undefined, { skill: 'derive-features' });
    const feature = await create(app, bearer(boot.token), {
      board: 'features',
      columnSlug: 'backlog',
      title: 'Emit JSON output',
    });
    expect(feature.statusCode).toBe(200);
    expect(linksIn(feature)).toEqual([]);
  });

  // NO LINK AND NO REFUSAL, the same trade the group already makes: the run's own card may have been archived
  // under it, and refusing real work over a label is the wrong way round.
  it('creates the card anyway when the run’s own card cannot be found', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-p6', root, 'F-404', { board: 'features', skill: 'break-down' });
    const story = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'An orphan story',
    });
    expect(story.statusCode).toBe(200);
    expect(linksIn(story)).toEqual([]);
  });

  it('creates the card anyway when a story judgement’s own card has no feature above it', async () => {
    const { app, store, root } = await open();
    const loose = await create(app, admin, {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story nobody hung off anything',
    });
    const run = store.mintRun('work', 'run-p7', root, loose.json().id, {
      board: 'product',
      skill: 'review-story',
    });
    const sibling = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'The bit we missed',
    });
    expect(sibling.statusCode).toBe(200);
    expect(linksIn(sibling)).toEqual([]);
  });

  // `links?` IS OFF THE CREATE CONTRACT FOR A RUN. A `work` credential is confined to its own card for
  // `PUT …/links`, so parent↔child is the only link a run may legitimately write — and this field is where that
  // confinement leaked. Not refused: the card is good and the server was going to write the right link anyway,
  // which is the same trade the column and the group make.
  it('ignores the links a run sends, and writes the parent instead', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-p8', root, 'F-001', { board: 'features', skill: 'break-down' });
    const story = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story',
      links: ['E-001'],
    });
    expect(story.statusCode).toBe(200);
    expect(linksIn(story)).toEqual(['F-001']);
    // E-001's own list is untouched, which is the write a run has no business making.
    expect(await linksOn(app, 'engineering', 'E-001')).not.toContain(story.json().id);
  });

  it('leaves a person at the browser their links, written on both sides', async () => {
    // The field survives for a person: they may hang a card off whatever they are looking at.
    const { app } = await open();
    const story = await create(app, admin, {
      board: 'product',
      columnSlug: 'backlog',
      title: 'Mine, under F-001',
      links: ['F-001'],
    });
    expect(linksIn(story)).toEqual(['F-001']);
    expect(await linksOn(app, 'features', 'F-001')).toContain(story.json().id);
  });
});

// DECISION 85, AT THE DOOR THE AGENT ACTUALLY KNOCKS ON. `createForRequest` spreads its whole body into the
// card, so `satisfiedBy` arrived unexamined: `42`, `{ cmd: 'npm test' }`, `['npm test']` and `null` were all
// answered 200 and serialized into the frontmatter as a YAML scalar, a map and a list — under a key the
// frozen on-disk format says is `string | undefined`.
//
// REFUSED RATHER THAN DROPPED, which is the rule the PATCH route forty lines below the create already
// follows: answering 200 over a card that did not carry the field tells the caller — very often a
// break-down agent — that it succeeded, so it never tries the other spelling.
//
// AND THE PARSER'S GUARD IS NOT A SUBSTITUTE FOR THIS. `parseCardContent` reads a non-string back as absent,
// which is what keeps a card ALREADY on disk inert (test/card.test.ts); it does nothing to stop one being
// written, and the two together are what make the field safe rather than either alone.
describe('the criterion a created card names', () => {
  const productIds = async (app: FastifyInstance): Promise<string[]> => {
    const res = await app.inject({ method: 'GET', url: '/api/state', headers: admin });
    const { snapshot } = res.json() as { snapshot: { boards: Record<string, { id: string }[]> } };
    return snapshot.boards.product.map((c) => c.id);
  };

  it('writes a string satisfiedBy onto the card', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-sb', root, 'F-001', { board: 'features', skill: 'break-down' });
    const created = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'The lint gate passes',
      satisfiedBy: 'npm run lint',
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().satisfiedBy).toBe('npm run lint');
  });

  // `null` is in the list on purpose: it is what a JSON encoder emits for an absent value, so it is the one
  // an agent sends by accident rather than by malice — and `typeof null` is `'object'`, which is how a
  // hand-rolled check misses it.
  it.each([
    ['a number', 42],
    ['a boolean', true],
    ['a map', { cmd: 'npm test' }],
    ['a list', ['npm test']],
    ['null', null],
  ])('refuses %s by name, and creates no card at all', async (_what, value) => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-sb', root, 'F-001', { board: 'features', skill: 'break-down' });
    const before = await productIds(app);
    const created = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'The lint gate passes',
      satisfiedBy: value,
    });
    expect(created.statusCode).toBe(400);
    // BY NAME, because a refusal that does not say which field sends the caller to fix the wrong one.
    expect(created.json().error).toContain('satisfiedBy');
    // And nothing half-written: a card created without the criterion it was asked for is the silent
    // success this refusal exists to replace.
    expect(await productIds(app)).toEqual(before);
  });

  // A PERSON AT THE BROWSER IS HELD TO IT TOO. The refusal is about the shape of the on-disk format rather
  // than about the lifecycle, so it cannot sit inside the run-only rules — an admin write reaches
  // `createCard` down the same path.
  it('refuses it from an admin caller as well, which is the browser and the copilot', async () => {
    const { app } = await open();
    const created = await create(app, admin, {
      board: 'product',
      columnSlug: 'backlog',
      title: 'Hand-made',
      satisfiedBy: ['npm test'],
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().error).toContain('satisfiedBy');
  });
});

// H1. THE CATALOGUE AND THE SKILL ARE IN ONE PROMPT AND CONTRADICTED EACH OTHER. `endpointsFor('work', …)`
// rendered the create as `{ board, columnSlug, title, description?, body? }` while the seeded `break-down`
// skill, three sections down the same prompt, said "send `satisfiedBy` on the create, carrying that command
// copied exactly". auth.ts is explicit that the payload shape belongs to that table rather than to a
// comment, and `runs/prompt/credential.ts` exists to stop precisely this drift — an agent that trusts the
// generated list does not send the key, and the whole of decision 85 lands inert on every real project.
//
// HELD FROM BOTH ENDS, because nothing held it from either: test/run-prompt.test.ts asserts the catalogue's
// route SET against the scope table and never a row's payload against what that route accepts. Backwards,
// the field the skill names must appear in the row; forwards, every optional field the row advertises is
// driven through the real endpoint and has to come back on the card.
describe('the payload shape the create advertises', () => {
  const CREATE_ROW = /^- `POST \/api\/cards`.*?`\{ ([^}]*) \}`/;

  const advertised = (): string[] => {
    const row = endpointsFor('work', 'F-001').find((line) => CREATE_ROW.test(line));
    const named = row === undefined ? undefined : CREATE_ROW.exec(row)?.[1];
    if (named === undefined) throw new Error('no `POST /api/cards` payload shape in the work catalogue');
    return named.split(', ');
  };

  it('names the field the seeded break-down skill tells an agent to send', () => {
    const skill = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    // Anchored on the instruction rather than on the bare word: the skill mentions the key twice, and only
    // this sentence is the one telling an agent to put it in a create body.
    expect(skill).toContain('send `satisfiedBy` on the');
    expect(advertised()).toContain('satisfiedBy?');
  });

  it('honours every optional field it advertises, through the real endpoint', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-cat', root, 'F-001', { board: 'features', skill: 'break-down' });
    const optional = advertised()
      .filter((field) => field.endsWith('?'))
      .map((field) => field.slice(0, -1));
    // Two would be satisfied by the pair that was already there, so a row that lost the new field while
    // keeping the old ones would pass a bare "not empty".
    expect(optional).toHaveLength(3);
    for (const field of optional) {
      // A DECLARED gate for the criterion. A string the project does not declare is written to the card
      // just the same, so the endpoint half would pass either way — but a fixture the rule would ignore
      // makes the test read as though it proves more than it does.
      const sent = field === 'satisfiedBy' ? 'npm run lint' : `what the agent sent for ${field}`;
      const created = await create(app, bearer(run.token), {
        board: 'product',
        columnSlug: 'backlog',
        title: `A story about ${field}`,
        [field]: sent,
      });
      expect(created.statusCode, field).toBe(200);
      expect(created.json()[field], field).toBe(sent);
    }
  });
});
