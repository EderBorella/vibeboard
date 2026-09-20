import { describe, expect, it } from 'vitest';
import type { Spend } from '../src/core/accounting.js';
import type { TickAction } from '../src/core/actions.js';
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

  // THE ERROR, QUOTED FROM THE RECORD. A dead credential and a working directory that no longer exists read
  // identically once the specifics are dropped, and they need different fixes — the day before the run above,
  // a box pointing at a deleted working directory produced "the README may be too thin to derive from" about a
  // README nothing had opened. TWO NOTES over one board, because a single fixture cannot tell a sentence that
  // quotes the record from one that hard-codes the error it happened to be written against.
  it('quotes whatever the runs actually said', () => {
    expect(detailOf(decideTick(input({ runs: twice() })))).toContain(DEAD_NOTE);
    const gone = 'The agent never reached a model: chdir /work: no such file or directory (exit code 1).';
    const elsewhere = twice().map((r) => ({ ...r, note: gone }));
    expect(detailOf(decideTick(input({ runs: elsewhere })))).toContain(gone);
  });

  // IT PRESCRIBES NO REMEDY, and this is a regression rather than a preference about wording. The sentence used
  // to end `Check Settings — the state light reports a stale credential, and "Rebuild the agent boxes" there
  // replaces the boxes these runs are dying in`, and on 2026-08-16 both halves of that were false at once: the
  // OAuth session had expired and could not be refreshed, so nothing was wrong with the box and rebuilding it
  // would have fixed nothing, and the light was reporting the project online. The user read the contradiction
  // and did not press the button — the right call, reached only by distrusting us.
  it('does not tell the reader to rebuild the agent boxes', () => {
    const detail = detailOf(decideTick(input({ runs: twice() })));
    expect(detail).not.toContain('Rebuild the agent boxes');
    expect(detail).not.toContain('stale credential');
  });

  // WHERE THE EVIDENCE IS, which is all this stop can honestly offer: it knows that nothing reached a model and
  // not which part of the machine is at fault. And what to do afterwards, because the streak is measured from
  // when auto-pilot last STARTED — without that clause the stop describes a state with no way out of it.
  it('points at the runs and the light, and says to press Start afterwards', () => {
    const detail = detailOf(decideTick(input({ runs: twice() })));
    expect(detail).toContain('the runs themselves');
    expect(detail).toContain('the light in the top bar');
    expect(detail).toContain('Press Start');
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

  // AND THE STORY'S JUDGEMENT DOES NOT BLOCK ITS CARD. Only a break-down does: a judging point that will
  // not close is about work already delivered, so there is nothing "waiting for a person" about the story
  // itself. Pinned, or adding a phase to that list later would be a silent change of behaviour.
  it('stops stalled, rather than blocking the story, when its judgement will not complete', () => {
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
    ];
    const action = decideTick(input({ cards, runs: threeRunsOf('P-001', 'product', 'review-story') }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('review');
    expect(detailOf(action)).not.toContain('blocked');
  });

  it('dispatches story-review once every task is settled', () => {
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001', 'E-002']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
      card('E-002', 'engineering', 'blocked', 20, ['P-001']),
    ];
    expect(decideTick(input({ cards }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-review',
      skill: 'review-story',
    });
  });

  // THE STORY JUDGEMENT'S CREATING ROUND IS BOUNDED TOO, and it looked as though it needed no bound: ruling
  // 54 makes creating siblings and closing the story ONE act, so there is no second visit to this point —
  // while the exit stamp succeeds. A REFUSED move leaves the story settled and in `in-progress`, and the
  // next tick dispatched another judgement with a fresh creating round, up to `attemptCap` of them, each
  // entitled to create more siblings.
  it('stops stalled when the story judgement has spent its creating round and still will not close', () => {
    const creating = run('P-001', 'product', 'review-story', 'success');
    const second = run('P-001', 'product', 'review-story', 'attention');
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
    // The noun matters: this is the story's judging point, not the feature's.
    expect(detailOf(action)).toContain('close the story');
  });

  it('still dispatches the story judgement that follows the creating round, so it can close', () => {
    const creating = run('P-001', 'product', 'review-story', 'success');
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
      { ...card('P-002', 'product', 'done', 20, ['F-001']), createdBy: creating.run },
    ];
    expect(decideTick(input({ cards, runs: [creating] }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-review',
    });
  });

  // AND A SEND-BACK THAT WAS ANSWERED IS NOT A SECOND ASK (decision 81). Decision 80 gave the judgement an
  // `exitFail`, so a second review is now the ORDINARY path — and the seeded `review-story` skill lets one
  // run create a sibling and send the story back together. The bound above then fired on a story that was
  // making progress, with two of its three fix attempts still unspent, and stopped the whole project.
  //
  // THE FIX RUN BETWEEN THEM IS WHAT SEPARATES THE TWO CASES, and a feature has no fix phase at all — which
  // is what leaves the feature checkup's bound exactly where decision 47 put it.
  it('judges a story again after a fix answered the send-back, creating round or not', () => {
    const creating = answered('sent-back');
    const fix = run('P-001', 'product', 'fix', 'success');
    const second = answered('sent-back');
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
      { ...card('P-002', 'product', 'done', 20, ['F-001']), createdBy: creating.run },
    ];
    expect(decideTick(input({ cards, runs: [creating, fix, second] }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-review',
    });
  });

  // THE FIXTURE MUST HAVE TWO TASKS: with one, "all settled" and "any settled" are the same answer.
  it('does not dispatch story-review while one of two tasks is unsettled', () => {
    const cards = [
      feature(['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001', 'E-002']),
      card('E-001', 'engineering', 'done', 10, ['P-001']),
      card('E-002', 'engineering', 'in-progress', 20, ['P-001']),
    ];
    const action = decideTick(input({ cards }));
    expect(action.kind === 'dispatch' && action.phase).not.toBe('story-review');
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

// THE STORY'S OWN WORK RUNS: its break-down, the implement that does the tasks under it (decision 83) and
// the fix that answers a send-back. All three are `bounded: 'skill'` phases on product, which is what
// `isWorkRun` reads — so these are what a story-level verdict lands on and what `latestWorkRun` answers
// with. There is no engineering equivalent any more: no phase sits on that board.
type StorySkill = 'break-down' | 'implement-story' | 'fix';

const storyWork = (skill: StorySkill, cardId = 'P-001'): RunRecord =>
  run(cardId, 'product', skill, 'success');

const storyJudged = (skill: StorySkill, passed: boolean, cardId = 'P-001'): RunRecord =>
  withVerification(storyWork(skill, cardId), gates(passed));

// A judgement that answered, and one that did not. Only the second kind counts towards the review bound.
const answered = (verdict: 'done' | 'sent-back', cardId = 'P-001'): RunRecord => ({
  ...run(cardId, 'product', 'review-story', 'success'),
  verdict,
});
const inconclusive = (cardId = 'P-001'): RunRecord => run(cardId, 'product', 'review-story', 'failed');

// A JUDGEMENT CARRYING ITS OWN VERDICT, which is where one goes when the story has no work run to hang it
// on (decision 81). `by` is the run itself, exactly as `reviewStory` writes it in that case.
const selfRecorded = (passed: boolean, cardId = 'P-001'): RunRecord => {
  const judging = answered(passed ? 'done' : 'sent-back', cardId);
  return withVerification(judging, {
    mode: 'review',
    passed,
    at: 'T',
    by: judging.run,
    ...(passed ? {} : { reason: 'the flag is not parsed' }),
  });
};

// The story that owns the tasks, in progress with its break-down done.
const story = (taskIds: string[]): Card[] => [
  card('F-001', 'features', 'in-progress', 10, ['P-001']),
  card('P-001', 'product', 'in-progress', 10, ['F-001', ...taskIds]),
];

// THE IDS OF THE TASKS ONE DISPATCH WAS ASKED FOR, which is the whole subject below: the group is what
// makes "one run per story" different from "one run per task" with the same phase name on it.
const groupOf = (action: TickAction): string[] =>
  action.kind === 'dispatch' ? (action.group?.cards ?? []).map((c: Card) => c.id) : [];

describe("decideTick — the story's work", () => {
  it("dispatches the story's implement, and asks it for the task in the backlog", () => {
    const cards = [...story(['E-001']), task('E-001', 'backlog')];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-implement', skill: 'implement-story' });
    // THE STORY, not the task. A run scoped to one task is what decision 83 costs out of the machine.
    expect(action.kind === 'dispatch' && action.card?.id).toBe('P-001');
    expect(groupOf(action)).toEqual(['E-001']);
  });

  // THE TWO COLUMNS COME FROM THE TICK, because deciding which slug means "being worked" and which means
  // "finished" is the machine's job and the executor holds no decisions of its own. `settled` is read off
  // the config's own `terminal` list rather than written here.
  it('names where the tasks are claimed and where they are settled', () => {
    const cards = [...story(['E-001']), task('E-001', 'backlog')];
    const action = decideTick(input({ cards }));
    expect(action.kind === 'dispatch' && action.group).toMatchObject({
      entry: 'in-progress',
      settled: 'done',
    });
  });

  // AND THE FIXTURE ABOVE CANNOT TELL THE CONFIG FROM THE LITERAL, because `DEFAULT_AUTOPILOT` calls the
  // terminal column `done`: replacing the lookup with `'done'` passed the whole suite. A board that names
  // another one distinguishes them — in BOTH directions, which is the half a `settled` assertion alone
  // misses: `done` is then an ordinary column, so a task sitting in it is outstanding work and joins the
  // group like any other.
  it('reads the settled column off the config, on a board whose terminal column is not done', () => {
    const ap = {
      ...DEFAULT_AUTOPILOT,
      terminal: { ...DEFAULT_AUTOPILOT.terminal, engineering: ['shipped'] },
    };
    const columns = { ...COLUMNS, engineering: [...COLUMNS.engineering, 'shipped'] };
    const cards = [...story(['E-001', 'E-002']), task('E-001', 'backlog', 10), task('E-002', 'done', 20)];
    const action = decideTick(input({ ap, cards, columns }));
    expect(action.kind === 'dispatch' && action.group).toMatchObject({
      entry: 'in-progress',
      settled: 'shipped',
    });
    expect(groupOf(action)).toEqual(['E-001', 'E-002']);
  });

  // THE FALL-THROUGH, which no fixture had ever observed. A board on which nothing can finish is refused
  // before a project starts (`checkTerminal` in core/autopilot-cover.ts) and a hand-edited config still
  // reaches here, so the branch is real — and what it must not do is guess a column and settle tasks into
  // one nobody named.
  it('dispatches nothing when the config names no terminal column for engineering', () => {
    const ap = { ...DEFAULT_AUTOPILOT, terminal: { ...DEFAULT_AUTOPILOT.terminal, engineering: [] } };
    const cards = [...story(['E-001']), task('E-001', 'backlog')];
    const action = decideTick(input({ ap, cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('E-001');
  });

  it('takes tasks in (order, then id)', () => {
    // Only `order` can decide this: E-002 sorts first by number and last by order.
    const cards = [...story(['E-001', 'E-002']), task('E-001', 'backlog', 20), task('E-002', 'backlog', 10)];
    expect(groupOf(decideTick(input({ cards })))).toEqual(['E-002', 'E-001']);
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
    // `card.links`. So the story lists E-002 first, which is what makes a comparator returning 0 put
    // E-002 first and the id tie-break put E-001 there instead.
    const cards = [...story(['E-002', 'E-001']), task('E-001', 'backlog', 10), task('E-002', 'backlog', 10)];
    expect(groupOf(decideTick(input({ cards })))).toEqual(['E-001', 'E-002']);
  });

  // WHAT DECISION 83 CHANGES, in one assertion. This test read "finishes one task before starting the
  // next" and asserted a dispatch against E-001 alone: a task went all the way to done before the next was
  // picked up, at one cold start each. One run is given both.
  it('gives one run every unsettled task, rather than one at a time', () => {
    const cards = [
      ...story(['E-001', 'E-002']),
      task('E-001', 'in-progress', 10),
      task('E-002', 'backlog', 20),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-implement', card: { id: 'P-001' } });
    expect(groupOf(action)).toEqual(['E-001', 'E-002']);
  });

  // AND A SETTLED TASK IS NOT WORK. A run is asked for what is outstanding and nothing else, or a story
  // dispatched twice would pay for the first group's work again in the second.
  it('leaves out a task that is already done, and one that is blocked', () => {
    const cards = [
      ...story(['E-001', 'E-002', 'E-003']),
      task('E-001', 'done', 10),
      task('E-002', 'blocked', 20),
      task('E-003', 'backlog', 30),
    ];
    expect(groupOf(decideTick(input({ cards })))).toEqual(['E-003']);
  });

  // A TASK THE OLD MACHINE LEFT IN `review`, which is every board mid-flight when the judgement moved up.
  // It used to be stamped `done` on the strength of its column alone; there is no per-task row to stamp it
  // from now, and `review` is neither terminal nor blocked — so it is outstanding work, and the story's run
  // is given it like any other task. A run handed work that has already landed says so and costs a reading
  // of one card; leaving it unsettled would make its story unjudgeable for ever.
  it('gives a task the old machine left in review to the story’s run, rather than stranding it', () => {
    const cards = [...story(['E-001']), task('E-001', 'review')];
    const action = decideTick(input({ cards, runs: [storyWork('break-down')] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-implement' });
    expect(groupOf(action)).toEqual(['E-001']);
  });

  it('gives a task a person dragged into review the same treatment, with no run on the board at all', () => {
    const cards = [...story(['E-001']), task('E-001', 'review')];
    expect(groupOf(decideTick(input({ cards })))).toEqual(['E-001']);
  });

  it('dispatches the story’s implement for a task a crashed run left in in-progress', () => {
    const cards = [...story(['E-001']), task('E-001', 'in-progress')];
    const action = decideTick(input({ cards, runs: [storyWork('break-down')] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-implement' });
    expect(groupOf(action)).toEqual(['E-001']);
  });

  // THE LOOP'S OWN CORRECTNESS REFUSAL, one level up. A run that left nothing behind earns a failed verdict
  // (`recordEmptyRun` in service/act/outcomes.ts), and that verdict now lands on the STORY's own run. It
  // does not buy a fix: the tasks are still outstanding, so the story's implement is what is dispatched
  // again, under its own cap — a fix handed a run that produced nothing has no finding to address.
  it('retries the story’s implement when a run left nothing behind, rather than spending a fix', () => {
    const cards = [...story(['E-001']), task('E-001', 'in-progress')];
    const empty = storyJudged('implement-story', false);
    const action = decideTick(input({ cards, runs: [empty] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-implement', skill: 'implement-story' });
  });

  // AT THE CAP THE STORY IS BLOCKED AND THE LOOP CARRIES ON (decision 45). The per-task implement it
  // replaces settled its task instead and let the gates and the judge take it as it stood — there is no
  // card below the story to settle now, and a story sits among siblings exactly as a task did, so blocking
  // costs one story where stopping costs every feature queued behind it.
  it('blocks a story that has used every implement attempt, and does not stop the loop', () => {
    const cards = [...story(['E-001']), task('E-001', 'in-progress')];
    const runs = threeRunsOf('P-001', 'product', 'implement-story');
    const action = decideTick(input({ cards, runs }));
    expect(action).toMatchObject({ kind: 'stamp', phase: 'story-implement', to: 'blocked' });
    // The clause is this branch's own: "nothing under it" is the break-down's, and a shared phrase is how
    // a phase added to the blocking list once changed the answer with no test able to tell.
    expect(action.kind === 'stamp' && action.why).toContain('still has tasks nothing has finished');
  });

  // RULING 59 AT THE NEW BLOCKING POINT. Product gained its blocked column on 2026-08-13 with no migration,
  // and a column IS a folder — so an unguarded stamp does not fail, it creates a folder `readBoard` never
  // looks in and the story disappears. Every caller of the blocking branch has to ask, which is why one
  // function asks it.
  it('stops stalled, naming the missing column, rather than blocking a story on a board without one', () => {
    const cards = [...story(['E-001']), task('E-001', 'in-progress')];
    const runs = threeRunsOf('P-001', 'product', 'implement-story');
    const action = decideTick(input({ cards, runs, columns: WITHOUT_PRODUCT_BLOCKED }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('P-001');
    expect(detailOf(action)).toContain('no blocked column');
    expect(detailOf(action)).toContain('Add a blocked column');
  });

  // THE SAME ARGUMENT AT THE TWO COLUMNS THE GROUP NAMES (decision 84). The tick now decides where a task is
  // claimed and where it is settled, and neither was guarded: a column IS a folder, so a stamp into one the
  // board has not got creates it and hides the task, and a REFUSED claim answers `dispatches: 0` — the shape
  // that leaves earlier tasks claimed and lets the next tick decide the same thing until `MAX_IDLE_TICKS`
  // ends the project without naming any of this.
  it('stops stalled when the engineering board has no column to claim a task into', () => {
    const cards = [...story(['E-001']), task('E-001', 'backlog')];
    const columns = { ...COLUMNS, engineering: ['backlog', 'review', 'blocked', 'done'] };
    const action = decideTick(input({ cards, columns }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('P-001');
    expect(detailOf(action)).toContain('in-progress');
  });

  // AND IT IS ASKED AFTER THE CAP, never before it: a story with no attempts left is BLOCKED, and blocking
  // uses neither of these columns. Asked first, a board missing one would stop the whole project over a
  // card that was about to be settled and carried on from (decision 82).
  it('blocks a story at its cap even where the group columns are missing', () => {
    const cards = [...story(['E-001']), task('E-001', 'backlog')];
    const columns = { ...COLUMNS, engineering: ['backlog', 'review', 'blocked'] };
    const runs = threeRunsOf('P-001', 'product', 'implement-story');
    const action = decideTick(input({ cards, columns, runs }));
    expect(action).toMatchObject({ kind: 'stamp', phase: 'story-implement', to: 'blocked' });
  });

  // AND THE OTHER ONE, which is the settled column off the config rather than a slug written in the tick —
  // so this fires for a board that never had it and for a `terminal` naming one that has been renamed.
  it('stops stalled when the engineering board has no column to settle a task in', () => {
    const cards = [...story(['E-001']), task('E-001', 'backlog')];
    const columns = { ...COLUMNS, engineering: ['backlog', 'in-progress', 'review', 'blocked'] };
    const action = decideTick(input({ cards, columns }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('done');
  });
});

// THE CEILING ON WHAT ONE RUN IS ASKED FOR, and the thing it exists to stop: the experiment measured three
// tasks and eighteen turns, which is the cheap part of the cost-per-turn curve. A story with eight tasks is
// a run nobody has costed, so it is dispatched in groups instead of bundled.
describe('decideTick — how much work one run is given', () => {
  const many = (n: number): Card[] => [
    card('F-001', 'features', 'in-progress', 10, ['P-001']),
    card('P-001', 'product', 'in-progress', 10, [
      'F-001',
      ...Array.from({ length: n }, (_, i) => `E-00${i + 1}`),
    ]),
    ...Array.from({ length: n }, (_, i) => task(`E-00${i + 1}`, 'backlog', (i + 1) * 10)),
  ];

  it('gives one run every task of a story that is under the ceiling', () => {
    expect(groupOf(decideTick(input({ cards: many(5) })))).toEqual([
      'E-001',
      'E-002',
      'E-003',
      'E-004',
      'E-005',
    ]);
  });

  it('gives a bigger story the first group only, and leaves the rest for the next run', () => {
    const action = decideTick(input({ cards: many(7) }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-implement' });
    expect(groupOf(action)).toEqual(['E-001', 'E-002', 'E-003', 'E-004', 'E-005']);
    expect(groupOf(action)).not.toContain('E-006');
    expect(groupOf(action)).not.toContain('E-007');
  });

  // AND THE SECOND GROUP IS WHAT IS LEFT. The board is the whole of the state: the first group is settled
  // when its run succeeds, and what is still outstanding is the next run's.
  it('gives the next run what the first group left', () => {
    const cards = many(7).map((c) =>
      ['E-001', 'E-002', 'E-003', 'E-004', 'E-005'].includes(c.id) ? { ...c, columnSlug: 'done' } : c,
    );
    expect(groupOf(decideTick(input({ cards })))).toEqual(['E-006', 'E-007']);
  });
});

// PROGRESSING IS NOT RETRYING, AND THE CAP IS ONLY ALLOWED TO STOP THE SECOND (decision 84). Every run that
// succeeds burns an attempt (`burnsAttempt`), and `capReached` counts them against the STORY for one skill —
// so before this the hard ceiling on a story was `TASKS_PER_RUN × attemptCap` tasks, and a sixteen-task story
// whose every group SUCCEEDED was blocked on its fourth: fifteen tasks delivered, the sixteenth stranded,
// `story-review` never reached, so the gates never ran and nothing judged any of it.
describe('decideTick — a story bigger than one cap can pay for', () => {
  // `n` tasks under the story, the first `settled` of them delivered. Ids are PADDED: `E-00${i + 1}` runs
  // out at nine, and every board this is about is bigger than that.
  const bigStory = (n: number, settled: number): Card[] => {
    const ids = Array.from({ length: n }, (_, i) => `E-${String(i + 1).padStart(3, '0')}`);
    return [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', ...ids]),
      ...ids.map((id, i) =>
        card(id, 'engineering', i < settled ? 'done' : 'backlog', (i + 1) * 10, ['P-001']),
      ),
    ];
  };

  const groupRuns = (n: number): RunRecord[] => Array.from({ length: n }, () => storyWork('implement-story'));

  // THE REGRESSION ITSELF, at the smallest board that shows it: sixteen tasks, three groups delivered, and
  // every one of those runs a success. Fifteen is `TASKS_PER_RUN × attemptCap` and closed perfectly well.
  it('gives a sixteen-task story its fourth group, having delivered the first three', () => {
    const action = decideTick(input({ cards: bigStory(16, 15), runs: groupRuns(3) }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-implement', card: { id: 'P-001' } });
    expect(groupOf(action)).toEqual(['E-016']);
  });

  // AND AT `attemptCap: 1`, which is legal and made the ceiling six. Nothing about the size of a story is
  // the cap's business, and one attempt per group is what one attempt was always meant to mean.
  it('gives a six-task story its second group under an attempt cap of one', () => {
    const ap = { ...DEFAULT_AUTOPILOT, attemptCap: 1 };
    const action = decideTick(input({ ap, cards: bigStory(6, 5), runs: groupRuns(1) }));
    expect(groupOf(action)).toEqual(['E-006']);
  });

  // THE OTHER DIRECTION, and it is what keeps the cap a cap: the budget is `attemptCap` runs that delivered
  // NOTHING, whatever has been delivered before them. Three groups delivered plus three barren runs is six.
  it('blocks a story whose runs stop delivering, however much it delivered before', () => {
    const action = decideTick(input({ cards: bigStory(16, 15), runs: groupRuns(6) }));
    expect(action).toMatchObject({ kind: 'stamp', phase: 'story-implement', to: 'blocked' });
  });

  // TERMINATION, ASSERTED RATHER THAN ARGUED. A run that succeeds and settles nothing is the shape that
  // could loop for ever under a rule that forgave every success, so the driver here is exactly that run:
  // the record is written, the board does not move, and the machine has to reach `blocked` on its own.
  it('stops asking for a group that never lands, rather than dispatching for ever', () => {
    const cards = bigStory(16, 15);
    const runs = groupRuns(3);
    const seen: TickAction[] = [];
    for (let i = 0; i < 20; i++) {
      const action = decideTick(input({ cards, runs }));
      seen.push(action);
      if (action.kind !== 'dispatch') break;
      runs.push(storyWork('implement-story')); // it succeeded, and settled nothing
    }
    expect(seen.at(-1)).toMatchObject({ kind: 'stamp', phase: 'story-implement', to: 'blocked' });
    expect(seen.filter((a) => a.kind === 'dispatch')).toHaveLength(DEFAULT_AUTOPILOT.attemptCap);
  });

  // AND THE SENTENCE NAMES THE ALLOWANCE THE STORY REALLY HAD. "used all 3 attempts" after six runs — three
  // of which delivered five tasks each — is the stop describing something that did not happen, which this
  // repository treats as worse than no sentence at all.
  it('names the attempts the story actually had, not the configured cap', () => {
    const action = decideTick(input({ cards: bigStory(16, 15), runs: groupRuns(6) }));
    expect(action.kind === 'stamp' && action.why).toContain('all 6 attempts at implement-story');
  });
});

// THE STORY'S JUDGEMENT, WHERE THE REVIEW LIVES SINCE DECISION 80. A story with one settled task under it
// is at its judging point, and which of P4, P4r and P5 that position is in is answered from the RECORD —
// product has no column meaning "awaiting judgement" and the format is frozen.
const settledStory = (): Card[] => [
  card('F-001', 'features', 'in-progress', 10, ['P-001']),
  card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
  task('E-001', 'done'),
];

describe('decideTick — the story judgement', () => {
  it('judges a story whose work run carries no verdict', () => {
    const brokeDown = storyWork('break-down');
    const action = decideTick(input({ cards: settledStory(), runs: [brokeDown] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-review', skill: 'review-story' });
    // The verdict has to land on a run, and it is told which — the same lookup P4r reads back.
    expect(action.kind === 'dispatch' && action.previous).toBe(brokeDown.run);
  });

  // A STORY WITH NO WORK RUN OF ITS OWN is still judged: one whose tasks were made by hand, or one that
  // skipped its break-down because it arrived with them attached, has no record to name — and refusing
  // would leave it unsettled for ever over a run nobody ever wrote.
  it('judges a story that has no work run of its own, naming none', () => {
    const action = decideTick(input({ cards: settledStory() }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-review' });
    expect(action.kind === 'dispatch' && action.previous).toBeUndefined();
  });

  // AND WHEN THE GATES REFUSED IT THERE IS NO RECORD OF EITHER KIND (decision 82) — the half decision 81
  // left open and named. The gates run before any dispatch, so a story with no work run whose gates fail has
  // no review run either: the verdict went nowhere, `exitFail` named the column the story already stood in,
  // and nothing was dispatched. Every later tick decided the same thing and re-ran the whole gate suite,
  // until `MAX_IDLE_TICKS` ended the PROJECT over one card it had a budget to fix.
  it('fixes a story whose gates failed with no record anywhere on the card to say so', () => {
    const action = decideTick(input({ cards: settledStory(), unrecordedSendBacks: ['P-001'] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-fix', skill: 'fix' });
    // NO `previous`: there is no run on this card, which is the whole of what this branch is about. The fix
    // is handed the gate commands in its prompt and runs them itself.
    expect(action.kind === 'dispatch' && action.previous).toBeUndefined();
  });

  // AND IT IS THE NARROWEST POSSIBLE BRANCH. The moment the card carries a record, that record is the
  // answer — otherwise a fact true of one tick would send a story back on a finding a fix had already
  // answered, for the rest of the session.
  it('judges a story named as unrecorded once it has a work run to read instead', () => {
    const brokeDown = storyWork('break-down');
    const action = decideTick(
      input({ cards: settledStory(), runs: [brokeDown], unrecordedSendBacks: ['P-001'] }),
    );
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-review' });
    expect(action.kind === 'dispatch' && action.previous).toBe(brokeDown.run);
  });

  it('judges a story named as unrecorded once its review carries the verdict instead', () => {
    const refused = selfRecorded(false);
    const action = decideTick(
      input({ cards: settledStory(), runs: [refused], unrecordedSendBacks: ['P-001'] }),
    );
    // The review's own verdict is a record, so P5 is reached through it and the fix is handed the findings.
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-fix' });
    expect(action.kind === 'dispatch' && action.previous).toBe(refused.run);
  });

  // ANOTHER STORY'S GATE FAILURE IS NOT THIS ONE'S. Keyed by card id, and a fixture naming a different card
  // is what tells "the loop remembered something" from "the loop remembered THIS".
  it('judges a story when the unrecorded send-back belongs to another card', () => {
    const action = decideTick(input({ cards: settledStory(), unrecordedSendBacks: ['P-009'] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-review' });
  });

  // AND THAT JUDGEMENT HAS SOMEWHERE TO LAND (decision 81). The review run is itself a record, so a story
  // with none of its own carries the verdict on the review that gave it. Without that the send-back was
  // written nowhere: every later tick read no verdict, dispatched the judgement again, and `story-fix` was
  // unreachable — four paid reviews for one answer, and then a project-wide stop over a card the loop had a
  // budget to fix.
  it('fixes a story the review sent back when the verdict is on the review run itself', () => {
    const refused = selfRecorded(false);
    const action = decideTick(input({ cards: settledStory(), runs: [refused] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-fix', skill: 'fix' });
    // The findings are on the review, so the review is what the fix is handed.
    expect(action.kind === 'dispatch' && action.previous).toBe(refused.run);
  });

  // P4r THROUGH THE SAME LOOKUP: a judgement that passed and whose move failed is re-stamped rather than
  // paid for twice, whichever record the verdict ended up on.
  it('re-stamps a story whose review passed it with the verdict on the review run itself', () => {
    expect(decideTick(input({ cards: settledStory(), runs: [selfRecorded(true)] }))).toMatchObject({
      kind: 'stamp',
      phase: 'story-review',
      to: 'done',
    });
  });

  // AND THE WORK RUN WINS THE MOMENT THERE IS ONE, which is what pins the ORDER of the two lookups. Read the
  // other way round the story would be fixed again after every fix, on a send-back the fix had answered.
  it('judges the fix rather than the review once a fix has answered the send-back', () => {
    const fixed = storyWork('fix');
    const action = decideTick(input({ cards: settledStory(), runs: [selfRecorded(false), fixed] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-review' });
    expect(action.kind === 'dispatch' && action.previous).toBe(fixed.run);
  });

  // AND THE BUDGET IS THE CARD'S. A send-back recorded on the review spends the same three fixes as one
  // recorded on a work run, and running out leaves the STORY blocked with the loop carrying on.
  it('blocks a story sent back by a review-carried verdict once its fix budget is spent', () => {
    const runs = [
      selfRecorded(false),
      run('P-001', 'product', 'fix', 'failed'),
      run('P-001', 'product', 'fix', 'failed'),
      storyJudged('fix', false),
    ];
    expect(decideTick(input({ cards: settledStory(), runs }))).toMatchObject({
      kind: 'stamp',
      phase: 'story-fix',
      to: 'blocked',
    });
  });

  // THE OTHER HALF OF RULING 59, and it was missing here. `capReached` refuses to stamp a column the board
  // has not got; `fixPhase` stamped it unconditionally, which was harmless while `fix` was engineering-only
  // and is not now that `story-fix` puts one on PRODUCT — the board with no migration. A column is a folder,
  // so the stamp did not fail: it created one product's config does not name and the story vanished from
  // `readBoard`, reported as `Unknown column` every tick in place of the remedy.
  it('stops stalled, naming the missing column, rather than blocking a story on a board without one', () => {
    const runs = [
      storyJudged('break-down', false),
      run('P-001', 'product', 'fix', 'failed'),
      run('P-001', 'product', 'fix', 'failed'),
      storyJudged('fix', false),
    ];
    const action = decideTick(input({ cards: settledStory(), runs, columns: WITHOUT_PRODUCT_BLOCKED }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('P-001');
    expect(detailOf(action)).toContain('no blocked column');
    expect(detailOf(action)).toContain('Add a blocked column');
  });

  // "HAS THIS ALREADY BEEN DONE" — the row that stops a second judgement being paid for.
  it('re-stamps rather than re-judging a story whose verdict already passed', () => {
    const runs = [storyJudged('break-down', true)];
    expect(decideTick(input({ cards: settledStory(), runs }))).toMatchObject({
      kind: 'stamp',
      phase: 'story-review',
      to: 'done',
    });
  });

  it('fixes a story whose verdict already failed, rather than judging it again', () => {
    const refused = storyJudged('break-down', false);
    const action = decideTick(input({ cards: settledStory(), runs: [refused] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-fix', skill: 'fix' });
    // The run carrying the findings, so the fix is handed the evidence rather than told to look.
    expect(action.kind === 'dispatch' && action.previous).toBe(refused.run);
  });

  // THE FIXTURE WITH TWO WORK RUNS, which is what tells P4 from P5 at all. P4 asks whether the LATEST work
  // run carries a verdict; "the latest work run that carries one" is a different question, and every
  // fixture above has a single work run, so neither can distinguish them.
  //
  // The sequence is the ordinary one: the story is refused, a fix answers it, and the fix has not been
  // judged — so it is the judgement's turn. Reading the send-back's failure as still outstanding would
  // dispatch another fix after every fix, until the cap blocked a story that was refused exactly once.
  it('judges a story again after a fix, rather than reading the old verdict as outstanding', () => {
    const refused = storyJudged('break-down', false);
    const fixed = storyWork('fix');
    const action = decideTick(input({ cards: settledStory(), runs: [refused, fixed] }));
    expect(action).toMatchObject({ kind: 'dispatch', phase: 'story-review', skill: 'review-story' });
    // And it judges THE FIX, not the run that was already judged.
    expect(action.kind === 'dispatch' && action.previous).toBe(fixed.run);
  });

  // ONE BUDGET FOR BOTH SEND-BACK KINDS. Two would let a story alternate and spend twice the cap.
  //
  // THE LAST FIX CARRIES THE VERDICT, and that is the fixture rather than a detail: a fix run with no
  // verdict on it is the JUDGEMENT's turn, not another fix — so three bare fix runs would be dispatched a
  // review, which is the healthy cycle and not this bound. The cap is reached on the send-back after the
  // third fix.
  it('blocks a story that has used every fix attempt, and does not stop the loop', () => {
    const runs = [
      storyJudged('break-down', false),
      run('P-001', 'product', 'fix', 'failed'),
      run('P-001', 'product', 'fix', 'failed'),
      storyJudged('fix', false),
    ];
    expect(decideTick(input({ cards: settledStory(), runs }))).toMatchObject({
      kind: 'stamp',
      phase: 'story-fix',
      to: 'blocked',
    });
  });

  it('spends the same fix budget whether the send-backs came from gates or from the judge', () => {
    // Two gate failures and one judge send-back, each with its own fix run: the fourth attempt is blocked
    // rather than granted from a second budget.
    const runs = [
      storyJudged('break-down', false),
      run('P-001', 'product', 'fix', 'failed'),
      storyJudged('fix', false),
      run('P-001', 'product', 'fix', 'failed'),
      answered('sent-back'),
      run('P-001', 'product', 'fix', 'failed'),
      storyJudged('fix', false),
    ];
    expect(decideTick(input({ cards: settledStory(), runs }))).toMatchObject({
      kind: 'stamp',
      to: 'blocked',
    });
  });

  // A REVIEW THAT CANNOT COMPLETE IS NOT A BLOCKED CARD (decision 51). It names the review.
  it('stops stalled naming the review when the review runs will not complete', () => {
    const runs = [storyWork('break-down'), inconclusive(), inconclusive(), inconclusive()];
    const action = decideTick(input({ cards: settledStory(), runs }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('review');
    // It must NOT say the story is unfixable: a dead API key is not work nobody can fix.
    expect(detailOf(action)).not.toContain('blocked');
  });

  it('does not count three completed reviews towards that bound', () => {
    // Finding A, through the tick: `BURNS.success` is true, so a cap over every review run would stall a
    // perfectly healthy story at three.
    const runs = [storyWork('break-down'), answered('done'), answered('sent-back'), answered('done')];
    expect(decideTick(input({ cards: settledStory(), runs }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-review',
    });
  });

  // A REVIEW WHOSE VERDICT COULD NOT BE RECORDED re-reviews without limit, and the two bounds above both
  // miss it. The trigger asks whether the latest WORK run carries a verification, so a review that answered
  // and whose verdict the endpoint refused leaves that run exactly as it was: it is not inconclusive — it
  // HAS a verdict — and `dispatches: 1` resets the idle counter, so `MAX_IDLE_TICKS` never arrives either.
  // The story pays for a full review every tick for as long as the write keeps failing.
  it('stops stalled once a story has had every review its fix budget can justify', () => {
    // Four reviews that each answered, and a work run still carrying no verdict: exactly the shape a
    // verdict that cannot be written leaves behind.
    const runs = [
      storyWork('break-down'),
      answered('done'),
      answered('done'),
      answered('done'),
      answered('done'),
    ];
    const action = decideTick(input({ cards: settledStory(), runs }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('P-001');
    expect(detailOf(action)).toContain('reviews');
    // NOT blocked: a verdict this server cannot write is not work nobody can fix.
    expect(detailOf(action)).not.toContain('blocked');
  });

  it('still allows the review a full fix budget entitles it to', () => {
    // `attemptCap + 1` is the healthy MAXIMUM rather than a margin — the work, a review and a fix for each
    // send-back, then the review that passes — so three spent must leave the fourth available.
    const runs = [
      storyWork('break-down'),
      answered('sent-back'),
      answered('sent-back'),
      answered('sent-back'),
    ];
    expect(decideTick(input({ cards: settledStory(), runs }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-review',
    });
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

// THE FOCUS REACHES THE DERIVATION, and this is here rather than in test/focus.test.ts because that is the
// half that was missing: `derivePosition` honoured `ap.focus` and every one of its own tests passed with the
// TICK still calling it without one. Deleting the argument in core/lifecycle/tick.ts broke nothing at all.
//
// The claim is about the loop, so it is asserted through `decideTick` — the function the service calls.
describe('the feature the loop is focused on', () => {
  // CHILDLESS, so the action is a DISPATCH rather than the break-down skip a feature with stories gets
  // (decision 50). The subject here is which feature was chosen, and a stamp names it just as well — but a
  // dispatch is the case that spends money, so it is the one worth pinning.
  const twoFeatures = (): Card[] => [
    card('F-001', 'features', 'backlog', 10, []),
    card('F-002', 'features', 'backlog', 20, []),
  ];

  it('is the one dispatched, and not the one the queue would have picked', () => {
    // Unfocused, (order, id) picks F-001 — so naming F-002 is what proves the tick passed the focus on.
    const unfocused = decideTick(input({ cards: twoFeatures() }));
    expect(unfocused.kind === 'dispatch' && unfocused.card?.id).toBe('F-001');

    const focused = decideTick(input({ cards: twoFeatures(), ap: { ...DEFAULT_AUTOPILOT, focus: 'F-002' } }));
    expect(focused.kind === 'dispatch' && focused.card?.id).toBe('F-002');
  });

  it('stalls, naming the card, when the focused feature has left the board', () => {
    const action = decideTick(input({ cards: twoFeatures(), ap: { ...DEFAULT_AUTOPILOT, focus: 'F-404' } }));
    expect(action.kind).toBe('stop');
    expect(detailOf(action)).toMatch(/focused on F-404/);
    // AND NOTHING WAS DISPATCHED, which is the half that matters: a silent fallback would have been a run on
    // a card nobody chose, reported as an ordinary one.
    expect(action.kind === 'dispatch').toBe(false);
  });
});

// THE OUTCOME OF A FOCUSED RUN THAT FINISHED, and this describe exists because a LIVE run reported the wrong
// one. F-001 closed with its five stories and five tasks done and its smoke command passing, and the loop
// stopped `stalled` — "work remains and nothing it can do would move it" — over the one feature the focus had
// told it to leave. Every gate was green; no test asked what the outcome was.
describe('a focused run that finished its feature', () => {
  const done = (id: string, board: BoardName, columnSlug: string, links: string[] = []): Card =>
    card(id, board, columnSlug, 10, links);

  // F-001 finished, F-002 untouched in the backlog — the live board exactly.
  const finishedFocus = (): Card[] => [
    done('F-001', 'features', 'done', ['P-001']),
    done('P-001', 'product', 'done', ['F-001']),
    done('F-002', 'features', 'backlog'),
  ];

  const focusOn = (id: string, cards: Card[]) =>
    decideTick(input({ cards, ap: { ...DEFAULT_AUTOPILOT, focus: id } }));

  it('reports complete rather than stalled', () => {
    const action = focusOn('F-001', finishedFocus());
    expect(action.kind === 'stop' && action.reason).toBe('complete');
  });

  it('names the focus and says the rest of the board was left alone on purpose', () => {
    // The half a person acts on: a finished project with cards still in the backlog is indistinguishable
    // from an abandoned run unless the sentence says which it is.
    const detail = detailOf(focusOn('F-001', finishedFocus()));
    expect(detail).toMatch(/finished F-001/i);
    expect(detail).toMatch(/F-002/);
    expect(detail).toMatch(/left alone|untouched/i);
    expect(detail).toMatch(/clear the focus/i);
  });

  // POSITIVE EVIDENCE, never an implication — `finished`'s own rule, and the reason it exists: inferring
  // success from "nothing eligible" is how a board holding one blocked card came to report a project done.
  //
  // THE STATE THAT REACHES IT is a focused feature PARKED — in a column that is neither where work is picked
  // up (`backlog`/`todo`/`in-progress`) nor terminal. A project may add such a column, and a person may drag
  // a card into it. Then the feature is ineligible, so nothing dispatches and `nothingToWorkOn` is reached
  // with a focus whose feature is plainly not finished.
  //
  // A FIRST VERSION OF THIS TEST USED `todo` AND PROVED NOTHING: a focused feature in `todo` is eligible, so
  // the tick dispatched and never reached the check. Deleting the terminal-column guard left it green.
  it('does not claim success when the focused feature is parked rather than finished', () => {
    const withReview: Record<BoardName, string[]> = {
      ...COLUMNS,
      features: ['backlog', 'todo', 'in-progress', 'review', 'done'],
    };
    const parked = [
      done('F-001', 'features', 'review', ['P-001']),
      done('P-001', 'product', 'done', ['F-001']),
    ];
    const action = decideTick(
      input({ cards: parked, columns: withReview, ap: { ...DEFAULT_AUTOPILOT, focus: 'F-001' } }),
    );
    expect(action.kind === 'stop' && action.reason).not.toBe('complete');
  });

  // AND THE SAME BOARD WITH NO FOCUS CARRIES ON, which is what keeps this a focused-run rule rather than a
  // new way for any project to report success over work it has not done. F-002 is childless, so unfocused
  // the tick dispatches its break-down — the contrast is not stall-versus-complete but WORK versus done.
  //
  // The first version of this asserted `stalled` here, and it was wrong about the code rather than the other
  // way round: the live run stalled because the FOCUS made F-002 ineligible, not because F-002 was stuck.
  it('carries on with the untouched feature when nothing is focused', () => {
    const action = decideTick(input({ cards: finishedFocus() }));
    expect(action.kind).toBe('dispatch');
    expect(action.kind === 'dispatch' && action.card?.id).toBe('F-002');
  });
});
