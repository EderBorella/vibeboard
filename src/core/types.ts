import type { AutopilotConfig } from './autopilot.js';
import type { BoxKind } from './box-kinds.js';
import { oneOf } from './parse.js';

// The ordered set of boards, highest level of project management first. Adding a board
// here (plus its id prefix in ids.ts and default columns in config.ts) rolls it out
// everywhere — snapshot, scaffold, links, and the UI all derive from this list.
export const BOARDS = ['features', 'product', 'engineering'] as const;
export type BoardName = (typeof BOARDS)[number];

// "Is this one of these?", as a type PREDICATE rather than a boolean, built once from the list itself.
//
// The guard itself lives in `core/parse.ts`, with the argument for why. Re-exported here because this
// is where a reader looking for "how do I check a BoardName" arrives, and because a dozen modules
// already import it from this path.
export { oneOf } from './parse.js';

export const isBoard = oneOf(BOARDS);

// Human-facing labels for each board.
export const BOARD_LABELS: Record<BoardName, string> = {
  features: 'Features',
  product: 'Product',
  engineering: 'Engineering',
};

export interface CardFrontmatter {
  id: string; // "P-001" | "E-010"
  title: string;
  description?: string; // optional miniature summary
  order: number; // position within a column
  tags: string[];
  links: string[]; // ids of related cards on either board (symmetric)
  group?: string; // optional visual grouping label
  created: string; // ISO date "YYYY-MM-DD"
  // The setup feature: a project-level barrier. While it is unfinished, no card outside its subtree
  // is eligible, so the shared architectural decisions are made once rather than per feature.
  //
  // A FLAG, never a reserved id: `nextId` derives ids and never accepts one (ids.ts), so a recreated
  // F-001 would silently remove the barrier. Not accepted by the card PATCH endpoint either — a work
  // agent able to flag its own card would make its own subtree the only work in the project.
  setup?: boolean;
  // The one open FOLLOW-UP feature (decision 50). Work that arrives after the first pass has nowhere
  // to go — a project's features are done and a story carded out of a suggestion would be an orphan —
  // so those stories hang off this card. A flag rather than a title convention, because "the open
  // follow-up" must be a fact and not a guess from a title the user can rename. Same write path as
  // `setup`: service only.
  followUp?: boolean;
  // WHICH RUN CREATED THIS CARD, stamped by POST /api/cards from the credential it is already holding
  // (ruling 58). That is what makes "has this already been done?" answerable from the board with
  // nothing to trust: `RunRecord.created` is frontmatter the agent wrote about itself, and this is not.
  createdBy?: string; // a run id
  // Set only while a card sits in archive/, cleared on restore. `archived` is a full
  // timestamp (not a date like `created`) so the drawer can order by what was thrown away
  // most recently; `archivedFrom` is the column slug to put it back into.
  archived?: string; // ISO timestamp
  archivedFrom?: string; // column slug
}

// The frontmatter field set, as data. An interface has no runtime keys, so nothing could compare the web
// hand-mirror with this one — the same gap `AUTOPILOT_CONFIG_KEYS` exists to close. Asserted against
// web/src/lib/shared.ts in test/mirror.test.ts.
//
// The order is the order `serializeCard` writes them in, which is the order a person reads them in a diff.
export const CARD_FRONTMATTER_KEYS = [
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
  'createdBy',
  'archived',
  'archivedFrom',
] as const;

// A field on `CardFrontmatter` that the list above does not name. `never` when every one is covered;
// otherwise this line fails to compile and names the field the mirror guard would have missed.
type UnlistedCardField = Exclude<keyof CardFrontmatter, (typeof CARD_FRONTMATTER_KEYS)[number]>;
const _everyCardFieldIsListed: UnlistedCardField extends never ? true : UnlistedCardField = true;
void _everyCardFieldIsListed;

export interface Card extends CardFrontmatter {
  board: BoardName; // derived from path
  columnSlug: string; // derived from path; "archive" if soft-deleted
  body: string; // markdown body
  filePath: string; // absolute path on disk
}

export interface BoardConfig {
  columns: string[]; // ordered display names
}

// One saved model/effort per backend. A model id belongs to exactly one backend ("opus" to
// Claude Code, "opencode/…" to OpenCode), so a single shared slot could not survive a switch:
// changing connector fell back to the built-in default and saving then overwrote the model
// chosen for the backend being left.
export interface CopilotBackendConfig {
  model: string;
  effort: string;
}

export interface CopilotConfig {
  backend: string;
  backends: Record<string, CopilotBackendConfig>;
  // The pre-per-backend shape: a single pair describing whichever backend was selected.
  // Read during migration (ensureCopilotDefaults folds them into `backends`), never written.
  model?: string;
  effort?: string;
}

export interface ProjectConfig {
  name: string;
  boards: Record<BoardName, BoardConfig>;
  miniatureChars: number;
  idPadding: number;
  keepChats: number; // retain the last N copilot chats per project (older pruned)
  contextBudget: number; // tokens the copilot context bar treats as full
  // How many skill runs may be in flight at once. Past it, a dispatch queues rather than being
  // refused — a run is minutes of work, so "come back and click again" is the wrong answer.
  maxConcurrentRuns: number;
  // The lifecycle spine (core/autopilot.ts). Optional because migration of pre-existing projects is
  // deliberately deferred until the auto-pilot slices are all in: a project written before this
  // block fails auto-pilot's readiness check, which names what is missing. An honest refusal beats a
  // silent half-upgrade against a shape still moving.
  autopilot?: AutopilotConfig;
  // "Enforce 1-to-many relations on boards". Off by default: many-to-many linking is legitimate when
  // a person means it. Run credentials are held to it regardless (core/hierarchy.ts), because the machine
  // derives the hierarchy off these links — the position it works from, and the checkup that advances a
  // parent once its children are settled — and an agent cannot mean "see also".
  enforceOneParent?: boolean;
  // The agent box's shape: which image layer (from the kind) and which packages of the project's own
  // are replayed into a new box. Optional and never backfilled — an existing project without it keeps
  // the default image, exactly as it behaved before kinds existed. decision 75.
  box?: { kind?: BoxKind; packages?: string[] };
  copilot: CopilotConfig;
}
