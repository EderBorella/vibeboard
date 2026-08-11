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

// The skill a `critic` route dispatches to do its judging. Named once here rather than spelled in the
// seed, the readiness check and the loop: three copies of a slug is three places for it to drift, and a
// route whose verifier cannot be found is a card nothing can ever advance.
export const CRITIC_SKILL = 'critic';

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

// A rollup names the COLUMN it acts on, not just the board. Without that, `product/in-progress` — a
// column whose cards advance by rollup and never by a route — was covered by nothing the validator
// could see, and it would have been reported as the same unreachable-column bug the validator exists
// to catch. Naming the column also makes the rule checkable: `advance` must have somewhere terminal
// to advance TO, and `eligible` is meaningless on a column that has no route to become eligible for.
export interface Rollup {
  board: BoardName;
  column: string; // slug the rule acts on
  when: 'all-children-terminal';
  action: RollupAction;
  next?: string; // `advance` only: the terminal column the card moves to
}

export interface AutopilotConfig {
  maxIterations: number;
  budgetUsd: number;
  runTimeoutMs: number;
  attemptCap: number;
  checkupEvery: number;

  // What a critic's score must reach for a card to advance. A THRESHOLD rather than a boolean verdict
  // (S9): a binary pass yields no distribution, and the critic is this design's weakest link — level 4
  // on the study's verification ladder, judgeable only from data collected later. 0.6 is what OpenHands
  // ships for the same mechanism, which is the only prior art there is for the number.
  criticThreshold: number;
  routes: Route[];
  rollup: Rollup[];
  // Explicit, never inferred from the absence of a route: a mistyped column must fail loudly rather
  // than silently making its cards terminal.
  //
  // Per BOARD, not one flat list of slugs. A column belongs to a board, and a flat list cannot say
  // so: renaming engineering's Done to Stage 5 rewrote the single entry `done` and thereby
  // un-terminalled features and product, whose Done columns had not been touched. Every board must
  // name at least one, or nothing on it could ever finish.
  terminal: Record<BoardName, string[]>;
  blockedColumn: string; // engineering only
  // NO `setupFeatureFlag`. The barrier is the `setup` frontmatter flag (types.ts), fixed rather than
  // configurable — this key existed, was defaulted, validated and mirrored to the UI, and was read by
  // nothing. Renaming it therefore validated cleanly and lifted the barrier in silence, which is the
  // exact failure S5 was written against, reached through the key meant to prevent it.
}

export const DEFAULT_AUTOPILOT: AutopilotConfig = {
  maxIterations: 250,
  budgetUsd: 20,
  runTimeoutMs: 1_800_000,
  attemptCap: 3,
  checkupEvery: 10,
  criticThreshold: 0.6,
  routes: [
    { board: 'features', column: 'backlog', skill: 'derive-features', verify: 'critic', next: 'todo' },
    { board: 'features', column: 'todo', skill: 'break-down', verify: 'critic', next: 'in-progress' },
    { board: 'features', column: 'in-progress', skill: 'close-out', verify: 'smoke', next: 'done' },
    { board: 'product', column: 'backlog', skill: 'design', verify: 'critic', next: 'todo' },
    { board: 'product', column: 'todo', skill: 'break-down', verify: 'critic', next: 'in-progress' },
    { board: 'engineering', column: 'backlog', skill: 'implement', verify: 'gates', next: 'review' },
    // In Progress is engineering's human column: nothing auto-pilot does puts a card there, but a
    // person drags one, the copilot moves one, or a restore puts one back. It routes to the same
    // phase as Backlog rather than being left uncovered — which is exactly the hole that once turned
    // "nothing eligible" into a reported success.
    { board: 'engineering', column: 'in-progress', skill: 'implement', verify: 'gates', next: 'review' },
    { board: 'engineering', column: 'review', skill: 'test', verify: 'gates', next: 'done' },
  ],
  rollup: [
    // A product card in In Progress has been broken down; it advances when its engineering children
    // are all terminal. No dispatch, no cost, no self-assessment — each child was verified on its
    // way there.
    {
      board: 'product',
      column: 'in-progress',
      when: 'all-children-terminal',
      action: 'advance',
      next: 'done',
    },
    // A feature does NOT advance for free: it becomes eligible for the close-out route above, which
    // exercises it end to end. Done means "this works", not "its cards were ticked".
    { board: 'features', column: 'in-progress', when: 'all-children-terminal', action: 'eligible' },
  ],
  terminal: { features: ['done'], product: ['done'], engineering: ['done'] },
  blockedColumn: 'blocked',
};

// How many of the loop's own runs may be in flight at once. A CONSTANT rather than a setting, and that is a
// ruling rather than a simplification: the loop awaits each dispatch settling, so it is strictly sequential
// whatever a number said — and a dial the backend does not act on is the AgentGPT shape this design is
// written against. It was a config key, and any value above 1 changed nothing.
//
// The thing people actually want from it — a second feature being planned while the first is being executed —
// is not more runs on one board: it is separate verticals working in separate worktrees, which is a feature of
// its own rather than a bigger number here.
export const AUTOPILOT_CONCURRENCY = 1;

export function routeFor(ap: AutopilotConfig, board: BoardName, columnSlug: string): Route | undefined {
  return ap.routes.find((r) => r.board === board && r.column === columnSlug);
}

export function isTerminalColumn(ap: AutopilotConfig, board: BoardName, columnSlug: string): boolean {
  return (ap.terminal[board] ?? []).includes(columnSlug);
}

// THE SKILL THAT DERIVES THE BOARD FROM THE README: whatever the FIRST features column routes to.
//
// It exists because of a contradiction the loop shipped with. The skill on that column reads the README and
// creates the feature list; the card it is dispatched against is only a trigger, and its content is never
// read. So a project with a README and no cards is one auto-pilot can start — but a route is per-card, and a
// per-card dispatch needs a card, which is the thing the run exists to create. The only way in was for a
// person to place a card whose sole purpose was to be dispatched against, which then advanced and was
// counted as a feature.
//
// Read off the routing table and the column order rather than named here, because both belong to the
// project: one that renamed its first column, or pointed it at a different skill, still bootstraps through
// whatever it chose. Absent — and then there is no bootstrap — for a project whose first features column is
// unrouted, which the cover check reports as the config defect it is.
export function bootstrapSkill(
  ap: AutopilotConfig,
  featureColumns: string[] | undefined,
): string | undefined {
  const first = featureColumns?.[0];
  if (first === undefined) return undefined;
  return ap.routes.find((r) => r.board === 'features' && r.column === first)?.skill;
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
    // Rollup rules name a column on both sides too, and a rule left pointing at a renamed-away column
    // is a card that quietly never completes.
    rollup: ap.rollup.map((r) =>
      r.board === board
        ? { ...r, column: to(r.column), ...(r.next === undefined ? {} : { next: to(r.next) }) }
        : r,
    ),
    // Only this board's entry: the others' Done columns were not renamed and must stay terminal.
    terminal: { ...ap.terminal, [board]: (ap.terminal[board] ?? []).map(to) },
    // Engineering's alone, so a rename anywhere else cannot be about it — and applying one would
    // point the blocked column at a slug on a board that does not have it.
    blockedColumn: board === 'engineering' ? to(ap.blockedColumn) : ap.blockedColumn,
  };
}
