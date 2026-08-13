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
  // The one open follow-up feature, which is where work carded out of a suggestion hangs off.
  followUp?: boolean;
  // Present only while the card sits in the archive.
  archived?: string; // ISO timestamp
  archivedFrom?: string; // column slug it left
  board: BoardName;
  columnSlug: string;
  body: string;
  filePath: string;
}

// The card's FRONTMATTER fields, as data, so test/mirror.test.ts can hold this hand-mirror to
// CARD_FRONTMATTER_KEYS in src/core/types.ts. There was no such guard until now, which is why `setup`
// reached the wire with this side carrying it only by luck.
//
// The four DERIVED fields above (board, columnSlug, body, filePath) are not in it: they come from the
// file's path and its body rather than from its frontmatter, so they are not part of the comparison.
export const CARD_FIELDS = [
  'id',
  'title',
  'description',
  'order',
  'tags',
  'links',
  'group',
  'created',
  'setup',
  'followUp',
  'archived',
  'archivedFrom',
] as const;

export const CARD_FIELDS_NOT_MIRRORED = [
  // Which run created the card. It is how the loop answers "has this already been done?" from the board;
  // nothing on screen shows it, and a run id on a tile would invite reading it as provenance the user is
  // meant to act on.
  'createdBy',
] as const;

// A frontmatter field on the interface above that `CARD_FIELDS` does not name. `never` when every one is
// there; otherwise this line fails to compile and names the field the guard would have missed.
type UnlistedCardField = Exclude<
  keyof Card,
  (typeof CARD_FIELDS)[number] | 'board' | 'columnSlug' | 'body' | 'filePath'
>;
const _everyCardFieldIsListed: UnlistedCardField extends never ? true : UnlistedCardField = true;
void _everyCardFieldIsListed;

// What an agent found and deliberately did not act on. Mirrors src/core/suggestions.ts — nothing in the
// browser could read one until now, so this side carried only the per-card count on the snapshot.
export const SUGGESTION_STATES = ['active', 'actioned', 'dismissed'] as const;
export type SuggestionState = (typeof SUGGESTION_STATES)[number];

export interface Suggestion {
  id: string;
  state: SuggestionState;
  created: string; // ISO
  title: string;
  run?: string; // the run that filed it
  card?: string; // the card it was filed FROM
  // Why it was rejected. What stops a later checkup re-raising the same thing.
  reason?: string;
  // The card it BECAME when it was carded. A different fact from `card` above.
  became?: string;
  body: string;
}

export const SUGGESTION_FIELDS = [
  'id',
  'state',
  'created',
  'title',
  'run',
  'card',
  'reason',
  'became',
  'body',
] as const;

export const SUGGESTION_NOT_MIRRORED = [
  // Which board the finding was about. `POST /api/suggestions` deliberately does not accept it — a
  // Credential carries no board, so it could only come from the caller — so nothing writes it and there
  // is nothing to render. The card id names its board anyway.
  'board',
] as const;

// `never` when every field is listed; otherwise this line fails to compile and names the one missed.
type UnlistedSuggestionField = Exclude<keyof Suggestion, (typeof SUGGESTION_FIELDS)[number]>;
const _everySuggestionFieldIsListed: UnlistedSuggestionField extends never ? true : UnlistedSuggestionField =
  true;
void _everySuggestionFieldIsListed;

// The two levels a suggestion may be carded at (decision 49). A task is not one of them: it needs a
// story to belong to, so carding one either hunts for a parent or makes an orphan.
export const SUGGESTION_LEVELS = ['feature', 'story'] as const;
export type SuggestionLevel = (typeof SUGGESTION_LEVELS)[number];

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
export const VERIFY_MODES = ['gates', 'critic', 'smoke', 'review'] as const;
export type VerifyMode = (typeof VERIFY_MODES)[number];
export interface Route {
  board: BoardName;
  column: string; // slug
  skill: string;
  verify: VerifyMode;
  next: string; // slug
}
export interface AutopilotConfig {
  maxIterations: number;
  budgetUsd: number;
  runTimeoutMs: number;
  attemptCap: number;
  checkupEvery: number;
  criticThreshold: number; // what a critic's score must reach for a card to advance
  routes: Route[];
  terminal: Record<BoardName, string[]>; // per board: a column belongs to one
  blockedColumn: string;
}

// The field set, as data. An interface has no runtime keys, so nothing could compare the two sides and
// a key added on one and not the other was a setting the UI silently could not show or save — the gap
// slice D's review found in `DiaryEntry`, one level in. Asserted in test/mirror.test.ts.
// Mirrors MAX_ENTRY_TEXT in src/core/diary.ts. The server truncates an entry past this; the composer
// refuses to accept more, so a person never watches their own paragraph shortened on save. Here rather
// than in api.ts because it is a mirrored CONSTANT like the lists around it — and because api.ts is
// mocked wholesale by several component tests, which would each have to fake it.
export const MAX_ENTRY_TEXT = 2000;

export const AUTOPILOT_CONFIG_KEYS = [
  'maxIterations',
  'budgetUsd',
  'runTimeoutMs',
  'attemptCap',
  'checkupEvery',
  'criticThreshold',
  'routes',
  'terminal',
  'blockedColumn',
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
  // Card id → the blocked task ids under it (decision 46). Optional for the same reason, and a card
  // with nothing blocked under it is absent rather than an empty array.
  carryingAProblem?: Record<string, string[]>;
}

// The snapshot's field set, as data — the same guard the run record and the card frontmatter carry, for
// the type every tile on the board renders from. Asserted in test/mirror.test.ts.
export const SNAPSHOT_FIELDS = [
  'root',
  'name',
  'config',
  'boards',
  'archivedCounts',
  'openSuggestions',
  'carryingAProblem',
] as const;

// Fields the server puts on the snapshot that the UI deliberately does not carry, with the reason.
export const SNAPSHOT_NOT_MIRRORED = [
  // Files in a column folder that could not be read as cards. It has never been on this side: the
  // board renders cards, and an unreadable file has no tile. Listed rather than quietly absent so the
  // NEXT omission still fails this guard.
  'problems',
] as const;

// `never` when every field is listed; otherwise this line fails to compile and names the one missed.
type UnlistedSnapshotField = Exclude<keyof ProjectSnapshot, (typeof SNAPSHOT_FIELDS)[number]>;
const _everySnapshotFieldIsListed: UnlistedSnapshotField extends never ? true : UnlistedSnapshotField = true;
void _everySnapshotFieldIsListed;
