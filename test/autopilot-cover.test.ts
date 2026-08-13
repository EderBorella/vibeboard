import { describe, expect, it } from 'vitest';
import { type AutopilotConfig, DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { coverageProblems, skillProblems } from '../src/core/autopilot-cover.js';
import { defaultConfig } from '../src/core/config.js';
import type { ProjectConfig } from '../src/core/types.js';

const fresh = (): ProjectConfig => defaultConfig('T');

// Narrowing helper: every fixture below has just been built by defaultConfig, so the block is there.
// A non-null assertion at each use site would be the same claim made twenty times.
function ap(config: ProjectConfig): AutopilotConfig {
  if (!config.autopilot) throw new Error('fixture has no autopilot block');
  return config.autopilot;
}

describe('routing-table coverage', () => {
  it('passes a default project — every configured column is routed, terminal or blocked', () => {
    expect(coverageProblems(fresh())).toEqual([]);
  });

  // Review blocker B3, verbatim: the exact hole that reported success over unfinished work.
  it('names a configured column that is neither routed, terminal nor blocked', () => {
    const config = fresh();
    ap(config).routes = ap(config).routes.filter(
      (r) => !(r.board === 'engineering' && r.column === 'backlog'),
    );
    expect(coverageProblems(config)).toEqual([
      'engineering: the column "backlog" is neither routed, terminal nor blocked — cards there would never become eligible.',
    ]);
  });

  it('refuses a route whose next column does not exist', () => {
    const config = fresh();
    ap(config).routes[0] = { ...ap(config).routes[0], next: 'shipped' };
    expect(coverageProblems(config)).toContain(
      'features: the route on "backlog" advances to "shipped", which is not a column on that board.',
    );
  });

  it('refuses a route that advances to itself, since a passing card would never move', () => {
    const config = fresh();
    ap(config).routes[0] = { ...ap(config).routes[0], next: 'backlog' };
    expect(coverageProblems(config)).toContain(
      'features: the route on "backlog" advances to itself, so a passing card never moves.',
    );
  });

  it('refuses a terminal column that exists on no board', () => {
    const config = fresh();
    ap(config).terminal.product = ['done', 'finished'];
    expect(coverageProblems(config)).toContain(
      'terminal names "finished" for product, which is not a column on that board — a mistyped terminal column silently makes nothing terminal.',
    );
  });

  it('refuses a board with no terminal column, since nothing on it could ever finish', () => {
    const config = fresh();
    ap(config).terminal.features = [];
    expect(coverageProblems(config)).toContain(
      'terminal names no column for features, so no card on that board could ever finish.',
    );
  });

  it('refuses a blocked column engineering does not have', () => {
    const config = fresh();
    ap(config).blockedColumn = 'stuck';
    const problems = coverageProblems(config);
    expect(problems).toContain('blockedColumn is "stuck", which is not a column on the engineering board.');
    // And "blocked" is now covered by nothing, which is the real consequence.
    expect(problems).toContain(
      'engineering: the column "blocked" is neither routed, terminal nor blocked — cards there would never become eligible.',
    );
  });

  it('refuses a blocked column that is also routed or terminal', () => {
    const routed = fresh();
    ap(routed).routes.push({
      board: 'engineering',
      column: 'blocked',
      skill: 'implement',
      verify: 'gates',
      next: 'review',
    });
    expect(coverageProblems(routed)).toContain(
      'blockedColumn "blocked" is also routed; a blocked card must stay put.',
    );

    const terminal = fresh();
    ap(terminal).terminal.engineering = ['done', 'blocked'];
    expect(coverageProblems(terminal)).toContain(
      'blockedColumn "blocked" is listed as terminal, which would report blocked work as done.',
    );
  });

  // CHANGE 3 OF DECISION 45's REPEAL, and the only one of the four that is a change to NOTHING: this refusal
  // STAYS. Its own test rather than the second half of the one above, because it now guards a specific
  // shortcut — making `complete` reachable by listing `blocked` under terminal.engineering. That one line
  // would do it, and it would also make a blocked card count as `complete`'s own positive evidence, which is
  // the false success the other three changes were careful not to open.
  it('refuses a config listing blocked under terminal.engineering', () => {
    const config = fresh();
    ap(config).terminal.engineering = ['done', 'blocked'];
    expect(coverageProblems(config).join(' ')).toMatch(/report blocked work as done/);
  });

  // The column a product card advances FROM is moved by the rollup and by no route. Without rollup
  // counting as cover, the default table would fail its own validator.
  it('counts an advancing rollup as cover, and an eligibility rule as no cover at all', () => {
    const config = fresh();
    expect(coverageProblems(config)).toEqual([]);
    ap(config).rollup = ap(config).rollup.map((r) =>
      r.board === 'product' ? { ...r, action: 'eligible' as const, next: undefined } : r,
    );
    const problems = coverageProblems(config);
    expect(problems).toContain(
      'product: the column "in-progress" is neither routed, terminal nor blocked — cards there would never become eligible.',
    );
    expect(problems).toContain(
      'The rollup rule on product/in-progress makes a card eligible, but that column has no route to become eligible for.',
    );
  });

  // Changing `action:` from advance to eligible and leaving `next:` behind. `rollupOutcomes` ignores it
  // — the card is made eligible and never advanced — so the config would state something the loop does
  // not do, and the next reader would have to guess which of the two was meant.
  it('refuses an eligibility rule that still names a next column', () => {
    const config = fresh();
    expect(coverageProblems(config)).toEqual([]);
    ap(config).rollup = ap(config).rollup.map((r) => (r.board === 'features' ? { ...r, next: 'done' } : r));
    expect(coverageProblems(config)).toContain(
      'The rollup rule on features/in-progress makes a card eligible AND names next: "done". An eligible rule admits the card to its route rather than moving it, so remove next — or change the action to advance if moving it is what you meant.',
    );
  });

  it('refuses an advancing rollup with nowhere terminal to advance to', () => {
    const missing = fresh();
    ap(missing).rollup[0] = { ...ap(missing).rollup[0], next: undefined };
    expect(coverageProblems(missing)).toContain(
      'The rollup rule on product/in-progress advances a card but names no column to advance it to.',
    );

    const live = fresh();
    ap(live).rollup[0] = { ...ap(live).rollup[0], next: 'todo' };
    expect(coverageProblems(live)).toContain(
      'The rollup rule on product/in-progress advances to "todo", which is not terminal.',
    );
  });

  it('refuses a rollup rule on a column that board does not have', () => {
    const config = fresh();
    ap(config).rollup[0] = { ...ap(config).rollup[0], column: 'shipping' };
    expect(coverageProblems(config)).toContain(
      'A rollup rule names the column "shipping", which the product board does not have.',
    );
  });

  it('refuses two routes on one phase — that is a half-landed edit, not a tie to break', () => {
    const config = fresh();
    ap(config).routes.push({ ...ap(config).routes[0], skill: 'design' });
    expect(coverageProblems(config)).toContain(
      'features/backlog has more than one route; a phase runs exactly one skill.',
    );
  });

  it('refuses an unknown verify mode and a non-positive cap', () => {
    const config = fresh();
    ap(config).routes[0] = { ...ap(config).routes[0], verify: 'vibes' as never };
    ap(config).attemptCap = 0;
    const problems = coverageProblems(config);
    expect(problems).toContain(
      'features: the route on "backlog" verifies with "vibes" — expected gates, critic, smoke.',
    );
    expect(problems).toContain('attemptCap must be a positive whole number; it is 0.');
  });

  // Zero is a real budget: for a subscription-backed or local model the figure is zero or not what
  // you are billed, and then maxIterations is the governing cap.
  it('allows a zero budget but not a negative one', () => {
    const zero = fresh();
    ap(zero).budgetUsd = 0;
    expect(coverageProblems(zero)).toEqual([]);
    const negative = fresh();
    ap(negative).budgetUsd = -1;
    expect(coverageProblems(negative)).toContain('budgetUsd must be zero or more; it is -1.');
  });

  // Absence fails closed: a project from before this slice is refused with a reason, not admitted.
  it('refuses a project with no autopilot block at all', () => {
    const config = fresh();
    delete config.autopilot;
    expect(coverageProblems(config)).toEqual([
      'This project has no autopilot block in config.yaml, so there is no lifecycle to run.',
    ]);
  });

  it('names a route whose skill is not in the catalogue', () => {
    expect(skillProblems(DEFAULT_AUTOPILOT, ['implement', 'test'])).toContain(
      'The route on features/backlog needs a skill called "derive-features", and this project has none.',
    );
    // The critic is in the list because a route's VERIFIER is part of its cover too (slice C1): the
    // default table has critic-verified routes, so a catalogue holding only the routed skills is
    // genuinely missing one. The premise of this line changed, not the behaviour it asserts.
    const all = [...DEFAULT_AUTOPILOT.routes.map((r) => r.skill), 'critic'];
    expect(skillProblems(DEFAULT_AUTOPILOT, all)).toEqual([]);
  });
});

// Findings from the slice A review. Each of these returned [] before the fix, and each of them ends
// in the same place the whole validator exists to prevent: a run that reports success, or one that
// cannot finish and does not say why.
describe('routing-table coverage — holes found in review', () => {
  it('refuses a cycle: every column routed, and no card can ever reach a terminal one', () => {
    const config = fresh();
    const review = ap(config).routes.find((r) => r.board === 'engineering' && r.column === 'review');
    if (!review) throw new Error('the default table routes engineering/review');
    review.next = 'in-progress';
    expect(coverageProblems(config)).toContain(
      'engineering: the columns in-progress, review advance into each other and never reach a terminal column.',
    );
  });

  it('names a cycle once, not once per column that leads into it', () => {
    const config = fresh();
    const review = ap(config).routes.find((r) => r.board === 'engineering' && r.column === 'review');
    if (!review) throw new Error('the default table routes engineering/review');
    review.next = 'in-progress';
    // backlog and in-progress both feed review, so the naive version reported the same loop twice.
    expect(coverageProblems(config).filter((p) => p.includes('advance into each other'))).toHaveLength(1);
  });

  it('refuses a column that is both routed and terminal', () => {
    const config = fresh();
    ap(config).terminal.engineering = ['done', 'review'];
    expect(coverageProblems(config)).toContain(
      'engineering: the column "review" is both routed and terminal, so a card that never passes there would still be reported as finished.',
    );
  });

  it('refuses a route that advances a passing card into the blocked column', () => {
    const config = fresh();
    const review = ap(config).routes.find((r) => r.board === 'engineering' && r.column === 'review');
    if (!review) throw new Error('the default table routes engineering/review');
    review.next = 'blocked';
    expect(coverageProblems(config)).toContain(
      'engineering: the route on "review" advances a PASSING card into "blocked", which is where exhausted cards go and is never routed onward.',
    );
  });

  it('reports a malformed block instead of throwing on it', () => {
    const config = fresh();
    config.autopilot = { maxIterations: 10 } as unknown as AutopilotConfig;
    const problems = coverageProblems(config);
    expect(problems).toContain('autopilot.routes must be a list of routes.');
    expect(problems).toContain('autopilot.rollup must be a list of rules.');
    expect(problems).toContain('autopilot.terminal must name the terminal columns of each board.');
    // Shape problems come back ALONE: the checks below them all index into the block.
    expect(problems.every((p) => p.startsWith('autopilot.'))).toBe(true);
  });

  it('names the pre-per-board terminal shape specifically, since a flat list looks right', () => {
    const config = fresh();
    ap(config).terminal = ['done'] as unknown as AutopilotConfig['terminal'];
    expect(coverageProblems(config)).toContain(
      'autopilot.terminal is a flat list; it must name the terminal columns per board.',
    );
  });

  it('refuses a fractional cap, which no integer counter ever equals', () => {
    const config = fresh();
    ap(config).attemptCap = 0.5;
    ap(config).checkupEvery = 2.5;
    const problems = coverageProblems(config);
    expect(problems).toContain('attemptCap must be a positive whole number; it is 0.5.');
    expect(problems).toContain('checkupEvery must be a positive whole number; it is 2.5.');
  });
});

// The shape checks run first and alone, because every later check indexes into the block. Each of them
// needs its own case: removing the `blockedColumn` one changed no test at all, which was found by
// planting while the tick was made to depend on this function.
describe('a block that is not the shape it claims', () => {
  const malformed = (patch: Record<string, unknown>): string[] => {
    const config = fresh();
    Object.assign(ap(config), patch);
    return coverageProblems(config);
  };

  it('refuses a blocked column that is not even a string', () => {
    expect(malformed({ blockedColumn: 42 })).toEqual(['autopilot.blockedColumn must be a column slug.']);
  });

  it('refuses routes and rollup that are not lists', () => {
    expect(malformed({ routes: 'implement' })).toEqual(['autopilot.routes must be a list of routes.']);
    expect(malformed({ rollup: null })).toEqual(['autopilot.rollup must be a list of rules.']);
  });

  it('refuses a terminal block that is absent, or the flat list it used to be', () => {
    const gone = fresh();
    delete (ap(gone) as { terminal?: unknown }).terminal;
    expect(coverageProblems(gone)).toEqual([
      'autopilot.terminal must name the terminal columns of each board.',
    ]);
    expect(malformed({ terminal: ['done'] })).toEqual([
      'autopilot.terminal is a flat list; it must name the terminal columns per board.',
    ]);
  });

  // Alone, and that is the claim: a malformed shape returns before anything indexes into the block, so a
  // reader is not handed "routes is not a list" next to a dozen consequences of it.
  it('reports the shape and nothing else, even when the rest is also wrong', () => {
    expect(malformed({ routes: 'implement', attemptCap: 0 })).toEqual([
      'autopilot.routes must be a list of routes.',
    ]);
  });
});

describe('rollup rules that contradict each other', () => {
  it('refuses two rollup rules on one column', () => {
    const config = fresh();
    ap(config).rollup.push({ ...ap(config).rollup[0], next: 'todo' });
    expect(coverageProblems(config)).toContain(
      'product/in-progress has more than one rollup rule; a column rolls up exactly one way.',
    );
  });

  it('refuses a column that both advances by rollup and runs a skill', () => {
    const config = fresh();
    ap(config).routes.push({
      board: 'product',
      column: 'in-progress',
      skill: 'design',
      verify: 'critic',
      next: 'done',
    });
    expect(coverageProblems(config)).toContain(
      'product/in-progress both advances by rollup and runs a skill, so whether the card is dispatched or moved to done would depend on tick order.',
    );
  });

  // The pairing that MUST stay legal: a feature in in-progress has a close-out route, and the
  // eligibility rule gates it rather than replacing it. Refusing this would break the default table.
  it('allows an eligibility rule on a column that has a route — that is the close-out shape', () => {
    const config = fresh();
    const features = ap(config).rollup.find((r) => r.board === 'features');
    expect(features?.action).toBe('eligible');
    expect(ap(config).routes.some((r) => r.board === 'features' && r.column === features?.column)).toBe(true);
    expect(coverageProblems(config)).toEqual([]);
  });
});

// The critic's bar, and the skill that answers it. Both are new in slice C1: `verify: critic` was a
// mode nothing executed until then, so neither the number nor the skill had to exist.
describe('the critic threshold', () => {
  // A fraction, and NOT zero: a threshold of 0 passes a critic that scored the work worthless, which
  // is a gate wired to nothing — the AutoGPT shape this whole design is written against. Above one is
  // a bar no score can clear, which blocks every critic-verified card instead.
  it.each([0, -1, 1.5, Number.NaN, 'high', undefined])('refuses %s', (value) => {
    const config = fresh();
    ap(config).criticThreshold = value as number;
    expect(coverageProblems(config).join(' ')).toMatch(/criticThreshold/);
  });

  it('accepts a fraction above zero and up to one', () => {
    for (const value of [0.01, 0.6, 1]) {
      const config = fresh();
      ap(config).criticThreshold = value;
      expect(coverageProblems(config).join(' ')).not.toMatch(/criticThreshold/);
    }
  });
});

describe('a route verified by a critic', () => {
  // A phase whose VERIFIER does not exist can never pass: the card is picked up, the run happens, and
  // nothing can advance it — the unreachable-column failure one level in. The default table has three
  // critic-verified routes, so this is the ordinary case rather than an exotic one.
  it('is refused when the project has no critic skill', () => {
    const routed = DEFAULT_AUTOPILOT.routes.map((r) => r.skill);
    expect(skillProblems(DEFAULT_AUTOPILOT, routed).join(' ')).toMatch(/critic/);
  });

  // Every refusal that reaches a person has to say what to do next. `seedSkills` only writes into a
  // project with NO skills folder, so an existing project cannot get the shipped critic back by
  // reopening — which makes "you have no critic skill" a dead end unless it says where to make one.
  it('names the routes it is about, and the way out', () => {
    const routed = DEFAULT_AUTOPILOT.routes.map((r) => r.skill);
    const said = skillProblems(DEFAULT_AUTOPILOT, routed).join(' ');
    expect(said).toContain('features/backlog');
    expect(said).toContain('product/backlog');
    expect(said).toMatch(/Skills tab/);
  });

  it('is satisfied by the critic skill being there', () => {
    const routed = DEFAULT_AUTOPILOT.routes.map((r) => r.skill);
    expect(skillProblems(DEFAULT_AUTOPILOT, [...routed, 'critic'])).toEqual([]);
  });

  it('is not asked of a project whose routes are all verified another way', () => {
    const noCritic = {
      ...DEFAULT_AUTOPILOT,
      routes: DEFAULT_AUTOPILOT.routes.filter((r) => r.verify !== 'critic'),
    };
    const routed = noCritic.routes.map((r) => r.skill);
    expect(skillProblems(noCritic, routed)).toEqual([]);
  });
});
