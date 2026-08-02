import type { BoardName } from './types.js';

// The lifecycle as data. A phase is a (board, column) pair, and what happens there is a LOOKUP
// rather than an agent's judgement: which skill runs, how its work is verified, and which column the
// card moves to when it passes. Inspectable and reproducible — no planning call per tick, and
// "am I done?" is never the working agent's opinion.
//
// Columns are SLUGS here. `config.boards[b].columns` holds display names ("In Progress") and
// slugging is one-way, so every comparison against config goes through `boardColumnSlugs`.

// How a card's work is judged. All three fail closed when what they need is missing: `gates` runs
// the commands declared in foundation/CODE-QUALITY.md, `critic` dispatches a fresh judging agent
// that returns a score, `smoke` runs the command declared in foundation/TESTING.md.
export const VERIFY_MODES = ['gates', 'critic', 'smoke'] as const;
export type VerifyMode = (typeof VERIFY_MODES)[number];

export interface Route {
  board: BoardName;
  column: string; // slug
  skill: string; // slug of a skill in .vibeboard/skills/
  verify: VerifyMode;
  next: string; // slug of the column a passing card moves to
}

// A parent completes from its children, not from a run of its own. `advance` moves the card with no
// dispatch and no cost; `eligible` only admits it to a route — a feature gets one close-out dispatch,
// because three engineering cards can each pass their own tests while the feature they compose does
// not work.
export const ROLLUP_ACTIONS = ['advance', 'eligible'] as const;
export type RollupAction = (typeof ROLLUP_ACTIONS)[number];

export interface Rollup {
  board: BoardName;
  when: 'all-children-terminal';
  action: RollupAction;
}

export interface AutopilotConfig {
  maxIterations: number;
  budgetUsd: number;
  runTimeoutMs: number;
  attemptCap: number;
  checkupEvery: number;
  autoPilotConcurrency: number;
  routes: Route[];
  rollup: Rollup[];
  // Explicit, never inferred from the absence of a route: a mistyped column must fail loudly rather
  // than silently making its cards terminal.
  terminal: string[];
  blockedColumn: string; // engineering only
  // The setup feature is identified by a frontmatter flag, never a reserved id: `nextId` derives ids
  // and never accepts one (ids.ts), so a recreated F-001 would silently remove the barrier.
  setupFeatureFlag: string;
}

export const DEFAULT_AUTOPILOT: AutopilotConfig = {
  maxIterations: 250,
  budgetUsd: 20,
  runTimeoutMs: 1_800_000,
  attemptCap: 3,
  checkupEvery: 10,
  autoPilotConcurrency: 1,
  routes: [
    { board: 'features', column: 'backlog', skill: 'derive-features', verify: 'critic', next: 'todo' },
    { board: 'features', column: 'todo', skill: 'break-down', verify: 'critic', next: 'in-progress' },
    { board: 'features', column: 'in-progress', skill: 'close-out', verify: 'smoke', next: 'done' },
    { board: 'product', column: 'backlog', skill: 'design', verify: 'critic', next: 'todo' },
    { board: 'product', column: 'todo', skill: 'break-down', verify: 'critic', next: 'in-progress' },
    { board: 'engineering', column: 'backlog', skill: 'implement', verify: 'gates', next: 'review' },
    { board: 'engineering', column: 'review', skill: 'test', verify: 'gates', next: 'done' },
  ],
  rollup: [
    { board: 'product', when: 'all-children-terminal', action: 'advance' },
    { board: 'features', when: 'all-children-terminal', action: 'eligible' },
  ],
  terminal: ['done'],
  blockedColumn: 'blocked',
  setupFeatureFlag: 'setup',
};

export function routeFor(ap: AutopilotConfig, board: BoardName, columnSlug: string): Route | undefined {
  return ap.routes.find((r) => r.board === board && r.column === columnSlug);
}

export function isTerminalColumn(ap: AutopilotConfig, columnSlug: string): boolean {
  return ap.terminal.includes(columnSlug);
}

// Engineering's alone. A product or feature card that cannot be designed after three tries is a
// project-level problem that stops the run, so `blocked` on those boards would be a column nothing
// ever puts a card into — and one the cover check would then have to excuse.
export function isBlockedColumn(ap: AutopilotConfig, board: BoardName, columnSlug: string): boolean {
  return board === 'engineering' && ap.blockedColumn === columnSlug;
}

// A column IS a folder, so renaming one moves the folder (columns.ts) — and the routing table names
// columns by slug on BOTH sides. Rewriting only `column` would leave some other route's `next`
// pointing at a slug that no longer exists, which is the same silent gap as an unrouted column.
export function applyRouteRenames(
  ap: AutopilotConfig,
  board: BoardName,
  renamed: { from: string; to: string }[],
): AutopilotConfig {
  if (renamed.length === 0) return ap;
  const to = (slug: string): string => renamed.find((r) => r.from === slug)?.to ?? slug;
  return {
    ...ap,
    routes: ap.routes.map((r) => (r.board === board ? { ...r, column: to(r.column), next: to(r.next) } : r)),
    // `terminal` and `blockedColumn` are not board-scoped, so a rename on any board updates them.
    terminal: ap.terminal.map(to),
    blockedColumn: to(ap.blockedColumn),
  };
}
