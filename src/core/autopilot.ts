import type { BoardName } from './types.js';

// What auto-pilot is allowed to spend, and which columns mean "finished". THE LIFECYCLE ITSELF IS NOT
// HERE — ruling 52 puts the phase table in code (core/phases.ts), because this block has already
// shipped two keys that were lies (`setupFeatureFlag`, read by nothing; `autoPilotConcurrency`, where
// any value above 1 changed nothing) and a lifecycle a person can edit is a third waiting to happen.
//
// Columns are SLUGS here. `config.boards[b].columns` holds display names ("In Progress") and
// slugging is one-way, so every comparison against config goes through `boardColumnSlugs`.

// How a card's work is judged. All three fail closed when what they need is missing: `gates` runs the
// commands declared in foundation/CODE-QUALITY.md, `smoke` runs the command declared in
// foundation/TESTING.md, and `review` is what a `review` run answered about the work it judged
// (decision 51's second step, ruling 57).
//
// `review` is a MODE and not a third kind of thing, because a verdict is a verdict: it lands on the run
// it judged exactly as a gates failure does, carrying `by` — the review run's id — as its evidence.
//
// NO `critic` (decision 40). It dispatched a fresh agent to score work against a threshold, which is a
// number a model chose about its own project — level 4 on the study's verification ladder and this
// design's weakest link. A review answers done or sent-back, and only after the gates the loop ran in its
// own process have already passed.
export const VERIFY_MODES = ['gates', 'smoke', 'review'] as const;
export type VerifyMode = (typeof VERIFY_MODES)[number];

// NO `routes` and NO `rollup`. A column dispatched a skill and a parent completed from its children;
// ruling 52 and decision 42 replaced both with the phase table in core/phases.ts, so which skill runs
// is a fact about the machine rather than about this project's config.

// HOW COARSE THE BOARD IS, and it is a choice between two behaviours written in code — never a table a
// person edits. Ruling 52's line holds: what the loop DOES stays in core/phases.ts, and this key only says
// which of two prompts the creating phases are given. The phase table, the walker and every bound are the
// same under both.
//
// `express` trades granularity for cost: one feature card listing the plan, one story per bullet, one task
// per story. Measured on the same README and the same config — 24 runs against 80, $14.06 against $41.07,
// 37 minutes against 109, and a product that passes its smoke test either way. The saving is almost all
// break-downs and the implement/review/checkup cycles each extra card creates.
//
// NOT A LIE OF A KEY, which this block has shipped twice (`setupFeatureFlag`, `autoPilotConcurrency`) and
// says so above. `express` is read on the dispatch path — server/runs/routes.ts computes it from here and
// server/runs/prompt/sections.ts renders a section from it — and a project set to it whose prompts did not
// change would be the same defect a third time.
export const LIFECYCLE_MODES = ['standard', 'express'] as const;
export type LifecycleMode = (typeof LIFECYCLE_MODES)[number];

export function isLifecycleMode(value: unknown): value is LifecycleMode {
  return typeof value === 'string' && (LIFECYCLE_MODES as readonly string[]).includes(value);
}

export interface AutopilotConfig {
  maxIterations: number;
  budgetUsd: number;
  runTimeoutMs: number;
  attemptCap: number;
  // Explicit, never inferred: a mistyped column must fail loudly rather than silently making its
  // cards terminal.
  //
  // Per BOARD, not one flat list of slugs. A column belongs to a board, and a flat list cannot say
  // so: renaming engineering's Done to Stage 5 rewrote the single entry `done` and thereby
  // un-terminalled features and product, whose Done columns had not been touched. Every board must
  // name at least one, or nothing on it could ever finish.
  terminal: Record<BoardName, string[]>;
  // ONE SLUG FOR EVERY BOARD THAT HAS THE COLUMN (`BLOCKED_BOARDS`), not one per board: a card that ran
  // out of attempts means the same thing wherever it sits, and a second key would be a second answer.
  blockedColumn: string;
  // Which of the two lifecycles above. Defaulted rather than optional: `ensureAutopilotKeys` backfills
  // every key this default carries, so an existing project reads `standard` and behaves exactly as it did.
  mode: LifecycleMode;
  // ONE FEATURE THE LOOP CONFINES ITSELF TO, by id, or absent for the whole board.
  //
  // OPTIONAL AND ABSENT FROM `DEFAULT_AUTOPILOT` ON PURPOSE. `ensureAutopilotKeys` backfills every key the
  // default carries, so a defaulted one would write `focus:` into every project's config file — a key that
  // says nothing, in every clone, for a feature almost no project uses.
  //
  // AN INPUT, NOT A CURSOR, which is why decision 39 does not refuse it. That decision refuses auto-pilot
  // STORING where it is: the position is derived from the board every tick so a restart needs no memory and
  // a person dragging a card cannot be contradicted. This is the opposite direction — a person saying which
  // feature to work on — and the derivation still does all the deciding, over a narrowed list.
  //
  // Held here rather than in autopilot-state.json for the same reason: that file is the loop's own memory
  // of its own run, and a person's instruction is not that.
  focus?: string;
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
  terminal: { features: ['done'], product: ['done'], engineering: ['done'] },
  blockedColumn: 'blocked',
  mode: 'standard',
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

// WHICH BOARDS HAVE A BLOCKED COLUMN, and features is not one of them.
//
// Product is here by decision 45's 2026-08-13 correction. "Engineering's alone" was argued from a
// break-down that cannot succeed having "nothing below it to carry on with" — true of a feature, and false
// of a story, which sits among siblings exactly as a task does. One redundant story that could not be
// broken down burned its attempts and stopped the entire project, with three untouched features queued
// behind it: the failure decision 45 exists to prevent, one level up.
//
// A FEATURE STILL STOPS THE LOOP AND NAMES ITSELF. It is the top of its own vertical, so there is no
// sibling to carry on with, and blocking it would park every feature after it behind a card nothing reads.
export const BLOCKED_BOARDS: readonly BoardName[] = ['product', 'engineering'];

export function isBlockedColumn(ap: AutopilotConfig, board: BoardName, columnSlug: string): boolean {
  return BLOCKED_BOARDS.includes(board) && ap.blockedColumn === columnSlug;
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
    // ENGINEERING'S RENAME ONLY, although product has the column too: one key names a slug on both
    // boards, so following a product rename would point engineering's blocked column at a slug
    // engineering does not have. Neither direction can be right for both boards, and this one keeps the
    // key answering for the board whose blocked column cannot be removed at all (autopilot-cover.ts).
    // A product Blocked column renamed out from under the key stops matching it, and the stamp then
    // fails closed and says so (core/tick.ts) rather than writing a card into a folder nothing reads.
    blockedColumn: board === 'engineering' ? to(ap.blockedColumn) : ap.blockedColumn,
  };
}
