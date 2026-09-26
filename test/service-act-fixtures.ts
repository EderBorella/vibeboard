import type { TickAction } from '../src/core/actions.js';
import type { RunRecord, RunStatus } from '../src/core/runs.js';
import type { BoardName, Card } from '../src/core/types.js';
import type { Verification } from '../src/core/verify.js';
import type { ActDeps } from '../src/service/act.js';
import type { DispatchRequest } from '../src/service/board-client.js';

// One action, carried out, and this is where the phase table finally has an executor.
//
// Everything is injected: no agent is spawned, no project's test suite is run, no git repository is touched.
// What is under test is the ORDER and the CONDITIONS — commit before the entry stamp before the dispatch, the
// exit column stamped because the run COMPLETED rather than because it said it had, and a dispatch that
// happened counted even when what came after it broke.
//
// One home for the fixtures, shared by every `service-act-*` suite: the recording client, the injected deps and
// the phase actions. Two copies would let the suites disagree about what the same dispatch means, which is the
// one thing a fixture must never do — and `ActDeps` comes through `src/service/act.js`, the surviving barrel, so
// type-checking the tests is also a check that it still re-exports what callers ask of it.

export const CARD = (id = 'E-001', board: BoardName = 'engineering'): Card => ({
  id,
  title: id,
  order: 10,
  tags: [],
  links: [],
  created: '2026-08-06',
  board,
  columnSlug: 'backlog',
  body: '',
  filePath: `/tmp/${id}.md`,
});

// A feature's break-down: the phase with BOTH stamps, which is what makes it the fixture for the order.
export const BREAKDOWN = (card = CARD('F-001', 'features')): TickAction => ({
  kind: 'dispatch',
  phase: 'feature-breakdown',
  skill: 'break-down',
  card,
});

// A story at its judging point, which is where it stands while every phase on product runs: neither the
// judgement nor the implement moves it, so a fixture in any other column would be testing a board state
// the machine never produces.
export const STORY = (id = 'P-001'): Card => ({ ...CARD(id, 'product'), columnSlug: 'in-progress' });

// THE STORY'S IMPLEMENT (decision 83), and the one phase left that takes the ordinary dispatch path with
// both an entry column and an exit one. Its `group` is what the run is asked for: the tasks are stamped
// into `in-progress` before it and `review` together after it — delivered, never `done`, which only the
// story's judgement writes (decision 87).
//
// ONE TASK BY DEFAULT, because most of this suite is about the path rather than the group — the suites
// that are about the group name their own, and two is the smallest fixture that can tell "all of them"
// from "one of them".
export const IMPLEMENT = (card = STORY(), cards = [CARD()]): TickAction => ({
  kind: 'dispatch',
  phase: 'story-implement',
  skill: 'implement-story',
  card,
  group: { cards, entry: 'in-progress', delivered: 'review' },
});

// THE STORY'S JUDGEMENT (decision 80). It carries the run its verdict will be WRITTEN onto — a story's
// break-down, or the fix that answered a send-back — because a verdict lands on a run and there is nothing
// for one to be written onto otherwise. It does NOT take the ordinary dispatch path at all: its gates run
// first, in this process (decision 51).
export const REVIEW = (card = STORY()): Extract<TickAction, { kind: 'dispatch' }> => ({
  kind: 'dispatch',
  phase: 'story-review',
  skill: 'review-story',
  card,
  previous: 'WORK-1',
});

// THE PHASE WITH NO STAMP AT EITHER END that still takes the ordinary path. A story being fixed is already
// in `in-progress`, so a move to where it is would be a write for nothing — and a fix does not close a
// story, the judge does, so there is no exit column either.
export const FIX = (card = STORY()): TickAction => ({
  kind: 'dispatch',
  phase: 'story-fix',
  skill: 'fix',
  card,
  previous: 'IMPL-1',
});

export const BOOTSTRAP: TickAction = { kind: 'dispatch', phase: 'bootstrap', skill: 'derive-features' };

let runCount = 0;
export const record = (over: Partial<RunRecord> = {}): RunRecord => {
  runCount += 1;
  return {
    run: `2026-08-06T10-00-0${runCount}-abc`,
    card: 'E-001',
    board: 'engineering',
    skill: 'implement',
    status: 'success' as RunStatus,
    started: '2026-08-06T10:00:00Z',
    backend: 'test',
    model: 'test',
    effort: 'medium',
    mode: 'skill',
    report: '',
    ...over,
  };
};

export const projectRun = (over: Partial<RunRecord> = {}): RunRecord =>
  record({ card: undefined, board: undefined, skill: 'derive-features', ...over });

// A recording client. Every call the loop can make, in the order it made them, so a test can assert that a
// commit happened BEFORE a stamp rather than merely that both happened.
export function recorder(
  opts: {
    settle?: RunRecord[];
    dispatch?: { ok: false; reason: string; fatal: boolean };
    move?: { ok: false; reason: string; fatal: boolean };
    verdict?: { ok: false; reason: string; fatal: boolean };
    // What the board holds when it is read back — the bootstrap's only evidence that it worked, since cards
    // are created through the API and a run that made a dozen of them changes no files.
    boardCards?: Card[];
    // AND WHAT IT HELD BEFORE. A creating phase is judged on the board growing, so a fixture that answers the
    // same thing twice can only express "created nothing" — which is the failure case, not the ordinary one.
    boardBefore?: Card[];
    board?: { ok: false; reason: string; fatal: boolean };
    archive?: Card[];
    suggestions?: { id: string; title: string }[];
    flags?: { ok: false; reason: string; fatal: boolean };
    create?: { ok: false; reason: string; fatal: boolean };
  } = {},
) {
  const calls: string[] = [];
  // WHICH RUN each verdict landed on, not only what it said: a review verdict belongs on the run it judged
  // and never on the review run itself, and only the run id can tell those apart.
  const verdicts: (Verification & { run: string })[] = [];
  const moves: { card: string; to: string }[] = [];
  // The two frontmatter flags, which have their own route: the PATCH allow-list is what stops a work agent
  // flagging its own card, so the loop's stamp cannot go through it.
  const flags: { board: BoardName; card: string; body: Record<string, boolean> }[] = [];
  // Every card the LOOP itself created, which is one card in the whole lifecycle.
  const created: {
    board: BoardName;
    columnSlug: string;
    title: string;
    description?: string;
    body?: string;
    links?: string[];
  }[] = [];
  const diary: { kind: string; text: string }[] = [];
  const dispatched: string[] = [];
  // The requests themselves, not only the skill names: `previous` — which run a fix is addressing — is
  // carried on the request and nowhere else, so a test can only hold it here.
  const requests: DispatchRequest[] = [];
  // The real sequence: `POST /runs` answers with the record it just created, and the same record — same id —
  // is what `GET /runs/:board/:card` shows once it has settled. An earlier version of this fixture invented a
  // fresh id per call, so nothing the loop dispatched could ever be found again and every test failed on a
  // timeout rather than on its subject.
  let dispatchIndex = 0;
  const live: RunRecord[] = [];
  const client = {
    dispatch: async (input: DispatchRequest) => {
      calls.push(`dispatch:${input.skill}`);
      dispatched.push(input.skill);
      requests.push(input);
      if (opts.dispatch) return opts.dispatch;
      // ONE TEMPLATE PER DISPATCH, asserted rather than clamped: with fewer templates than dispatches two
      // records would share a run id and `settle`'s `find` would answer about the wrong one.
      const template = opts.settle?.[dispatchIndex];
      if (opts.settle && !template) {
        throw new Error(
          `the fixture has ${opts.settle.length} settle templates and this is dispatch ${dispatchIndex + 1}`,
        );
      }
      dispatchIndex += 1;
      const started = { ...(template ?? record()), skill: input.skill };
      live.push(started);
      return { ok: true as const, value: { run: started } };
    },
    cardRuns: async () => {
      calls.push('cardRuns');
      return { ok: true as const, value: { runs: live } };
    },
    // The project's whole list, which is where a run with no card is found. Answering from the same `live`
    // array as `cardRuns` on purpose: a fixture with two sources would let a test pass while the code looked
    // in the wrong one.
    runs: async () => {
      calls.push('runs');
      return { ok: true as const, value: { runs: live } };
    },
    board: async () => {
      calls.push('board');
      if (opts.board) return opts.board;
      // The FIRST read answers `boardBefore` where a test supplied one, every later read `boardCards`. That
      // is the whole of "a card appeared while the run was going".
      const reads = calls.filter((c) => c === 'board').length;
      const showing = reads === 1 && opts.boardBefore ? opts.boardBefore : (opts.boardCards ?? []);
      const boards = { features: [], product: [], engineering: [] } as Record<BoardName, Card[]>;
      for (const card of showing) boards[card.board].push(card);
      return {
        ok: true as const,
        value: { config: { boards: {} } as never, boards, problems: [] },
      };
    },
    move: async (_board: BoardName, card: string, to: string) => {
      calls.push(`move:${to}`);
      moves.push({ card, to });
      return opts.move ?? { ok: true as const, value: {} };
    },
    verdict: async (_b: BoardName, _c: string, run: string, verification: Verification) => {
      calls.push(`verdict:${run}`);
      verdicts.push({ ...verification, run });
      return opts.verdict ?? { ok: true as const, value: {} };
    },
    log: async (kind: string, text: string) => {
      calls.push(`log:${kind}`);
      diary.push({ kind, text });
      return { ok: true as const, value: {} };
    },
    suggestions: async () => {
      calls.push('suggestions');
      return { ok: true as const, value: { suggestions: opts.suggestions ?? [] } };
    },
    archive: async (board: BoardName) => {
      calls.push(`archive:${board}`);
      return { ok: true as const, value: { cards: (opts.archive ?? []).filter((c) => c.board === board) } };
    },
    flags: async (board: BoardName, card: string, body: Record<string, boolean>) => {
      calls.push(`flags:${card}`);
      flags.push({ board, card, body });
      return opts.flags ?? { ok: true as const, value: {} };
    },
    // The loop's ONE create: the smoke-harness feature at the bootstrap's exit (ruling 66). The id comes back
    // because the diary line names it, and a fixture that answered no id would hide a line naming `undefined`.
    create: async (input: {
      board: BoardName;
      columnSlug: string;
      title: string;
      description?: string;
      body?: string;
      links?: string[];
    }) => {
      calls.push(`create:${input.board}/${input.columnSlug}`);
      created.push(input);
      return opts.create ?? { ok: true as const, value: { ...CARD('F-099', input.board), ...input } };
    },
  };
  return { client, calls, verdicts, moves, diary, dispatched, requests, flags, created };
}

export const commits: { root: string; message: string; branch?: string }[] = [];

export function deps(
  client: ReturnType<typeof recorder>['client'] | ActDeps['client'],
  over: Partial<ActDeps> = {},
): ActDeps {
  return {
    client: client as unknown as ActDeps['client'],
    root: '/tmp/project',
    branch: 'autopilot/2026-08-06',
    now: () => new Date('2026-08-06T10:05:00Z'),
    // Nothing unreviewed by default. Injected as a READER rather than a value because the refusal below is
    // about the state at the moment the commands would run, not at the moment the loop was built.
    state: async () => ({ unreviewedGates: [] }),
    // Records what it was asked to commit. Ignoring the arguments meant `deps.root` and `deps.branch` could
    // both be wrong and the whole suite still passed — so the promise that a commit cannot land on someone
    // else's branch under an agent's message was held by nothing.
    commit: async (root: string, message: string, opts?: { branch?: string }) => {
      commits.push({ root, message, branch: opts?.branch });
      return { committed: true };
    },
    // One check, no waiting: the record is already settled in these fixtures. `settle`'s own bound is tested
    // where it belongs, and a poll of zero used to make it spin for ever — which is how that was found.
    settlePollMs: 1,
    settleTimeoutMs: 0,
    sleep: async () => undefined,
    ...over,
  } as ActDeps;
}

export const context = { iteration: 3, columns: {} as Record<BoardName, string[]> };
