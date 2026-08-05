import { describe, expect, it } from 'vitest';
import { type AutopilotConfig, DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { type EligibilityInput, type Eligible, eligibility, pickNext } from '../src/core/eligibility.js';
import type { RunRecord, RunStatus } from '../src/core/runs.js';
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
    run: `${cardId}-${skill}-${status}-${runCount}`,
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

// The default columns, as slugs and in order — the pick's last tie-breaks read this.
const COLUMNS: Record<BoardName, string[]> = {
  features: ['backlog', 'todo', 'in-progress', 'done'],
  product: ['backlog', 'todo', 'in-progress', 'done'],
  engineering: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
};

// Two features, each with one childless product card in Backlog. The features themselves are parents
// with a non-terminal child, so the only eligible cards are the two product ones.
const base = (): Card[] => [
  card('F-001', 'features', 'todo', 10, ['P-001']),
  card('P-001', 'product', 'backlog', 10, ['F-001']),
  card('F-002', 'features', 'todo', 20, ['P-002']),
  card('P-002', 'product', 'backlog', 10, ['F-002']),
];

const input = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  ap: DEFAULT_AUTOPILOT,
  cards: base(),
  runs: [],
  columns: COLUMNS,
  rollupEligible: [],
  problems: [],
  ...over,
});

const ids = (list: Eligible[]): string[] => list.map((e) => e.card.id).sort();

describe('which cards are eligible', () => {
  it('admits a card in a routed column and refuses one whose column has no route', () => {
    const routed = [...base(), card('E-009', 'engineering', 'backlog', 10, [])];
    expect(ids(eligibility(input({ cards: routed })).eligible)).toEqual(['E-009', 'P-001', 'P-002']);
    // `blocked` is engineering's own column and deliberately has no route: a card that has run out of
    // attempts lands there, and nothing must pick it up again.
    const blocked = [...base(), card('E-009', 'engineering', 'blocked', 10, [])];
    expect(ids(eligibility(input({ cards: blocked })).eligible)).toEqual(['P-001', 'P-002']);
  });

  it('names the route it would dispatch, not just the card', () => {
    const found = eligibility(input()).eligible.find((e) => e.card.id === 'P-001');
    expect(found?.route.skill).toBe('design');
    expect(found?.route.next).toBe('todo');
  });

  // The fixture used to move the card to `archive/` as well, and that made the test a false gate: there
  // is no route for `archive`, so the card was refused for the wrong reason and deleting the liveness
  // check changed nothing. The half-archived state is also the real one — `scaffold.ts` tells agents to
  // move the file AND set the field, so a half-done archive by hand or by an agent is exactly this.
  it('excludes an archived card even when its column has a route', () => {
    const archived = base().map((c) => (c.id === 'P-001' ? { ...c, archived: '2026-08-05T10:00:00Z' } : c));
    const el = ids(eligibility(input({ cards: archived })).eligible);
    expect(el).not.toContain('P-001');
    // F-001 becomes eligible, which is right and worth saying out loud: its only child was thrown
    // away, so the feature has no live breakdown and its Todo route is break-down. An archived card
    // does not merely stop being work — it stops being evidence that the work was ever planned.
    expect(el).toEqual(['F-001', 'P-002']);
  });
});

describe('the attempt cap', () => {
  const failures = (n: number, skill = 'design'): RunRecord[] =>
    Array.from({ length: n }, () => run('P-001', 'product', skill, 'failed'));

  it('keeps a card below the cap eligible', () => {
    const el = eligibility(input({ runs: failures(2) }));
    expect(ids(el.eligible)).toEqual(['P-001', 'P-002']);
    expect(el.eligible.find((e) => e.card.id === 'P-001')?.attemptsUsed).toBe(2);
  });

  it('moves a card at the cap out of eligible and into blockedByAttempts', () => {
    const el = eligibility(input({ runs: failures(3) }));
    expect(ids(el.eligible)).toEqual(['P-002']);
    expect(ids(el.blockedByAttempts)).toEqual(['P-001']);
    expect(el.blockedByAttempts[0]?.attemptsUsed).toBe(3);
  });

  it('counts only runs of the route’s own skill', () => {
    // A critic judging this card is not an attempt at the work. The cap depends on this, so it is
    // asserted here as well as in accounting.test.ts.
    expect(ids(eligibility(input({ runs: failures(5, 'critic') })).eligible)).toEqual(['P-001', 'P-002']);
  });

  // The NaN class dispatch-gate.ts was written against: `used >= NaN` is false, so an unusable cap
  // does not raise the limit — it deletes it. Refusing is the only reading that cannot overshoot.
  it('refuses everything when the cap itself is unusable, and says so', () => {
    const ap = { ...DEFAULT_AUTOPILOT, attemptCap: Number.NaN };
    const el = eligibility(input({ ap }));
    expect(el.eligible).toEqual([]);
    expect(el.blockedByAttempts).toEqual([]);
    expect(el.problem).toMatch(/attemptCap/);
  });
});

describe('the setup feature barrier', () => {
  const withSetup = (cards: Card[]): Card[] =>
    cards.map((c) => (c.id === 'F-001' ? { ...c, setup: true } : c));

  it('admits only the setup subtree while the barrier is unfinished', () => {
    const el = eligibility(input({ cards: withSetup(base()) }));
    expect(el.barrier).toBe('unfinished');
    // F-001 is a parent with a non-terminal child, so P-001 is all that is left inside the subtree.
    expect(ids(el.eligible)).toEqual(['P-001']);
  });

  it('admits everything once the barrier is finished', () => {
    const done = withSetup(base()).map((c) =>
      ['F-001', 'P-001'].includes(c.id) ? { ...c, columnSlug: 'done' } : c,
    );
    const el = eligibility(input({ cards: done }));
    expect(el.barrier).toBe('finished');
    expect(ids(el.eligible)).toEqual(['P-002']);
  });

  // The spec's carried item, and the reason `setupState` has three answers rather than two: `readBoard`
  // DROPS a card whose file will not parse, so the broken file could BE the barrier. Treating unknown
  // as finished puts the silent barrier-lift back one layer up from where it was fixed.
  it('refuses everything when the barrier is unknowable, and the reason reaches the caller', () => {
    const problems = [{ path: 'boards/features/todo/F-001.md', reason: 'bad indentation' }];
    // Not vacuous: the same board with nothing unreadable has two eligible cards.
    expect(ids(eligibility(input()).eligible)).toEqual(['P-001', 'P-002']);

    const el = eligibility(input({ problems }));
    expect(el.barrier).toBe('unknown');
    expect(el.eligible).toEqual([]);
    expect(el.blockedByAttempts).toEqual([]);
    expect(el.problem).toContain('F-001.md');
    expect(el.problem).toMatch(/bad indentation/);
  });

  it('reports the subtree it used, so a caller can tell a blocked barrier from a blocked card', () => {
    expect([...eligibility(input({ cards: withSetup(base()) })).setupIds].sort()).toEqual(['F-001', 'P-001']);
  });
});

describe('a parent waits for its children', () => {
  // P-005 has a route in Todo, and an engineering child that is not finished. Dispatching its
  // break-down again would plan work on top of work in flight.
  const cards = (): Card[] => [
    card('F-005', 'features', 'in-progress', 10, ['P-005']),
    card('P-005', 'product', 'todo', 10, ['F-005', 'E-005']),
    card('E-005', 'engineering', 'review', 10, ['P-005']),
  ];

  it('excludes a parent whose children are not all terminal', () => {
    expect(ids(eligibility(input({ cards: cards() })).eligible)).toEqual(['E-005']);
  });

  it('admits it once they are', () => {
    const done = cards().map((c) => (c.id === 'E-005' ? { ...c, columnSlug: 'done' } : c));
    expect(ids(eligibility(input({ cards: done })).eligible)).toEqual(['P-005']);
  });
});

describe('a close-out waits for the rollup to say so', () => {
  // F-003's only child is finished, so the parent rule above is satisfied and its In Progress column
  // has the close-out route. The rollup is what says the feature is ready for it.
  const cards = (): Card[] => [
    card('F-003', 'features', 'in-progress', 10, ['P-003']),
    card('P-003', 'product', 'done', 10, ['F-003']),
  ];

  it('refuses the close-out until the rollup names the card', () => {
    expect(eligibility(input({ cards: cards() })).eligible).toEqual([]);
    expect(ids(eligibility(input({ cards: cards(), rollupEligible: ['F-003'] })).eligible)).toEqual([
      'F-003',
    ]);
  });

  // S2 again, from the other side: the parent rule is a universal quantifier and passes vacuously for a
  // childless card, so it is the rollup — which requires at least one live child — that holds this shut.
  it('refuses a childless feature its close-out, however satisfied the parent rule is', () => {
    const childless = [card('F-004', 'features', 'in-progress', 10, [])];
    expect(eligibility(input({ cards: childless })).eligible).toEqual([]);
  });
});

describe('picking one', () => {
  // Each of these fixtures is built so that ONLY the level under test can decide: every earlier level
  // ties, and the levels below it would choose the other card.
  const pick = (cards: Card[], over: Partial<EligibilityInput> = {}): string | undefined => {
    const inp = input({ cards, ...over });
    return pickNext(eligibility(inp).eligible, inp)?.card.id;
  };

  it('takes the earliest incomplete feature by order', () => {
    expect(pick(base())).toBe('P-001');
    // Order, not id: swapping the numbers swaps the answer.
    const swapped = base().map((c) =>
      c.id === 'F-001' ? { ...c, order: 20 } : c.id === 'F-002' ? { ...c, order: 10 } : c,
    );
    expect(pick(swapped)).toBe('P-002');
  });

  it('skips a feature that is already complete', () => {
    // F-001 in Done: P-001 belongs to no incomplete feature, so it goes last despite the lower order.
    const finished = base().map((c) => (c.id === 'F-001' ? { ...c, columnSlug: 'done' } : c));
    expect(pick(finished)).toBe('P-002');
  });

  // SYNTHETIC IDS, and they have to be: with the conventional prefixes (`E-`, `F-`, `P-`) the id
  // tie-break always agrees with the depth one, because 'E' < 'F' < 'P' happens to run in the same
  // direction as engineering-before-product-before-features. The first version of this test used real
  // prefixes and therefore held nothing — deleting the depth level left it green. Ids are frontmatter
  // strings, so a hand-written board can carry anything; these disagree on purpose.
  it('then takes the card furthest down the pipeline', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['A-001', 'A-002']),
      card('A-001', 'product', 'backlog', 10, ['F-001']),
      card('A-002', 'product', 'todo', 10, ['F-001', 'Z-001']),
      card('Z-001', 'engineering', 'backlog', 10, ['A-002']),
    ];
    expect(ids(eligibility(input({ cards })).eligible)).toEqual(['A-001', 'Z-001']);
    // The id level would choose A-001 and the depth level chooses Z-001. Nothing else can decide:
    // same feature, same column index, same card order.
    expect(pick(cards)).toBe('Z-001');
  });

  it('then the later column, because started work finishes before new work starts', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001', 'E-002']),
      card('E-001', 'engineering', 'backlog', 10, ['P-001']),
      card('E-002', 'engineering', 'review', 10, ['P-001']),
    ];
    expect(pick(cards)).toBe('E-002');
  });

  it('then the card’s own order', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001', 'E-002']),
      card('E-001', 'engineering', 'backlog', 20, ['P-001']),
      card('E-002', 'engineering', 'backlog', 10, ['P-001']),
    ];
    expect(pick(cards)).toBe('E-002');
  });

  it('and finally the id, so the pick is never arbitrary', () => {
    // E-002 is listed FIRST. With the id level deleted the comparator returns 0, `Array.sort` is stable,
    // and the answer becomes whatever order the cards arrived in — which is directory read order, the
    // very thing this test's name denies. Listing the wanted answer second is what makes it a gate.
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001', 'E-002']),
      card('E-002', 'engineering', 'backlog', 10, ['P-001']),
      card('E-001', 'engineering', 'backlog', 10, ['P-001']),
    ];
    expect(pick(cards)).toBe('E-001');
  });

  // Links are symmetric when written through the endpoint, and a hand-edited board can break that. The
  // rollup and the parent rule read the PARENT's links, so they saw Z-001 as A-002's child; the pick used
  // to read the CHILD's links, found no parent, ranked it as belonging to no feature, and dispatched a
  // later feature's work first. Two readings of one relation.
  it('finds a card’s feature even when only the parent side of the link was written', () => {
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['A-002']),
      card('A-002', 'product', 'in-progress', 10, ['F-001', 'Z-001']),
      card('Z-001', 'engineering', 'backlog', 10, []), // does not link back
      card('F-002', 'features', 'todo', 99, ['P-002']),
      card('P-002', 'product', 'backlog', 10, ['F-002']),
    ];
    // F-001 has the lower order, so its subtree goes first — which only holds if Z-001 is known to be in it.
    expect(pick(cards)).toBe('Z-001');
  });

  it('answers nothing when nothing is eligible', () => {
    const inp = input({ cards: [] });
    expect(pickNext([], inp)).toBeUndefined();
  });

  it('ranks a card belonging to no feature last', () => {
    const orphan = [...base(), card('E-009', 'engineering', 'backlog', 1, [])];
    // Depth and order would both put E-009 first; having no feature outranks both.
    expect(pick(orphan)).toBe('P-001');
  });
});

describe('the columns a board does not have', () => {
  it('ranks a card in a column the config does not list last among its board', () => {
    // A card in a folder no column maps to still has a route if the routing table names that slug —
    // the two lists are edited in different places. It must not sort as though it were column zero.
    const ap: AutopilotConfig = {
      ...DEFAULT_AUTOPILOT,
      routes: [...DEFAULT_AUTOPILOT.routes, { ...DEFAULT_AUTOPILOT.routes[5], column: 'triage' }],
    };
    const cards = [
      card('F-001', 'features', 'in-progress', 10, ['P-001']),
      card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001', 'E-002']),
      card('E-001', 'engineering', 'triage', 10, ['P-001']),
      card('E-002', 'engineering', 'backlog', 10, ['P-001']),
    ];
    const inp = input({ ap, cards });
    expect(ids(eligibility(inp).eligible)).toEqual(['E-001', 'E-002']);
    expect(pickNext(eligibility(inp).eligible, inp)?.card.id).toBe('E-002');
  });
});
