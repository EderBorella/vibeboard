import { describe, expect, it } from 'vitest';
import type { Spend } from '../src/core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import type { AutopilotState } from '../src/core/autopilot-state.js';
import type { RunRecord, RunStatus } from '../src/core/runs.js';
import { decideTick, type TickInput } from '../src/core/tick.js';
import type { BoardName, Card } from '../src/core/types.js';

function card(id: string, board: BoardName, columnSlug: string, order: number, links: string[]): Card {
  return {
    id,
    title: id,
    order,
    tags: [],
    links,
    created: '2026-08-05',
    board,
    columnSlug,
    body: '',
    filePath: `/tmp/${id}.md`,
  };
}

let runCount = 0;

function run(cardId: string, board: BoardName, skill: string, status: RunStatus): RunRecord {
  runCount += 1;
  return {
    run: `${cardId}-${skill}-${runCount}`,
    card: cardId,
    board,
    skill,
    status,
    started: '2026-08-05T10:00:00Z',
    backend: 'test',
    model: 'test',
    effort: 'medium',
    mode: 'skill',
    report: '',
  };
}

const COLUMNS: Record<BoardName, string[]> = {
  features: ['backlog', 'todo', 'in-progress', 'done'],
  product: ['backlog', 'todo', 'in-progress', 'done'],
  engineering: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
};

const RUNNING: AutopilotState = {
  state: 'running',
  iteration: 0,
  dispatchesSinceCheckup: 0,
  needsCheckup: false,
};

const NO_SPEND: Spend = { runs: 0, withCost: 0, withoutCost: 0 };

// One product card eligible for `design`, under a feature that is waiting on it.
const base = (): Card[] => [
  card('F-001', 'features', 'todo', 10, ['P-001']),
  card('P-001', 'product', 'backlog', 10, ['F-001']),
];

const input = (over: Partial<TickInput> = {}): TickInput => ({
  ap: DEFAULT_AUTOPILOT,
  state: RUNNING,
  cards: base(),
  columns: COLUMNS,
  runs: [],
  spend: NO_SPEND,
  inFlight: 0,
  problems: [],
  ...over,
});

const state = (over: Partial<AutopilotState>): AutopilotState => ({ ...RUNNING, ...over });

describe('the caps come first', () => {
  it('stops capped at the iteration cap', () => {
    const action = decideTick(input({ state: state({ iteration: 250 }) }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'capped' });
  });

  it('stops exhausted when spend has reached the budget', () => {
    const spend: Spend = { runs: 1, withCost: 1, withoutCost: 0, costUsd: 20 };
    expect(decideTick(input({ spend }))).toMatchObject({ kind: 'stop', reason: 'exhausted' });
  });

  // The bill is the fact that matters: `capped` would say the run finished its allotted work when in
  // truth it ran out of money.
  it('names the budget when both caps are reached at once', () => {
    const spend: Spend = { runs: 1, withCost: 1, withoutCost: 0, costUsd: 25 };
    const action = decideTick(input({ spend, state: state({ iteration: 250 }) }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'exhausted' });
  });

  // `iteration >= NaN` is false, so an unusable cap does not raise the limit — it removes it, and the
  // loop becomes unbounded. The refusal names the field rather than the board.
  it('stops stalled and names the config when a cap is unusable', () => {
    const ap = { ...DEFAULT_AUTOPILOT, maxIterations: Number.NaN };
    const action = decideTick(input({ ap }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('maxIterations'));
  });

  it('stops stalled and names the field when the concurrency limit is unusable', () => {
    // The third of the three NaN twins, and the only one nothing held: an unusable limit does not queue,
    // it lets everything through.
    const ap = { ...DEFAULT_AUTOPILOT, autoPilotConcurrency: Number.NaN };
    const action = decideTick(input({ ap }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('autoPilotConcurrency'));
  });

  // BOTH BRANCHES ARMED, which is what makes this about the order rather than about either branch. The
  // whole describe block passed with the rollup moved ahead of the caps, because no fixture had a rollup
  // to do while it was over budget.
  it('refuses to spend a tick rolling up when the project is already over budget', () => {
    const spend: Spend = { runs: 1, withCost: 1, withoutCost: 0, costUsd: 25 };
    const cards = [
      card('F-001', 'features', 'todo', 10, ['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
    ];
    // Without the caps first this answers `rollup`.
    expect(decideTick(input({ cards, spend }))).toMatchObject({ kind: 'stop', reason: 'exhausted' });
  });

  it('keeps a halted project’s own reason rather than reporting the cap it also happens to have hit', () => {
    // Same shape one step earlier: the state guard has to come before the caps, or an emergency-stopped
    // project at its iteration cap would report `capped` and lose the fact that someone killed it.
    const halted = state({ state: 'halted', reason: 'killed', iteration: 250 });
    expect(decideTick(input({ state: halted }))).toMatchObject({ kind: 'stop', reason: 'killed' });
  });
});

describe('the rollup settles the board before anything dispatches', () => {
  // P-001's only child is finished, so it advances with no dispatch. P-002 is eligible at the same
  // time, and must wait: a supervisor or a critic downstream should judge a settled board (S12).
  const cards = (): Card[] => [
    card('F-001', 'features', 'todo', 10, ['P-001']),
    card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
    card('E-001', 'engineering', 'done', 10, ['P-001']),
    card('F-002', 'features', 'todo', 20, ['P-002']),
    card('P-002', 'product', 'backlog', 10, ['F-002']),
  ];

  it('returns the rollup rather than the dispatch it could also have made', () => {
    const action = decideTick(input({ cards: cards() }));
    expect(action.kind).toBe('rollup');
    expect(action.kind === 'rollup' && action.advance.map((a) => [a.card.id, a.to])).toEqual([
      ['P-001', 'done'],
    ]);
  });

  it('and does it even when a checkup is owed, so the checkup sees the settled board', () => {
    const action = decideTick(input({ cards: cards(), state: state({ needsCheckup: true }) }));
    expect(action.kind).toBe('rollup');
  });
});

describe('the checkup is owed, and C2 cannot run it', () => {
  it('stops when the state says a checkup is needed', () => {
    const action = decideTick(input({ state: state({ needsCheckup: true }) }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('owes a supervisor checkup'));
    // The clause that says C2 CANNOT run it — the whole reason this branch is a stop and not a dispatch.
    // Asserting on the word "checkup" held nothing: it already appears in the sentence before this one.
    expect(action).toHaveProperty('detail', expect.stringContaining('not built yet'));
  });

  it('stops when enough dispatches have passed since the last one', () => {
    const action = decideTick(input({ state: state({ dispatchesSinceCheckup: 10 }) }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('10 dispatches since'));
    expect(action).toHaveProperty('detail', expect.stringContaining('not built yet'));
  });

  it('does not stop while the count is below the interval', () => {
    expect(decideTick(input({ state: state({ dispatchesSinceCheckup: 9 }) })).kind).toBe('dispatch');
  });

  // Same NaN class as the caps: `9 >= NaN` is false, so an unusable interval silently means "never".
  it('stops stalled and names the field when the interval is unusable', () => {
    const ap = { ...DEFAULT_AUTOPILOT, checkupEvery: Number.NaN };
    const action = decideTick(input({ ap }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('checkupEvery'));
  });
});

describe('a card that has run out of attempts', () => {
  const failures = (n: number, cardId: string, board: BoardName, skill: string): RunRecord[] =>
    Array.from({ length: n }, () => run(cardId, board, skill, 'failed'));

  it('stops the run when it is not an engineering card, and names it', () => {
    const runs = failures(3, 'P-001', 'product', 'design');
    const action = decideTick(input({ runs }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('P-001'));
  });

  it('moves an engineering card to the blocked column and lets the loop continue', () => {
    const cards = [
      card('F-001', 'features', 'todo', 10, ['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'backlog', 10, ['P-001']),
      card('F-002', 'features', 'todo', 20, ['P-002']),
      card('P-002', 'product', 'backlog', 10, ['F-002']),
    ];
    const runs = failures(3, 'E-001', 'engineering', 'implement');
    // Renamed, because with the default config `to: 'blocked'` passes just as well against a hardcoded
    // string — and a user who renames the column would have had cards moved to a folder that does not
    // exist. rollup.test.ts already reads terminal columns from config for the same reason.
    const ap = { ...DEFAULT_AUTOPILOT, blockedColumn: 'parked' };
    const action = decideTick(input({ ap, cards, runs }));
    // Before the dispatch P-002 was also entitled to: tidying the board first is what keeps a card at
    // its cap from sitting in a routed column for ever.
    expect(action).toMatchObject({ kind: 'block', to: 'parked' });
    expect(action.kind === 'block' && action.card.id).toBe('E-001');
  });

  it('stops instead of blocking when the exhausted card is inside the setup feature', () => {
    // Blocking it would leave the barrier unfinished for ever, and nothing outside the setup subtree is
    // eligible while that is true — a stall the board would never explain.
    const cards = [
      { ...card('F-001', 'features', 'in-progress', 10, ['P-001']), setup: true },
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'backlog', 10, ['P-001']),
    ];
    const runs = failures(3, 'E-001', 'engineering', 'implement');
    const action = decideTick(input({ cards, runs }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('E-001'));
    expect(action).toHaveProperty('detail', expect.stringContaining('setup'));
  });
});

// The two facts this design exists to keep apart. Conflating them produced the worst failure on
// record: success reported over unfinished work.
describe('nothing eligible is not the same as nothing left', () => {
  it('stops complete when every card is in a terminal column', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'complete' });
  });

  // One list of ids with one piece of advice told the reader to check their routing table about cards
  // the loop itself had blocked and cards the setup barrier was holding back — advice that is wrong for
  // both. Each kind of stuck now carries its own remedy.
  it('says why each kind of stuck card is stuck, rather than blaming the routing table for all of them', () => {
    const cards = [
      { ...card('F-001', 'features', 'in-progress', 10, ['P-001']), setup: true },
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'blocked', 10, ['P-001']),
      card('F-002', 'features', 'todo', 20, ['P-002']),
      card('P-002', 'product', 'backlog', 10, ['F-002']),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    const detail = action.kind === 'stop' ? (action.detail ?? '') : '';
    // E-001 is in the blocked column: the message must say that is why, and that it is what stops this
    // project ever reporting itself finished.
    expect(detail).toMatch(/E-001 ran out of attempts/);
    expect(detail).toMatch(/cannot report itself finished/);
    // F-002 and P-002 are outside the setup subtree, so the barrier is holding them, not the routing.
    expect(detail).toMatch(/F-002, P-002 are waiting for the setup feature/);
    // F-001 and P-001 are parents whose own children are unfinished — the ordinary shape of a stalled
    // board, and the category the first version of this message had no word for.
    expect(detail).toMatch(/F-001, P-001 are waiting for their own cards further down/);
    // And nothing in this fixture is unroutable, so the routing advice must not appear at all.
    expect(detail).not.toMatch(/routed, terminal or blocked/);
  });

  // THE B3 SHAPE, and the fixture has to be a column that is neither routed, terminal NOR blocked. The
  // first version of this test used `engineering/blocked`, which is unrouted BY DESIGN and validated as
  // such — so it never exercised the case that once turned "nothing eligible" into a reported success.
  // `triage` is a folder somebody made, or a column removed from the config with cards still in it.
  it('stops stalled, naming the cards, when a card sits in a column nothing covers', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      card('E-009', 'engineering', 'triage', 10, []),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('E-009'));
    // And this is the one case where the routing advice is the right advice.
    expect(action).toHaveProperty('detail', expect.stringContaining('routed, terminal or blocked'));
  });

  it('stops stalled for a card the loop itself blocked, and says that is what happened', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      card('E-009', 'engineering', 'blocked', 10, []),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('E-009 ran out of attempts'));
  });

  // The ordinary resume path, and the one stop reason with no test: `reconcile` writes exactly this
  // state when a server dies under a running loop.
  it('re-states an interrupted restart rather than deciding anything for it', () => {
    const interrupted = state({ state: 'stopped', reason: 'interrupted', needsCheckup: true });
    expect(decideTick(input({ state: interrupted }))).toMatchObject({
      kind: 'stop',
      reason: 'interrupted',
    });
  });

  // The absence of unfinished work is not the presence of finished work, and all three of these produce
  // the same empty list: an empty project, a project archived down to nothing, and — the one that will
  // actually happen — a board fetch that returned nothing because something upstream went wrong.
  it('stops no-op, never complete, when there is no live card at all', () => {
    const empty = decideTick(input({ cards: [] }));
    expect(empty).toMatchObject({ kind: 'stop', reason: 'no-op' });
    expect(empty).toHaveProperty('detail', expect.stringContaining('no card on any board'));

    const archived = [
      { ...card('F-001', 'features', 'archive', 10, []), archived: '2026-08-05T10:00:00Z' },
      { ...card('P-001', 'product', 'archive', 10, []), archived: '2026-08-05T10:00:00Z' },
    ];
    const gone = decideTick(input({ cards: archived }));
    expect(gone).toMatchObject({ kind: 'stop', reason: 'no-op' });
    expect(gone).toHaveProperty('detail', expect.stringContaining('archived'));
  });

  it('still reports complete when finished work is actually there', () => {
    // The other half of the rule above: `complete` needs at least one live card in a terminal column, so
    // this test is what stops the no-op check from swallowing the success case.
    const cards = [card('F-001', 'features', 'done', 10, [])];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'complete' });
  });

  it('counts an archived card as neither eligible nor unfinished', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      { ...card('E-009', 'engineering', 'archive', 10, []), archived: '2026-08-05T10:00:00Z' },
    ];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'complete' });
  });

  it('stops stalled with the reason when the board cannot be read', () => {
    const problems = [{ path: 'boards/features/todo/F-001.md', reason: 'bad indentation' }];
    const action = decideTick(input({ problems }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('F-001.md'));
  });
});

describe('and otherwise it dispatches', () => {
  it('waits while as many runs are in flight as the config allows', () => {
    expect(decideTick(input({ inFlight: 1 }))).toEqual({ kind: 'wait' });
  });

  it('dispatches the picked card and its route', () => {
    const action = decideTick(input());
    expect(action.kind).toBe('dispatch');
    expect(action.kind === 'dispatch' && [action.card.id, action.route.skill]).toEqual(['P-001', 'design']);
  });

  // The state check belongs here as well as in the service: Principle 1 puts the refusal where the
  // decision is made rather than trusting a guard upstream.
  it('refuses to decide anything for a project that is not running', () => {
    expect(decideTick(input({ state: state({ state: 'halted', reason: 'killed' }) }))).toMatchObject({
      kind: 'stop',
      reason: 'killed',
    });
    expect(decideTick(input({ state: state({ state: 'idle' }) }))).toMatchObject({
      kind: 'stop',
      reason: 'stopped',
    });
  });
});
