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
    expect(problems).toContain('attemptCap must be a positive number; it is 0.');
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
    const all = DEFAULT_AUTOPILOT.routes.map((r) => r.skill);
    expect(skillProblems(DEFAULT_AUTOPILOT, all)).toEqual([]);
  });
});
