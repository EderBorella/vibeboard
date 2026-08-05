// Wire types the UI consumes. Mirrors the small public surface of src/core/types.ts
// across the Vite/tsc boundary — keep in sync with the server's core.

// Mirrors src/core/types.ts BOARDS — ordered, highest level of management first.
export const BOARDS = ['features', 'product', 'engineering'] as const;
export type BoardName = (typeof BOARDS)[number];

export const BOARD_LABELS: Record<BoardName, string> = {
  features: 'Features',
  product: 'Product',
  engineering: 'Engineering',
};

// Backends are NOT symmetric: each exposes its own modes and effort scale. The UI renders
// controls from here; the server maps these values to each CLI's flags.
export interface BackendCaps {
  modes: { value: string; label: string; hint: string }[];
  efforts: { value: string; label: string }[]; // every value is real — no blank "let it decide"
}

// Mirrors src/core/backends.ts. Real defaults, never blank: a blank model let each CLI pick
// silently, so nothing in the UI could tell you which model actually answered.
export interface BackendDefaults {
  model: string;
  effort: string;
}
export const DEFAULT_BACKEND = 'claude-code';
export const BACKEND_DEFAULTS: Record<string, BackendDefaults> = {
  'claude-code': { model: 'opus', effort: 'high' },
  opencode: { model: 'opencode/deepseek-v4-flash-free', effort: 'high' },
};
export function backendDefaults(backend: string | undefined): BackendDefaults {
  return BACKEND_DEFAULTS[backend ?? ''] ?? BACKEND_DEFAULTS[DEFAULT_BACKEND];
}

// One copilot selection. The project config holds the default (Settings writes it); the dock
// holds a partial session override that is never persisted.
// Mirrors src/core/types.ts. One saved model/effort slot per backend: a model id belongs to
// exactly one backend, so a single shared slot could not survive switching connector.
export interface CopilotBackendConfig {
  model: string;
  effort: string;
}

// Mirrors DEFAULT_CONTEXT_BUDGET in src/core/config.ts.
export const DEFAULT_CONTEXT_BUDGET = 200_000;

export interface CopilotConfig {
  backend: string;
  backends: Record<string, CopilotBackendConfig>;
  model?: string; // legacy single slot, dropped on migration
  effort?: string; // legacy single slot, dropped on migration
}

export interface CopilotChoice {
  backend: string;
  model: string;
  effort: string;
}
export const BACKEND_CAPS: Record<string, BackendCaps> = {
  'claude-code': {
    modes: [
      { value: 'research', label: 'Research', hint: 'brainstorm & web research, no edits' },
      { value: 'plan', label: 'Plan', hint: 'read & plan only, no edits' },
      { value: 'acceptEdits', label: 'Execute', hint: 'auto-accept file edits' },
      { value: 'bypassPermissions', label: 'Full-auto', hint: 'everything, unattended' },
    ],
    efforts: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'X-high' },
      { value: 'max', label: 'Max' },
    ],
  },
  opencode: {
    // Headless OpenCode always auto-approves; it has no plan/acceptEdits permission split.
    modes: [
      { value: 'build', label: 'Build', hint: 'auto-approve; can edit files' },
      { value: 'research', label: 'Research', hint: 'brainstorm & web (persona-guided, still auto)' },
    ],
    // OpenCode's own reasoning scale, sent as the message `variant`. These are the variant
    // names its models actually publish — "minimal" was listed here but isn't one of them.
    efforts: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ],
  },
};

export function backendCaps(backend: string): BackendCaps {
  return BACKEND_CAPS[backend] ?? BACKEND_CAPS['claude-code'];
}

export interface Card {
  id: string;
  title: string;
  description?: string;
  order: number;
  tags: string[];
  links: string[];
  group?: string;
  created: string;
  // The project-level barrier: while this feature is unfinished nothing outside its subtree runs.
  setup?: boolean;
  // Present only while the card sits in the archive.
  archived?: string; // ISO timestamp
  archivedFrom?: string; // column slug it left
  board: BoardName;
  columnSlug: string;
  body: string;
  filePath: string;
}

// An archived card plus where a restore would put it back — resolved server-side, since the
// original column may have been renamed away since.
export interface ArchivedCard extends Card {
  restoreTo: string;
}

// Fields the PATCH /cards endpoint accepts (frontmatter subset + optional body).
//
// `links` is NOT among them: links are symmetric, so they go through PUT /cards/:board/:id/links,
// which writes the far side and enforces one parent per card. Sending it here is ignored — and this
// interface used to say otherwise, which is the kind of false contract that earns someone a silent
// success.
export interface CardFrontmatterPatch {
  title?: string;
  description?: string;
  tags?: string[];
  group?: string;
  body?: string;
}

export interface BoardConfig {
  columns: string[];
}

// Mirrors src/core/autopilot.ts. Nothing renders the table yet — the auto-pilot settings tab is a
// later task; today the UI only asks whether the block EXISTS, to decide whether a column edit is
// about to be refused. config.yaml is where the table is edited.
// A runtime array as well as a type, so test/mirror.test.ts can compare it with the core list. A hand
// written union drifts silently; a list can be asserted.
export const VERIFY_MODES = ['gates', 'critic', 'smoke'] as const;
export type VerifyMode = (typeof VERIFY_MODES)[number];
export interface Route {
  board: BoardName;
  column: string; // slug
  skill: string;
  verify: VerifyMode;
  next: string; // slug
}
export interface Rollup {
  board: BoardName;
  column: string; // slug
  when: 'all-children-terminal';
  action: 'advance' | 'eligible';
  next?: string; // `advance` only
}
export interface AutopilotConfig {
  maxIterations: number;
  budgetUsd: number;
  runTimeoutMs: number;
  attemptCap: number;
  checkupEvery: number;
  autoPilotConcurrency: number;
  criticThreshold: number; // what a critic's score must reach for a card to advance
  routes: Route[];
  rollup: Rollup[];
  terminal: Record<BoardName, string[]>; // per board: a column belongs to one
  blockedColumn: string;
  setupFeatureFlag: string;
}

// The field set, as data. An interface has no runtime keys, so nothing could compare the two sides and
// a key added on one and not the other was a setting the UI silently could not show or save — the gap
// slice D's review found in `DiaryEntry`, one level in. Asserted in test/mirror.test.ts.
export const AUTOPILOT_CONFIG_KEYS = [
  'maxIterations',
  'budgetUsd',
  'runTimeoutMs',
  'attemptCap',
  'checkupEvery',
  'autoPilotConcurrency',
  'criticThreshold',
  'routes',
  'rollup',
  'terminal',
  'blockedColumn',
  'setupFeatureFlag',
] as const;

export interface ProjectConfig {
  name: string;
  boards: Record<BoardName, BoardConfig>;
  miniatureChars: number;
  idPadding: number;
  keepChats: number;
  contextBudget: number;
  maxConcurrentRuns: number;
  autopilot?: AutopilotConfig; // absent on a project created before the lifecycle existed
  enforceOneParent?: boolean; // one parent per card, applied to the copilot and the browser too
  copilot: CopilotConfig;
}

// Persisted copilot chat shapes — mirror src/core/chat.ts across the tsc/Vite boundary.
export type TranscriptKind = 'user' | 'assistant' | 'tool' | 'error';
export interface WireTranscriptItem {
  kind: TranscriptKind;
  text: string;
  toolName?: string;
}
export interface ChatMeta {
  id: string;
  title: string;
  backend: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ProjectSnapshot {
  root: string;
  name: string;
  config: ProjectConfig;
  boards: Record<BoardName, Card[]>;
  // Counts only — the archive list is fetched on demand. A change here is the UI's cue to
  // refetch an open drawer.
  archivedCounts: Record<BoardName, number>;
  // Open suggestions per card id. Optional here because a snapshot from an older server has none,
  // and the tile treats absent as zero rather than rendering NaN.
  openSuggestions?: Record<string, number>;
}
