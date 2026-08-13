import type { BoardName } from './types.js';

// What auto-pilot is allowed to spend, and which columns mean "finished". THE LIFECYCLE ITSELF IS NOT
// HERE — ruling 52 puts the phase table in code (core/phases.ts), because this block has already
// shipped two keys that were lies (`setupFeatureFlag`, read by nothing; `autoPilotConcurrency`, where
// any value above 1 changed nothing) and a lifecycle a person can edit is a third waiting to happen.
//
// Columns are SLUGS here. `config.boards[b].columns` holds display names ("In Progress") and
// slugging is one-way, so every comparison against config goes through `boardColumnSlugs`.

// How a card's work is judged. All of them fail closed when what they need is missing: `gates` runs
// the commands declared in foundation/CODE-QUALITY.md, `critic` dispatches a fresh judging agent
// that returns a score, `smoke` runs the command declared in foundation/TESTING.md, and `review` is
// what a `review` run answered about the work it judged (decision 51's second step, ruling 57).
//
// `review` is a MODE and not a fourth kind of thing, because a verdict is a verdict: it lands on the
// run it judged exactly as a gates failure does, carrying `by` — the review run's id — as its evidence.
export const VERIFY_MODES = ['gates', 'critic', 'smoke', 'review'] as const;
export type VerifyMode = (typeof VERIFY_MODES)[number];

// The skill a `critic` route dispatches to do its judging. Named once here rather than spelled in the
// seed, the readiness check and the loop: three copies of a slug is three places for it to drift, and a
// route whose verifier cannot be found is a card nothing can ever advance.
export const CRITIC_SKILL = 'critic';

// NO `routes` and NO `rollup`. A column dispatched a skill and a parent completed from its children;
// ruling 52 and decision 42 replaced both with the phase table in core/phases.ts, so which skill runs
// is a fact about the machine rather than about this project's config.

export interface AutopilotConfig {
  maxIterations: number;
  budgetUsd: number;
  runTimeoutMs: number;
  attemptCap: number;
  // What a critic's score must reach for a card to advance. A THRESHOLD rather than a boolean verdict
  // (S9): a binary pass yields no distribution, and the critic is this design's weakest link — level 4
  // on the study's verification ladder, judgeable only from data collected later. 0.6 is what OpenHands
  // ships for the same mechanism, which is the only prior art there is for the number.
  criticThreshold: number;
  // Explicit, never inferred: a mistyped column must fail loudly rather than silently making its
  // cards terminal.
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
  criticThreshold: 0.6,
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

export function isTerminalColumn(ap: AutopilotConfig, board: BoardName, columnSlug: string): boolean {
  return (ap.terminal[board] ?? []).includes(columnSlug);
}

// THE SKILL THAT DERIVES THE BOARD FROM THE README used to be read off this table — whatever the first
// features column routed to. It is a row in the phase table now (`bootstrap`, core/phases.ts, ruling 52), so
// the lookup here is gone: a project that had removed that route was told by the panel that it could not
// bootstrap while the loop, reading the table, would have bootstrapped it anyway.

// Engineering's alone. A product or feature card that cannot be broken down after three tries is a
// project-level problem that stops the run, so `blocked` on those boards would be a column nothing
// ever puts a card into.
export function isBlockedColumn(ap: AutopilotConfig, board: BoardName, columnSlug: string): boolean {
  return board === 'engineering' && ap.blockedColumn === columnSlug;
}

// A column IS a folder, so renaming one moves the folder (columns.ts) — and this block names columns
// by slug, so a rename left unapplied here points `terminal` or `blockedColumn` at a slug that no
// longer exists, which silently makes nothing terminal and un-blocks the blocked column.
export function applyRouteRenames(
  ap: AutopilotConfig,
  board: BoardName,
  renamed: { from: string; to: string }[],
): AutopilotConfig {
  if (renamed.length === 0) return ap;
  const to = (slug: string): string => renamed.find((r) => r.from === slug)?.to ?? slug;
  return {
    ...ap,
    // Only this board's entry: the others' Done columns were not renamed and must stay terminal.
    terminal: { ...ap.terminal, [board]: (ap.terminal[board] ?? []).map(to) },
    // Engineering's alone, so a rename anywhere else cannot be about it — and applying one would
    // point the blocked column at a slug on a board that does not have it.
    blockedColumn: board === 'engineering' ? to(ap.blockedColumn) : ap.blockedColumn,
  };
}
