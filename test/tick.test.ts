import { describe, expect, it } from 'vitest';
import type { Spend } from '../src/core/accounting.js';
import type { TickAction } from '../src/core/actions.js';
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

// A card-less run of the bootstrap skill, which is the only tally the bootstrap's cap has: `attemptsUsed`
// counts per card, and a project run has none.
const derivation = (status: RunStatus, i: number): RunRecord => ({
  ...run('unused', 'features', 'derive-features', status),
  run: `p-${i}`,
  card: undefined,
  board: undefined,
});

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

// One feature being worked, with one story under it. ONE open feature, because two is a refusal now
// (decision 39's invariant) and a fixture that trips it would answer every test with the same stop.
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
  inFlight: [],
  problems: [],
  ...over,
});

const state = (over: Partial<AutopilotState>): AutopilotState => ({ ...RUNNING, ...over });

const detailOf = (action: TickAction): string => (action.kind === 'stop' ? (action.detail ?? '') : '');

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

  // MOVED HERE FROM eligibility.ts WITH THE COMPARISON IT GUARDS. The new tick counts every bound itself —
  // the bootstrap's attempts, and every phase's — so a cap that is not a number would delete the limit here
  // rather than in a module nothing calls any more. `used >= NaN` is false, so it fails open.
  it('stops stalled and names attemptCap when it is not a usable number', () => {
    const ap = { ...DEFAULT_AUTOPILOT, attemptCap: Number.NaN };
    const action = decideTick(input({ ap }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('attemptCap'));
  });

  // BOTH BRANCHES ARMED, which is what makes this about the ORDER rather than about either branch: an empty
  // board would otherwise answer with the bootstrap dispatch.
  it('refuses to spend a tick deriving the board when the project is already over budget', () => {
    const spend: Spend = { runs: 1, withCost: 1, withoutCost: 0, costUsd: 25 };
    expect(decideTick(input({ cards: [], spend }))).toMatchObject({ kind: 'stop', reason: 'exhausted' });
  });

  it('keeps a halted project’s own reason rather than reporting the cap it also happens to have hit', () => {
    // Same shape one step earlier: the state guard has to come before the caps, or an emergency-stopped
    // project at its iteration cap would report `capped` and lose the fact that someone killed it.
    const halted = state({ state: 'halted', reason: 'killed', iteration: 250 });
    expect(decideTick(input({ state: halted }))).toMatchObject({ kind: 'stop', reason: 'killed' });
  });
});

// The keys the tick INDEXES rather than compares. Every scalar it compares is validated because
// `AutopilotConfig` describes parsed YAML — and these were not, which produced two different failures
// from one config: with `terminal` absent, a board of childless cards never reached `isTerminalColumn`
// and DISPATCHED into a project where nothing could ever finish, while the same config threw a TypeError
// as soon as one card had a child, ending the run rather than the tick.
describe('the shape of the config, not just its numbers', () => {
  const withoutTerminal = (): TickInput['ap'] => {
    const ap = { ...DEFAULT_AUTOPILOT };
    // The shape a hand-edited file delivers: the key simply is not there. Cast because the type says it
    // must be, which is exactly the assumption under test.
    delete (ap as { terminal?: unknown }).terminal;
    return ap as TickInput['ap'];
  };

  it('stops stalled and names the key, for a board that would have dispatched', () => {
    const action = decideTick(
      input({ ap: withoutTerminal(), cards: [card('P-009', 'product', 'backlog', 10, [])] }),
    );
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('autopilot.terminal'));
  });

  it('and for the board that would have thrown', () => {
    // Same config, one child added. This used to be a TypeError out of `decideTick`, which by the file's
    // own contract would end the run instead of the tick.
    const cards = [
      card('P-009', 'product', 'backlog', 10, ['E-009']),
      card('E-009', 'engineering', 'backlog', 10, ['P-009']),
    ];
    expect(decideTick(input({ ap: withoutTerminal(), cards }))).toMatchObject({
      kind: 'stop',
      reason: 'stalled',
    });
  });
});

// FINDING C, and it is a CARRIED guard rather than a new one. An unreadable card used to reach the loop only
// through eligibility.ts, which slice 3 deletes — so without this branch that deletion would silently remove
// the fail-closed refusal, and the sentence a user reads with it.
describe('a card that will not parse stops everything', () => {
  it('stops stalled naming the file and the reason', () => {
    const problems = [{ path: 'boards/features/todo/F-002.md', reason: 'bad YAML' }];
    const action = decideTick(input({ problems }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('F-002.md');
    expect(detailOf(action)).toContain('bad YAML');
  });

  it('says how many more there are without listing all of them', () => {
    const problems = [
      { path: 'a.md', reason: 'bad YAML' },
      { path: 'b.md', reason: 'bad YAML' },
      { path: 'c.md', reason: 'bad YAML' },
    ];
    expect(detailOf(decideTick(input({ problems })))).toContain('2 more');
  });

  // BEFORE the position is derived, because the broken file could BE the open feature — or a child that
  // would change which story is next. A position derived from a board that will not fully parse is a guess.
  it('refuses before deriving a position, even when the readable cards look fine', () => {
    const problems = [{ path: 'boards/product/backlog/P-002.md', reason: 'bad indentation' }];
    const action = decideTick(input({ cards: base(), problems }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('P-002.md');
  });
});

// DECISION 39's INVARIANT, reaching the loop. The position refuses rather than guessing, and the tick's job
// is to carry that refusal out with the sentence intact.
describe('two open cards of the same kind stop the loop', () => {
  it('stops stalled and names both features', () => {
    const cards = [
      card('F-002', 'features', 'todo', 10, []),
      card('F-005', 'features', 'in-progress', 20, []),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('F-002');
    expect(detailOf(action)).toContain('F-005');
    expect(detailOf(action)).toContain('Move one back to Backlog');
  });

  it('stops stalled and names both stories, and the feature they belong to', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-002', 'P-005']),
      card('P-002', 'product', 'todo', 10, ['F-001']),
      card('P-005', 'product', 'in-progress', 20, ['F-001']),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('P-002');
    expect(detailOf(action)).toContain('P-005');
    expect(detailOf(action)).toContain('F-001');
  });
});

describe('nothing to work on is not the same as nothing left', () => {
  it('stops complete when every card is in a terminal column', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'complete' });
  });

  // THE B3 SHAPE, and the fixture has to be a column that is neither routed, terminal NOR blocked.
  // `triage` is a folder somebody made, or a column removed from the config with cards still in it.
  it('stops stalled, naming the cards, when a card sits in a column nothing covers', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      card('E-009', 'engineering', 'triage', 10, []),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('E-009');
    // And this is the one case where the routing advice is the right advice.
    expect(detailOf(action)).toContain('routed, terminal or blocked');
  });

  it('stops stalled for a card the loop itself blocked, and says that is what happened', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      card('E-009', 'engineering', 'blocked', 10, []),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('E-009 ran out of attempts');
  });

  // THE SETUP BARRIER'S SENTENCE IS GONE WITH THE BARRIER (decision 44). Nothing can be "waiting for the
  // setup feature" any more, and a message about a rule that no longer exists is worse than none.
  it('never says a card is waiting for the setup feature', () => {
    const cards = [
      { ...card('F-001', 'features', 'in-progress', 10, ['P-001']), setup: true },
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'blocked', 10, ['P-001']),
    ];
    expect(detailOf(decideTick(input({ cards })))).not.toContain('waiting for the setup feature');
  });

  it('says a parent is waiting for its own cards further down', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'blocked', 10, ['P-001']),
    ];
    const detail = detailOf(decideTick(input({ cards })));
    expect(detail).toMatch(/E-001 ran out of attempts/);
    expect(detail).toMatch(/F-001, P-001 are waiting for their own cards further down/);
    // Nothing in this fixture is unroutable, so the routing advice must not appear at all.
    expect(detail).not.toMatch(/routed, terminal or blocked/);
  });

  // The ordinary resume path, and the one stop reason with no test of its own otherwise: `reconcile` writes
  // exactly this state when a server dies under a running loop.
  it('re-states an interrupted restart rather than deciding anything for it', () => {
    const interrupted = state({ state: 'stopped', reason: 'interrupted', needsCheckup: true });
    expect(decideTick(input({ state: interrupted }))).toMatchObject({
      kind: 'stop',
      reason: 'interrupted',
    });
  });

  // The absence of unfinished work is not the presence of finished work, and both of these produce the same
  // empty list: a project archived down to nothing, and — the one that will actually happen — a board fetch
  // that returned nothing because something upstream went wrong.
  it('stops no-op, never complete, when every card there is has been archived', () => {
    const archived = [
      { ...card('F-001', 'features', 'archive', 10, []), archived: '2026-08-05T10:00:00Z' },
      { ...card('P-001', 'product', 'archive', 10, []), archived: '2026-08-05T10:00:00Z' },
    ];
    const gone = decideTick(input({ cards: archived }));
    expect(gone).toMatchObject({ kind: 'stop', reason: 'no-op' });
    expect(detailOf(gone)).toContain('archived');
  });

  it('still reports complete when finished work is actually there', () => {
    const cards = [card('F-001', 'features', 'done', 10, [])];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'complete' });
  });

  // THE FOURTH ROUTE to a false success. `archiveCard` stamps the frontmatter and THEN moves the file, so a
  // server killed between those two writes leaves a card marked archived while still sitting in a live
  // column — invisible to the position, to `unfinished` and to `problems`. The board still shows it.
  it('refuses to call a project finished while a card is half-archived', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, []),
      { ...card('E-009', 'engineering', 'backlog', 10, []), archived: '2026-08-06T10:00:00Z' },
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('E-009');
    expect(detailOf(action)).toContain('marked archived but still in a live column');
  });

  it('counts an archived card as neither work nor unfinished', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      { ...card('E-009', 'engineering', 'archive', 10, []), archived: '2026-08-05T10:00:00Z' },
    ];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'complete' });
  });
});

// THE BOOTSTRAP. An empty board with a README is a project that has said what it wants and has nothing to
// pick up yet — the one state where the loop derives the board itself.
describe('an empty board with a README derives itself', () => {
  it('dispatches derive-features as a project run, with no card', () => {
    const action = decideTick(input({ cards: [] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'bootstrap', skill: 'derive-features' });
    expect(action.kind === 'dispatch' && action.card).toBeUndefined();
  });

  // RULING 52: the skill comes from the PHASE TABLE, which is code, and not from `routes` in config.yaml.
  // The previous behaviour read it off the routing table so a project could point the first features column
  // anywhere; the machine is no longer a setting, and this is what says so.
  it('takes the skill from the phase table, not from the project’s routing table', () => {
    const ap = {
      ...DEFAULT_AUTOPILOT,
      routes: DEFAULT_AUTOPILOT.routes.map((r) =>
        r.board === 'features' && r.column === 'backlog' ? { ...r, skill: 'invent-the-work' } : r,
      ),
    };
    expect(decideTick(input({ cards: [], ap }))).toMatchObject({
      kind: 'dispatch',
      phase: 'bootstrap',
      skill: 'derive-features',
    });
  });

  it('still derives the board when the routing table has no features entry at all', () => {
    // The routing table is dead weight to this decision now, so removing an entry from it changes nothing.
    const ap = {
      ...DEFAULT_AUTOPILOT,
      routes: DEFAULT_AUTOPILOT.routes.filter((r) => !(r.board === 'features' && r.column === 'backlog')),
    };
    expect(decideTick(input({ cards: [], ap }))).toMatchObject({ kind: 'dispatch', phase: 'bootstrap' });
  });

  // The same attempt cap as anything else, counted over PROJECT runs of that skill — a card-less run has no
  // card for `attemptsUsed` to count it against, so this is the only tally there is. Without it a README too
  // thin to derive features from is an empty board dispatching for ever.
  it('stops stalled once the derivation has used every attempt, naming the README', () => {
    const tried = Array.from({ length: DEFAULT_AUTOPILOT.attemptCap }, (_, i) => derivation('attention', i));
    const decided = decideTick(input({ cards: [], runs: tried }));
    expect(decided).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(decided)).toContain('all 3 attempts');
    expect(detailOf(decided)).toContain('README');
  });

  // A run that burned no attempt does not count towards the cap, which is `burnsAttempt`'s whole job: a
  // cancelled derivation is one nobody is answerable for, so the next tick tries again.
  it('does not count a cancelled derivation against the cap', () => {
    const tried = Array.from({ length: DEFAULT_AUTOPILOT.attemptCap }, (_, i) => derivation('cancelled', i));
    expect(decideTick(input({ cards: [], runs: tried }))).toMatchObject({ kind: 'dispatch' });
  });

  // The setup flag is NOT decided here: decision 44 fires it as the bootstrap's EXIT, from the board, in the
  // service. A board predicate would stamp it on any project whose first feature a person typed by hand.
  it('never answers with anything but the four members of the union', () => {
    const branches: TickInput[] = [
      input(),
      input({ cards: [] }),
      input({ problems: [{ path: 'a.md', reason: 'bad YAML' }] }),
      input({ inFlight: [{ card: 'P-001', skill: 'break-down' }] }),
      input({ state: state({ iteration: 250 }) }),
      input({ state: state({ state: 'idle' }) }),
      input({ cards: [card('F-001', 'features', 'done', 10, [])] }),
      input({
        cards: [card('F-002', 'features', 'todo', 10, []), card('F-005', 'features', 'todo', 20, [])],
      }),
    ];
    for (const one of branches) {
      expect(['stop', 'dispatch', 'stamp', 'wait']).toContain(decideTick(one).kind);
    }
  });
});

describe('a run already in flight', () => {
  it('waits while as many runs are in flight as the config allows', () => {
    expect(decideTick(input({ inFlight: [{ card: 'P-009', skill: 'break-down' }] }))).toEqual({
      kind: 'wait',
    });
    // A project run — the bootstrap — has no card and counts towards the limit just the same.
    expect(decideTick(input({ inFlight: [{ skill: 'derive-features' }] }))).toEqual({ kind: 'wait' });
  });

  // An unfinished run does not burn an attempt (`burnsAttempt`), which is what keeps the card being worked
  // from reaching its cap while its own run is still going. With attemptCap runs IN FLIGHT the answer must
  // still be `wait` and never a stop about the very work the loop is waiting for.
  it('waits rather than stalling when the card being worked has attemptCap runs in flight', () => {
    const busy = Array.from({ length: DEFAULT_AUTOPILOT.attemptCap }, () =>
      run('P-001', 'product', 'break-down', 'running'),
    );
    const inFlight = busy.map((r) => ({ card: r.card as string, skill: r.skill }));
    expect(decideTick(input({ runs: busy, inFlight }))).toEqual({ kind: 'wait' });
  });

  // An EMPTY board with the derivation still going is a wait, not a second bootstrap: the tick that
  // dispatched it has not seen it finish yet, and dispatching again would double-derive the whole board.
  it('waits rather than deriving the board a second time', () => {
    expect(decideTick(input({ cards: [], inFlight: [{ skill: 'derive-features' }] }))).toEqual({
      kind: 'wait',
    });
  });
});

describe('the state guard', () => {
  // Principle 1 puts the refusal where the decision is made rather than trusting a guard upstream.
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
