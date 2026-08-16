import { describe, expect, it } from 'vitest';
import type { Spend } from '../src/core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { decideTick, type TickInput } from '../src/core/lifecycle/tick.js';
import { type RunRecord, type RunStatus, withVerification } from '../src/core/runs.js';
import type { BoardName, Card } from '../src/core/types.js';
import type { Verification } from '../src/core/verify.js';
import { base, COLUMNS, card, detailOf, input, state, task } from './tick-fixtures.js';

// WHICH ACTION THE MACHINE ANSWERS WITH — the phase router in src/core/lifecycle/tick.ts. The sentences
// those stops carry are asserted in test/tick-stop-sentences.test.ts instead, against the module that
// generates them; what is here is the order of the guards and the phase each position lands in.

let runCount = 0;

// The id SORTS BY THE ORDER THE FIXTURE MADE IT, and every run here shares one `started` — so the id is
// what `latest` in bounds.ts ends up comparing. `${cardId}-${skill}-${n}` did not have that property:
// `E-001-fix-2` sorts before `E-001-implement-1`, so a fix made after an implement read as older, and no
// fixture could tell a real ordering bug from a right answer reached backwards.
//
// In production the id is only the TIE-BREAK — `latest` ranks by `started` first, because a run id is
// sortable only to the second and its suffix is random. That is asserted in test/bounds.test.ts, where the
// two can disagree; here they cannot, and a fixture that made them differ would be testing the ordering
// rather than the tick.
function run(cardId: string, board: BoardName, skill: string, status: RunStatus): RunRecord {
  runCount += 1;
  return {
    run: `${String(runCount).padStart(4, '0')}-${cardId}-${skill}`,
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

// A project scaffolded before product had one. There is no migration (ruling 59), so this is the shape of
// every project that already exists.
const WITHOUT_PRODUCT_BLOCKED: Record<BoardName, string[]> = {
  ...COLUMNS,
  product: ['backlog', 'todo', 'in-progress', 'done'],
};

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

// THE MACHINE FAILED, NOT THE WORK. Measured 2026-08-15: a box holding a credential whose inode had been
// replaced on the host failed every run in 58ms, auto-pilot charged all three of one story's attempts to
// them, and then stopped saying that STORY had used its attempts and somebody should read it and change what
// it asks for. Nothing had ever opened the card.
//
// Two halves, and the second is why this block exists at all: once an infrastructure failure costs a card
// nothing, a project whose credential has died would retry the same card for ever, so the loop needs a stop
// that belongs to the PROJECT and blames nothing on the board.
const DEAD_NOTE =
  'The agent never reached a model: Failed to authenticate: OAuth session expired and could not be refreshed (exit code 1).';

// A run the runner classified: `failed`, with the fault and the note `#endWithoutReport` now writes.
const dead = (cardId: string, board: BoardName, skill: string): RunRecord => ({
  ...run(cardId, board, skill, 'failed'),
  fault: 'infrastructure',
  note: DEAD_NOTE,
});

describe('two runs in a row that never reached a model stop the loop', () => {
  const twice = (): RunRecord[] => [
    dead('P-001', 'product', 'break-down'),
    dead('P-001', 'product', 'break-down'),
  ];

  it('stops with its own reason rather than stalled', () => {
    expect(decideTick(input({ runs: twice() }))).toMatchObject({ kind: 'stop', reason: 'infrastructure' });
  });

  // THE ERROR, QUOTED. A dead credential and a working directory that no longer exists read identically once
  // the specifics are dropped, and they need different fixes — the day before the run above, a box pointing
  // at a deleted working directory produced "the README may be too thin to derive from" about a README
  // nothing had opened.
  it('quotes what the runs actually said, and points at the one place that can fix it', () => {
    const detail = detailOf(decideTick(input({ runs: twice() })));
    expect(detail).toContain('Failed to authenticate: OAuth session expired and could not be refreshed');
    expect(detail).toContain('Settings');
    expect(detail).toContain('Rebuild the agent boxes');
  });

  // NO CARD IS NAMED, which is the whole point of the reason rather than a nicety of its wording: no card was
  // read, so any card the sentence named would be one the machine never opened. Both fixtures are asserted
  // because the board carries a feature and a story and either would be a wrong accusation.
  it('names no card', () => {
    const detail = detailOf(decideTick(input({ runs: twice() })));
    expect(detail).not.toContain('P-001');
    expect(detail).not.toContain('F-001');
  });

  // TWO, NOT ONE. A single transient failure is worth one retry, and the loop carries on with exactly the
  // action it would have taken with no runs at all.
  it('does not stop for a single failure', () => {
    const runs = [dead('P-001', 'product', 'break-down')];
    expect(decideTick(input({ runs }))).toMatchObject({ kind: 'stamp', phase: 'feature-breakdown-skip' });
  });

  // THE ACTUAL BUG, and the contrast is with 'blocks a story whose break-down has used every attempt' further
  // down: the same board and the same three failed runs, differing only in whose failure they were. Before
  // `burnsAttempt` took the record instead of the status, this answered `stamp … to: 'blocked'` — a story
  // left for a person over three runs that never reached a model.
  //
  // THE FIXTURE NEEDS A FOURTH RUN and that is not padding: the stop above is checked before any per-card
  // reasoning, so three infrastructure failures at the END of the history answer `infrastructure` and this
  // test could never reach the accounting it is about. The fourth is the shape of a recovered project — the
  // boxes were rebuilt, the card got a real attempt and genuinely failed — and it breaks the streak because
  // it reached a model. It burns one of the three, leaving two, so the story is dispatched again.
  it('still dispatches a story whose every attempt so far was an infrastructure failure', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'todo', 10, ['F-001']),
    ];
    const runs: RunRecord[] = [
      ...Array.from({ length: DEFAULT_AUTOPILOT.attemptCap }, () => dead('P-001', 'product', 'break-down')),
      // Explicitly later, because `consecutiveInfrastructureFailures` orders by `started` and every run this
      // fixture makes shares one timestamp — leaving the order to the sort's stability would make this test
      // pass for a reason nobody wrote down.
      { ...run('P-001', 'product', 'break-down', 'failed'), started: '2026-08-05T11:00:00Z' },
    ];
    const action = decideTick(input({ cards, runs }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-breakdown', card: { id: 'P-001' } });
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

  // WAS "stops stalled for a card the loop itself blocked". Decision 45 REPEALS that: a blocked task is
  // settled, so a board whose only outstanding card is one reports `complete` and names it. The finding-D
  // block at the end of this file is where that behaviour is pinned, both directions.
  it('reports complete, not stalled, for a card the loop itself blocked', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      card('E-009', 'engineering', 'blocked', 10, []),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'complete' });
    expect(detailOf(action)).toContain('E-009');
  });

  // The ordinary resume path, and the one stop reason with no test of its own otherwise: `reconcile` writes
  // exactly this state when a server dies under a running loop.
  it('re-states an interrupted restart rather than deciding anything for it', () => {
    const interrupted = state({ state: 'stopped', reason: 'interrupted' });
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

  // RULING 52 is now structural rather than asserted against a rival: the skill for `bootstrap` can only
  // come from the phase table, because `routes` — which a project could point anywhere — no longer exists.
  // The two cases that proved the table won that argument retired with the loser.

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

// The two `it already has children` helpers: a feature with a story, a story with a task.
const threeRunsOf = (cardId: string, board: BoardName, skill: string): RunRecord[] =>
  Array.from({ length: DEFAULT_AUTOPILOT.attemptCap }, () => run(cardId, board, skill, 'failed'));

describe('decideTick — the feature loop', () => {
  it('stamps a backlog feature into todo and dispatches break-down', () => {
    // ONE action: the entry stamp is part of carrying the dispatch out, not a tick of its own — otherwise
    // every dispatch costs an idle tick and MAX_IDLE_TICKS would bound a healthy loop.
    const action = decideTick(input({ cards: [card('F-001', 'features', 'backlog', 10, [])] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'feature-breakdown', skill: 'break-down' });
    expect(action.kind === 'dispatch' && action.card?.id).toBe('F-001');
  });

  // DECISION 50, and it is what makes the machine idempotent across a crash or a restart: a follow-up feature
  // arrives with its stories already attached, so a break-down would create a second set of them.
  it('skips break-down for a feature that already has a story', () => {
    expect(decideTick(input({ cards: base() }))).toMatchObject({
      kind: 'stamp',
      phase: 'feature-breakdown-skip',
      to: 'in-progress',
    });
  });

  it('stops stalled naming the feature once break-down has used every attempt', () => {
    const cards = [card('F-001', 'features', 'todo', 10, [])];
    const action = decideTick(input({ cards, runs: threeRunsOf('F-001', 'features', 'break-down') }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('F-001');
    expect(detailOf(action)).toContain('break-down');
    // A feature nobody can break down is a project-level problem: it has no sibling to carry on with, so
    // there is nothing for the loop to do instead. THE EXACT CLAUSE, and it must not be one the
    // blocked-column branch also makes — while both said "needs a person", a feature that started being
    // stamped into a column features has not got produced the other sentence and this passed anyway.
    expect(detailOf(action)).toContain('there is nothing else auto-pilot can try on it');
    expect(detailOf(action)).not.toContain('blocked');
  });

  it('dispatches checkup-feature once every story is settled', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({
      kind: 'dispatch',
      phase: 'feature-checkup',
      skill: 'checkup-feature',
    });
  });

  // A blocked task under a story is settled, so the story closed and the feature still reaches its checkup
  // (decision 45). Without this, one task nobody can fix costs you every feature after it.
  it('dispatches checkup-feature when a story closed carrying a blocked task', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'blocked', 10, ['P-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({
      kind: 'dispatch',
      phase: 'feature-checkup',
      skill: 'checkup-feature',
    });
  });

  it('stops stalled once checkup-feature has used every attempt', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
    ];
    const action = decideTick(input({ cards, runs: threeRunsOf('F-001', 'features', 'checkup-feature') }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('checkup-feature');
  });

  // DECISION 47: one creating round per checkup point, and the round is read off the BOARD by `createdBy`
  // rather than out of the run's own report. Once it is spent, a checkup that has already had its
  // close-or-stop turn and left the feature open has answered — asking again is asking a model to change
  // its mind, which is no exit condition.
  it('stops stalled when the feature checkup has spent its creating round and still will not close', () => {
    const creating = run('F-001', 'features', 'checkup-feature', 'success');
    const second = run('F-001', 'features', 'checkup-feature', 'attention');
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001', 'P-002']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      // The card that spent the round, stamped by the endpoint with the run that created it, and now settled.
      { ...card('P-002', 'product', 'done', 20, ['F-001']), createdBy: creating.run },
    ];
    const action = decideTick(input({ cards, runs: [creating, second] }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('F-001');
    expect(detailOf(action)).toContain('creating');
  });

  it('still dispatches the checkup that follows the creating round, so it can close', () => {
    // The other half of decision 47: what it created is settled, and THIS visit may close the feature. Only
    // once this one has come back without closing it is the point exhausted.
    const creating = run('F-001', 'features', 'checkup-feature', 'success');
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001', 'P-002']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      { ...card('P-002', 'product', 'done', 20, ['F-001']), createdBy: creating.run },
    ];
    expect(decideTick(input({ cards, runs: [creating] }))).toMatchObject({
      kind: 'dispatch',
      phase: 'feature-checkup',
    });
  });

  it('does not spend the round on a card the checkup only CLAIMED to create', () => {
    // Finding F: `created` is the agent's own claim. A run reporting a card that is not on the board has
    // spent no round, so its checkup point is still open for business.
    const claimed = { ...run('F-001', 'features', 'checkup-feature', 'success'), created: ['P-009'] };
    const second = run('F-001', 'features', 'checkup-feature', 'attention');
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
    ];
    expect(decideTick(input({ cards, runs: [claimed, second] }))).toMatchObject({
      kind: 'dispatch',
      phase: 'feature-checkup',
    });
  });
});

describe('decideTick — the story loop', () => {
  const feature = (links: string[]) => card('F-001', 'features', 'in-progress', 10, links);

  it('stamps a backlog story into todo and dispatches break-down', () => {
    const cards = [feature(['P-001']), card('P-001', 'product', 'backlog', 10, ['F-001'])];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-breakdown', skill: 'break-down' });
    expect(action.kind === 'dispatch' && action.card?.id).toBe('P-001');
  });

  it('skips break-down for a story that already has a task', () => {
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'todo', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'backlog', 10, ['P-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({
      kind: 'stamp',
      phase: 'story-breakdown-skip',
      to: 'in-progress',
    });
  });

  // DECISION 45's 2026-08-13 CORRECTION, and this test used to assert the stop it replaces. A story that
  // cannot be broken down is left blocked and the loop carries on: the run that produced this ruling had one
  // redundant story stop a whole project with three untouched features queued behind it.
  it('blocks a story whose break-down has used every attempt, rather than stopping the project', () => {
    const cards = [feature(['P-001']), card('P-001', 'product', 'todo', 10, ['F-001'])];
    const action = decideTick(input({ cards, runs: threeRunsOf('P-001', 'product', 'break-down') }));
    expect(action).toMatchObject({
      kind: 'stamp',
      phase: 'story-breakdown',
      card: { id: 'P-001' },
      to: 'blocked',
    });
    // Not a dispatch and not a stop: the judgement is that three attempts produced nothing, which the
    // record already carries — there is nothing left to pay a model for.
    expect(action.kind).toBe('stamp');
  });

  // AND THE NEXT STORY IS PICKED UP. The whole point of the correction, asserted where the position is
  // derived: a blocked story is neither open nor queued, so its sibling is next.
  it('works the next story once one is blocked', () => {
    const cards = [
      feature(['P-001', 'P-002']),
      card('P-001', 'product', 'blocked', 10, ['F-001']),
      card('P-002', 'product', 'backlog', 20, ['F-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-breakdown',
      card: { id: 'P-002' },
    });
  });

  // AND THE FEATURE STILL REACHES ITS CHECKUP over a story nobody could break down: blocked settles, so
  // the feature closes carrying the problem rather than waiting for a story no run can move.
  it('dispatches checkup-feature when one story is done and another is blocked', () => {
    const cards = [
      feature(['P-001', 'P-002']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      card('P-002', 'product', 'blocked', 20, ['F-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({
      kind: 'dispatch',
      phase: 'feature-checkup',
      skill: 'checkup-feature',
    });
  });

  // FAILS CLOSED ON A BOARD WITH NO BLOCKED COLUMN, which is every project scaffolded before this rule
  // (ruling 59: no migration). A column IS a folder, so a stamp to one the board has not got would create
  // it and put the story where `readBoard` never looks — the old stop is the honest answer, and it names
  // what the board is missing rather than the card.
  it('stops stalled, naming the missing column, when product has no blocked column', () => {
    const cards = [feature(['P-001']), card('P-001', 'product', 'todo', 10, ['F-001'])];
    const action = decideTick(
      input({
        cards,
        columns: WITHOUT_PRODUCT_BLOCKED,
        runs: threeRunsOf('P-001', 'product', 'break-down'),
      }),
    );
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('P-001');
    expect(detailOf(action)).toContain('no blocked column');
    // The remedy, since the block is not editable from Settings: a person has to add the column.
    expect(detailOf(action)).toContain('Add a blocked column');
  });

  // AND THE STORY CHECKUP DOES NOT BLOCK ITS CARD. Only a break-down does: a checkup point that will not
  // close is a judgement about work already delivered, so there is nothing "waiting for a person" about the
  // story itself. Pinned, or adding a phase to that list later would be a silent change of behaviour.
  it('stops stalled, rather than blocking the story, when its checkup has used every attempt', () => {
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
    ];
    const action = decideTick(input({ cards, runs: threeRunsOf('P-001', 'product', 'checkup-story') }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('checkup-story');
  });

  it('dispatches checkup-story once every task is settled', () => {
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001', 'E-002']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
      card('E-002', 'engineering', 'blocked', 20, ['P-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-checkup',
      skill: 'checkup-story',
    });
  });

  // THE STORY CHECKUP'S CREATING ROUND IS BOUNDED TOO, and it looked as though it needed no bound: ruling 54
  // makes creating siblings and closing the story ONE act, so there is no second visit to this point — while
  // the exit stamp succeeds. A REFUSED move leaves the story settled and in `in-progress`, and the next tick
  // dispatched another checkup with a fresh creating round, up to `attemptCap` of them, each entitled to
  // create more siblings.
  it('stops stalled when the story checkup has spent its creating round and still will not close', () => {
    const creating = run('P-001', 'product', 'checkup-story', 'success');
    const second = run('P-001', 'product', 'checkup-story', 'attention');
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
      // The sibling that spent the round, stamped by the endpoint with the run that created it, and settled.
      { ...card('P-002', 'product', 'done', 20, ['F-001']), createdBy: creating.run },
    ];
    const action = decideTick(input({ cards, runs: [creating, second] }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('P-001');
    expect(detailOf(action)).toContain('creating');
    // The noun matters: this is the story's checkup point, not the feature's.
    expect(detailOf(action)).toContain('close the story');
  });

  it('still dispatches the story checkup that follows the creating round, so it can close', () => {
    const creating = run('P-001', 'product', 'checkup-story', 'success');
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
      { ...card('P-002', 'product', 'done', 20, ['F-001']), createdBy: creating.run },
    ];
    expect(decideTick(input({ cards, runs: [creating] }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-checkup',
    });
  });

  // THE FIXTURE MUST HAVE TWO TASKS: with one, "all settled" and "any settled" are the same answer.
  it('does not dispatch checkup-story while one of two tasks is in review', () => {
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001', 'E-002']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
      card('E-002', 'engineering', 'review', 20, ['P-001']),
    ];
    const action = decideTick(input({ cards }));
    expect(action.kind === 'dispatch' && action.phase).not.toBe('story-checkup');
  });

  // L2 DRAINS BEFORE L1 ADVANCES. A feature with an unsettled story must not reach its own checkup.
  it('works the story loop before the feature checkup', () => {
    const cards = [
      feature(['P-001', 'P-002']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      card('P-002', 'product', 'backlog', 20, ['F-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-breakdown',
      card: { id: 'P-002' },
    });
  });

  // And the feature's own entry comes before either: a feature whose stories are being worked must not still
  // sit in Backlog, or the board says one thing and the machine another.
  it('stamps the feature out of backlog before working its stories', () => {
    const cards = [
      card('F-001', 'features', 'backlog', 10, ['P-001']),
      card('P-001', 'product', 'backlog', 10, ['F-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({
      kind: 'stamp',
      phase: 'feature-breakdown-skip',
      card: { id: 'F-001' },
    });
  });
});

// ── the task loop and the review loop ───────────────────────────────────────────────────────────────
//
// Composed through the real `withVerification`, because a verdict is what every branch below turns on and a
// hand-built one is a shape nothing writes.

const gates = (passed: boolean): Verification =>
  passed
    ? { mode: 'gates', passed: true, at: 'T' }
    : { mode: 'gates', passed: false, at: 'T', command: 'npm test', output: '1 failing' };

const work = (skill: 'implement' | 'fix', cardId = 'E-001'): RunRecord =>
  run(cardId, 'engineering', skill, 'success');

const judged = (skill: 'implement' | 'fix', passed: boolean, cardId = 'E-001'): RunRecord =>
  withVerification(work(skill, cardId), gates(passed));

// A review that answered, and one that did not. Only the second kind counts towards the review bound.
const answered = (verdict: 'done' | 'sent-back', cardId = 'E-001'): RunRecord => ({
  ...run(cardId, 'engineering', 'review', 'success'),
  verdict,
});
const inconclusive = (cardId = 'E-001'): RunRecord => run(cardId, 'engineering', 'review', 'failed');

// The story that owns the tasks, in progress with its break-down done.
const story = (taskIds: string[]): Card[] => [
  card('F-001', 'features', 'in-progress', 10, ['P-001']),
  card('P-001', 'product', 'in-progress', 10, ['F-001', ...taskIds]),
];

describe('decideTick — the task loop', () => {
  it('stamps a backlog task into in-progress and dispatches implement', () => {
    const cards = [...story(['E-001']), task('E-001', 'backlog')];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'task-implement', skill: 'implement' });
    expect(action.kind === 'dispatch' && action.card?.id).toBe('E-001');
  });

  it('takes tasks in (order, then id)', () => {
    // Only `order` can decide this: E-002 sorts first by number and last by order.
    const cards = [...story(['E-001', 'E-002']), task('E-001', 'backlog', 20), task('E-002', 'backlog', 10)];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'dispatch', card: { id: 'E-002' } });
  });

  // THE OTHER HALF OF THE NAME ABOVE, and it was missing. That test varies `order` alone, so the
  // comparator's tie-break was held by nothing here: inverting it left this file green while
  // `position.test.ts` and `service-act.test.ts` both went red. A test named for two rules has to
  // exercise both, or the half nobody wrote is the half that regresses.
  //
  // Equal `order` is not a contrived fixture: the endpoint assigns the next order to every card a run
  // creates, and a break-down that creates two tasks in one round gives them the same number.
  it('breaks an equal order by id, so the queue is not left to sort stability', () => {
    // THE PRE-SORT ORDER COMES FROM THE PARENT'S `links`, not from this array: `childrenOf` maps over
    // `card.links`. So the story lists E-002 first, which is what makes a comparator returning 0 pick
    // E-002 and the id tie-break pick E-001. Listing the task cards in a different order proves
    // nothing — the first version of this test did exactly that and passed with the tie-break deleted.
    const cards = [...story(['E-002', 'E-001']), task('E-001', 'backlog', 10), task('E-002', 'backlog', 10)];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'dispatch', card: { id: 'E-001' } });
  });

  it('finishes one task before starting the next', () => {
    // The trace's own shape: E-001 goes all the way to done before E-002 is picked up.
    const cards = [...story(['E-001', 'E-002']), task('E-001', 'review', 10), task('E-002', 'backlog', 20)];
    const action = decideTick(input({ cards, runs: [work('implement')] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'task-review', card: { id: 'E-001' } });
  });

  it('dispatches implement for a task in in-progress with no verdict on record', () => {
    // A crashed dispatch left it there; it has not been sent back, so it is still implement's phase.
    const cards = [...story(['E-001']), task('E-001', 'in-progress')];
    expect(decideTick(input({ cards, runs: [work('implement')] }))).toMatchObject({
      kind: 'dispatch',
      phase: 'task-implement',
    });
  });

  it('sends a task at the implement cap to review anyway', () => {
    // Section 5: the gates and the reviewer judge it. NOT blocked, and NOT a stop.
    const cards = [...story(['E-001']), task('E-001', 'in-progress')];
    const runs = threeRunsOf('E-001', 'engineering', 'implement');
    expect(decideTick(input({ cards, runs }))).toMatchObject({ kind: 'stamp', to: 'review' });
  });
});

describe('decideTick — the review loop', () => {
  it('reviews a task in review whose work run carries no verdict', () => {
    const cards = [...story(['E-001']), task('E-001', 'review')];
    const implement = work('implement');
    const action = decideTick(input({ cards, runs: [implement] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'task-review', skill: 'review' });
    // Told WHICH run it is judging, or it judges whatever else it can find on the card.
    expect(action.kind === 'dispatch' && action.previous).toBe(implement.run);
  });

  // "HAS THIS ALREADY BEEN DONE" — the row that stops a second judgement being paid for.
  it('re-stamps rather than re-judging a task whose verdict already passed', () => {
    const cards = [...story(['E-001']), task('E-001', 'review')];
    expect(decideTick(input({ cards, runs: [judged('implement', true)] }))).toMatchObject({
      kind: 'stamp',
      phase: 'task-review-remove',
      to: 'done',
    });
  });

  it('re-stamps a task whose verdict already failed back to in-progress', () => {
    const cards = [...story(['E-001']), task('E-001', 'review')];
    expect(decideTick(input({ cards, runs: [judged('implement', false)] }))).toMatchObject({
      kind: 'stamp',
      phase: 'task-review-remove',
      to: 'in-progress',
    });
  });

  // THE FIXTURE WITH TWO WORK RUNS, which is what tells the two rows apart. P4 asks whether the LATEST work
  // run carries a verdict; "the latest work run that carries one" is a different question, and every fixture
  // above has a single work run, so neither can distinguish them.
  //
  // The sequence is the ordinary one: implement, gates fail, fix, back to review. The fix has not been judged,
  // so it is the review's turn — reading the implement run's old failure as still outstanding would send the
  // card back to in-progress for another fix, and it would do so after every fix, until the cap blocked a task
  // whose gates had failed exactly once.
  it('reviews a task back in review after a fix, rather than re-stamping it on the old verdict', () => {
    const cards = [...story(['E-001']), task('E-001', 'review')];
    const failed = judged('implement', false);
    const fixed = work('fix');
    const action = decideTick(input({ cards, runs: [failed, fixed] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'task-review', skill: 'review' });
    // And it judges THE FIX, not the implement run that was already judged.
    expect(action.kind === 'dispatch' && action.previous).toBe(fixed.run);
  });

  it('dispatches fix for a task in in-progress with an outstanding failed verdict', () => {
    const cards = [...story(['E-001']), task('E-001', 'in-progress')];
    const failed = judged('implement', false);
    const action = decideTick(input({ cards, runs: [failed] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'task-fix', skill: 'fix' });
    // The run carrying the findings, so the fix is handed the evidence rather than told to look.
    expect(action.kind === 'dispatch' && action.previous).toBe(failed.run);
  });

  // ONE BUDGET FOR BOTH SEND-BACK KINDS. Two would let a task alternate and spend twice the cap.
  it('blocks a task that has used every fix attempt, and does not stop the loop', () => {
    const cards = [...story(['E-001', 'E-002']), task('E-001', 'in-progress'), task('E-002', 'backlog', 20)];
    const runs = [judged('implement', false), ...threeRunsOf('E-001', 'engineering', 'fix')];
    expect(decideTick(input({ cards, runs }))).toMatchObject({
      kind: 'stamp',
      phase: 'task-fix',
      to: 'blocked',
    });
  });

  it('spends the same fix budget whether the send-backs came from gates or from the reviewer', () => {
    // Two gate failures and one review send-back, each with its own fix run: the fourth attempt is blocked
    // rather than granted from a second budget.
    const cards = [...story(['E-001']), task('E-001', 'in-progress')];
    const runs = [
      judged('implement', false),
      run('E-001', 'engineering', 'fix', 'failed'),
      judged('fix', false),
      run('E-001', 'engineering', 'fix', 'failed'),
      answered('sent-back'),
      run('E-001', 'engineering', 'fix', 'failed'),
      judged('fix', false),
    ];
    expect(decideTick(input({ cards, runs }))).toMatchObject({ kind: 'stamp', to: 'blocked' });
  });

  // A REVIEW THAT CANNOT COMPLETE IS NOT A BLOCKED TASK (decision 51). It names the review.
  it('stops stalled naming the review when the review runs will not complete', () => {
    const cards = [...story(['E-001']), task('E-001', 'review')];
    const runs = [work('implement'), inconclusive(), inconclusive(), inconclusive()];
    const action = decideTick(input({ cards, runs }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('review');
    // It must NOT say the task is unfixable: a dead API key is not work nobody can fix.
    expect(detailOf(action)).not.toContain('blocked');
  });

  it('does not count three completed reviews towards that bound', () => {
    // Finding A, through the tick: `BURNS.success` is true, so a cap over every review run would stall a
    // perfectly healthy task at three.
    const cards = [...story(['E-001']), task('E-001', 'review')];
    const runs = [work('implement'), answered('done'), answered('sent-back'), answered('done')];
    expect(decideTick(input({ cards, runs }))).toMatchObject({ kind: 'dispatch', phase: 'task-review' });
  });

  // A REVIEW WHOSE VERDICT COULD NOT BE RECORDED re-reviews without limit, and the two bounds above both miss
  // it. The trigger asks whether the latest WORK run carries a verification, so a review that answered and
  // whose verdict the endpoint refused leaves that run exactly as it was: it is not inconclusive — it HAS a
  // verdict — and `dispatches: 1` resets the idle counter, so `MAX_IDLE_TICKS` never arrives either. The task
  // pays for a full review every tick for as long as the write keeps failing.
  it('stops stalled once a task has had every review its fix budget can justify', () => {
    const cards = [...story(['E-001']), task('E-001', 'review')];
    // Four reviews that each answered, and a work run still carrying no verdict: exactly the shape a verdict
    // that cannot be written leaves behind.
    const runs = [work('implement'), answered('done'), answered('done'), answered('done'), answered('done')];
    const action = decideTick(input({ cards, runs }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('E-001');
    expect(detailOf(action)).toContain('reviews');
    // NOT blocked: a verdict this server cannot write is not work nobody can fix.
    expect(detailOf(action)).not.toContain('blocked');
  });

  it('still allows the review a full fix budget entitles it to', () => {
    // `attemptCap + 1` is the healthy MAXIMUM rather than a margin — implement, a review and a fix for each
    // send-back, then the review that passes — so three spent must leave the fourth available.
    const cards = [...story(['E-001']), task('E-001', 'review')];
    const runs = [work('implement'), answered('sent-back'), answered('sent-back'), answered('sent-back')];
    expect(decideTick(input({ cards, runs }))).toMatchObject({ kind: 'dispatch', phase: 'task-review' });
  });
});

describe('decideTick — finding D: complete with a blocked task', () => {
  const closed = (taskCards: Card[]): Card[] => [
    card('F-001', 'features', 'done', 10, ['P-001']),
    card('P-001', 'product', 'done', 10, ['F-001', ...taskCards.map((c) => c.id)]),
    ...taskCards,
  ];

  // CHANGE 2: blocked tasks leave the `unfinished` set, or `complete` stays unreachable exactly as before.
  it('reports complete when the only unfinished card is a blocked task', () => {
    const cards = closed([task('E-001', 'blocked'), task('E-002', 'done', 20)]);
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'complete' });
  });

  it('names every blocked task in the complete detail', () => {
    const cards = closed([task('E-001', 'blocked'), task('E-002', 'done', 20), task('E-003', 'blocked', 30)]);
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'complete' });
    expect(detailOf(action)).toContain('E-001');
    expect(detailOf(action)).toContain('E-003');
    // "cards", not "tasks": a story can be blocked too, so the noun this sentence used to carry became a
    // lie the moment product got a blocked column.
    expect(detailOf(action)).toMatch(/2 cards are blocked/);
  });

  it('says nothing about blocked work when there is none', () => {
    const cards = closed([task('E-001', 'done')]);
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'complete' });
    expect(detailOf(action)).toBe('');
  });

  // CHANGE 4, and it exists because the other three open a false success.
  it('reports stalled, naming the task, for a board holding only a blocked task', () => {
    const action = decideTick(input({ cards: [task('E-001', 'blocked')] }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('E-001');
  });

  it('requires a live card in a terminal column, asserted, not implied', () => {
    // Every card archived except one blocked task: no terminal evidence, so never `complete`.
    const cards = [
      { ...card('F-001', 'features', 'archive', 10, []), archived: '2026-08-13T00:00:00Z' },
      task('E-001', 'blocked'),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'stalled' });
  });
});

// THE SAME FOUR CHANGES, ONE LEVEL UP (decision 45, corrected 2026-08-13). A blocked STORY settles, so it
// leaves `unfinished` — and taking anything out of that set is what opens a false success, which is why
// each piece is asserted on its own here rather than trusted to follow from the predicate. The cover
// check's half lives in test/autopilot-cover.test.ts, where the config it refuses can be built.
describe('decideTick — complete over a blocked story', () => {
  const blockedStory = (over: Partial<Card> = {}): Card => ({
    ...card('P-002', 'product', 'blocked', 20, ['F-001']),
    ...over,
  });

  // PIECE ONE: blocked stories leave the `unfinished` set. Without it `complete` is exactly as unreachable
  // as it was before the repeal — one redundant story, and every feature behind it is lost.
  it('reports complete when the only unsettled card is a blocked story', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001', 'P-002']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      blockedStory(),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'complete' });
  });

  it('names the blocked story in the complete detail, as a card rather than a task', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001', 'P-002']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      blockedStory(),
    ];
    const action = decideTick(input({ cards }));
    expect(detailOf(action)).toContain('P-002');
    expect(detailOf(action)).toMatch(/1 card is blocked/);
    // The noun is the point: a story is not a task, and this sentence is the whole visible part of the
    // repeal — the one thing telling a person what the project left behind.
    expect(detailOf(action)).not.toContain('task');
  });

  // PIECE TWO: `complete` still asserts its POSITIVE EVIDENCE. With blocked stories out of `unfinished`,
  // "every live card is terminal" stops being implied by "nothing unfinished and something live" — so a
  // board holding nothing but a blocked story would report the project finished.
  it('reports stalled, naming the story, for a board holding only a blocked story', () => {
    const action = decideTick(input({ cards: [blockedStory()] }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('P-002');
  });

  // The same claim with the evidence archived rather than absent, which is the shape that actually
  // happens: a project worked down to one story nobody could break down and then tidied up.
  it('does not count an archived feature as the finished work it needs', () => {
    const cards = [
      { ...card('F-001', 'features', 'archive', 10, []), archived: '2026-08-13T00:00:00Z' },
      blockedStory(),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({ kind: 'stop', reason: 'stalled' });
  });
});
