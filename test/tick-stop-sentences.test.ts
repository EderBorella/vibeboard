import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import type { DeclaredCommands } from '../src/core/foundation.js';
import { decideTick } from '../src/core/lifecycle/tick.js';
import type { Card } from '../src/core/types.js';
import { base, card, detailOf, input, task } from './tick-fixtures.js';

// WHAT A PERSON READS WHEN THE LOOP STOPS — the half of the machine that lives in
// src/core/lifecycle/stop-sentences.ts. Asserted through `decideTick` rather than against the functions
// directly, because the sentence only matters where a stop carries it: a test calling `whyStuck` with a
// hand-built card list would pass over a branch that no board can reach.
//
// Most of these are pinning a CORRECTION. Every sentence here once named a mechanism the product no longer
// has — a routing table, the setup barrier, a blocked column that was said not to exist — and sent the
// reader to fix something that was fine. The `not.toContain` assertions are the load-bearing half.

describe('a cap that cannot bind names its own field', () => {
  // MOVED HERE FROM eligibility.ts WITH THE COMPARISON IT GUARDS. The tick counts every bound itself —
  // the bootstrap's attempts, and every phase's — so a cap that is not a number would delete the limit here
  // rather than in a module nothing calls any more. `used >= NaN` is false, so it fails open.
  it('stops stalled and names attemptCap when it is not a usable number', () => {
    const ap = { ...DEFAULT_AUTOPILOT, attemptCap: Number.NaN };
    const action = decideTick(input({ ap }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action).toHaveProperty('detail', expect.stringContaining('attemptCap'));
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

// WHY THE REMAINING WORK IS STUCK, per KIND of stuck — `whyStuck` and the buckets `partitionStuck` puts a
// card in. One list of ids with one piece of advice named cards the loop had itself blocked and then told
// the reader to check their routing table, which is advice that is wrong for them.
describe('why the remaining work is stuck', () => {
  // THE B3 SHAPE, and the fixture has to be a column the phase table has no row for. `triage` is a folder
  // somebody made, or a column taken out of the board's columns with cards still in it.
  it('stops stalled, naming the cards, when a card sits in a column nothing covers', () => {
    const cards = [
      card('F-001', 'features', 'done', 10, ['P-001']),
      card('P-001', 'product', 'done', 10, ['F-001']),
      card('E-009', 'engineering', 'triage', 10, []),
    ];
    const action = decideTick(input({ cards }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).toContain('E-009');
    // AND IT NAMES WHAT ACTUALLY PLACES A CARD. Under ruling 52 the phase table is code and a column
    // dispatches nothing, so the advice this used to give — "check that every column is routed, terminal or
    // blocked" — sent the reader to a routing table that no longer decides anything.
    expect(detailOf(action)).toContain('a column the lifecycle has no phase for');
    expect(detailOf(action)).not.toContain('routed');
  });

  // ORPHANED WORK UNDER A CLOSED FEATURE, which is what it takes to reach this sentence at all now: anything
  // under an OPEN feature is a position the machine picks up, so the only unplaceable work is what sits below
  // a feature somebody has already moved to Done.
  const orphaned = (): Card[] => [
    card('F-001', 'features', 'done', 10, ['P-001']),
    card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
    card('E-001', 'engineering', 'blocked', 10, ['P-001']),
  ];

  // THE SETUP BARRIER'S SENTENCE IS GONE WITH THE BARRIER (decision 44). Nothing can be "waiting for the
  // setup feature" any more, and a message about a rule that no longer exists is worse than none.
  it('never says a card is waiting for the setup feature', () => {
    const cards = orphaned();
    cards[0] = { ...cards[0], setup: true };
    const detail = detailOf(decideTick(input({ cards })));
    // The fixture really does reach the stalled sentence, so the assertion below is not vacuous.
    expect(detail).toContain('E-001');
    expect(detail).not.toContain('waiting for the setup feature');
  });

  it('says a parent is waiting for its own cards further down', () => {
    const detail = detailOf(decideTick(input({ cards: orphaned() })));
    expect(detail).toMatch(/E-001 ran out of attempts/);
    expect(detail).toMatch(/P-001 is waiting for its own cards further down/);
  });

  // CHANGE 1's own subject, and the reason it is asserted here rather than beside the rest of finding D:
  // with change 2 in place a purely-blocked board never reaches `whyStuck`, so the sentence is only
  // observable in the MIXED case — without this test, deleting it is an equivalent mutant.
  it('does not claim a blocked task stops the project from finishing, in the mixed case', () => {
    const cards = [task('E-001', 'blocked'), card('E-009', 'engineering', 'triage', 20, [])];
    const detail = detailOf(decideTick(input({ cards })));
    expect(detail).toContain('E-001');
    expect(detail).not.toContain('cannot report itself finished');
  });
});

// RULING 66. `complete` is computed from more than one place — the clean ending and the one that names what it
// left behind — so each is asserted on its own here, and the two together. The project that produced the ruling
// declared `npm test` as both its gate and its smoke command: four features closed, sixteen tasks delivered,
// `complete` reported, and the product had no main and printed nothing.
describe('decideTick — a smoke command that is also a gate', () => {
  const SAME = 'npm test';
  const collides: DeclaredCommands = { gates: [SAME], smoke: SAME };

  const done = (extra: Card[] = []): Card[] => [
    card('F-001', 'features', 'done', 10, ['P-001']),
    card('P-001', 'product', 'done', 10, ['F-001', 'E-001']),
    task('E-001', 'done'),
    ...extra,
  ];

  it('refuses to report the project finished, and says what has not been run', () => {
    const action = decideTick(input({ cards: done(), commands: collides }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    // THE COMMAND ITSELF, because "your smoke command is wrong" sends a reader to look for which one.
    expect(detailOf(action)).toContain(SAME);
    expect(detailOf(action)).toContain('foundation/TESTING.md');
    expect(detailOf(action)).toContain('the way its README describes');
  });

  it('reports complete once a distinct smoke command is declared', () => {
    const commands: DeclaredCommands = { gates: [SAME], smoke: 'node dist/cli.js --help' };
    expect(decideTick(input({ cards: done(), commands }))).toMatchObject({
      kind: 'stop',
      reason: 'complete',
    });
  });

  it('compares against EVERY gate, not only the first', () => {
    // One string comparison per gate. Against the first alone, a project whose second gate is its smoke
    // command passes this — and `npm test` is as likely to be the second row as the first.
    const commands: DeclaredCommands = { gates: ['npm run lint', SAME], smoke: SAME };
    expect(decideTick(input({ cards: done(), commands }))).toMatchObject({
      kind: 'stop',
      reason: 'stalled',
    });
  });

  it('does not refuse a project that declares no gates at all', () => {
    // POINT 7's honest direction. A CODE-QUALITY.md that declares nothing has no gate for the smoke command to
    // collide with, and `readGates` answers such a project with a reason rather than a list — so
    // `declaredCommands` carries no commands and there is nothing to compare. A refusal here would name a
    // command nobody wrote. What that project fails is the review's own gate check, which fails closed.
    const commands: DeclaredCommands = { gates: [], smoke: SAME };
    expect(decideTick(input({ cards: done(), commands }))).toMatchObject({
      kind: 'stop',
      reason: 'complete',
    });
  });

  it('does not refuse a project whose smoke command could not be read, which readiness owns', () => {
    // Stated because it looks like a hole: `smoke.ok` is a readiness BLOCKER, so a project with no readable
    // smoke command cannot be STARTED — a second refusal here would be about a state the loop cannot reach.
    const commands: DeclaredCommands = { gates: [SAME] };
    expect(decideTick(input({ cards: done(), commands }))).toMatchObject({
      kind: 'stop',
      reason: 'complete',
    });
  });

  // DECISION 45's ARGUMENT, ONE LEVEL OUT. A card that ran out of attempts has had every attempt it is allowed,
  // so a project holding one is not held hostage over a command no run can now change: the ending is `complete`
  // and it names BOTH facts, because naming it is what makes carrying on safe.
  // TWO TESTS OVER ONE FIXTURE, deliberately: the guard that lets the ending through and the clause that names
  // why are separate edits, and one test asserting both would fail for either — so neither would be pinned by
  // cover of its own.
  it('finishes anyway when something is blocked, rather than holding the project hostage', () => {
    const cards = done([task('E-002', 'blocked', 20)]);
    expect(decideTick(input({ cards, commands: collides }))).toMatchObject({
      kind: 'stop',
      reason: 'complete',
    });
  });

  it('names both facts in that ending — the blocked card and the unrun smoke test', () => {
    const cards = done([task('E-002', 'blocked', 20)]);
    const detail = detailOf(decideTick(input({ cards, commands: collides })));
    expect(detail).toContain('E-002');
    expect(detail).toContain(SAME);
  });

  it('says nothing about the smoke command in that sentence when there is no collision', () => {
    // Without this the clause could be a constant appended to every blocked ending, and the test above would
    // pass just as well.
    const cards = done([task('E-002', 'blocked', 20)]);
    const action = decideTick(input({ cards }));
    expect(detailOf(action)).toContain('E-002');
    expect(detailOf(action)).not.toContain('README describes');
  });

  it('is not what stops a project with outstanding work, which is stalled for its own reason', () => {
    // The refusal belongs to the ONE ending it guards. A board with work left never reaches it, and a
    // collision must not change the sentence a person gets about the work that is actually outstanding.
    const cards = [card('E-009', 'engineering', 'triage', 20, [])];
    const action = decideTick(input({ cards, commands: collides }));
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(detailOf(action)).not.toContain('README describes');
  });
});

// THE TRUNCATION, WHICH NOTHING REACHED. `names` shows at most `NAMED` ids and appends "(and N more)", and
// no fixture in the suite had a sixth unfinished card — so both the cap and the arithmetic were unmeasured.
// Flagged by the batch that split this module out: once these sentences are measured as their own file, an
// untested branch here is a live equivalent-mutant candidate rather than a theoretical one.
//
// Six cards in a column the lifecycle has no phase for, which is the B3 shape above with one more card.
describe('a stop that would name too many cards', () => {
  const stuck = (n: number): Card[] => [
    card('F-001', 'features', 'done', 10, ['P-001']),
    card('P-001', 'product', 'done', 10, ['F-001']),
    ...Array.from({ length: n }, (_, i) =>
      card(`E-${String(i + 1).padStart(3, '0')}`, 'engineering', 'triage', 10, []),
    ),
  ];

  it('names five and counts the rest', () => {
    const detail = detailOf(decideTick(input({ cards: stuck(6) })));
    // The first five by the order they were listed, then the count of what is left — not a sixth id.
    expect(detail).toContain('E-001, E-002, E-003, E-004, E-005 (and 1 more)');
    expect(detail).not.toContain('E-006');
  });

  it('counts correctly when many are left, not just one', () => {
    // A fixture of exactly six could not tell `cards.length - NAMED` from a hard-coded 1.
    expect(detailOf(decideTick(input({ cards: stuck(9) })))).toContain('(and 4 more)');
  });

  it('names all five and adds nothing when the list is exactly at the cap', () => {
    const detail = detailOf(decideTick(input({ cards: stuck(5) })));
    expect(detail).toContain('E-005');
    // The off-by-one that a `>=` here would produce: "(and 0 more)" on a list that fits.
    expect(detail).not.toContain('more)');
  });
});
