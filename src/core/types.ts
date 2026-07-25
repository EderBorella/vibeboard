// The ordered set of boards, highest level of project management first. Adding a board
// here (plus its id prefix in ids.ts and default columns in config.ts) rolls it out
// everywhere — snapshot, scaffold, links, and the UI all derive from this list.
export const BOARDS = ['features', 'product', 'engineering'] as const;
export type BoardName = (typeof BOARDS)[number];

// Human-facing labels for each board.
export const BOARD_LABELS: Record<BoardName, string> = {
  features: 'Features',
  product: 'Product',
  engineering: 'Engineering',
};

export interface CardFrontmatter {
  id: string;            // "P-001" | "E-010"
  title: string;
  description?: string;  // optional miniature summary
  order: number;         // position within a column
  tags: string[];
  links: string[];       // ids of related cards on either board (symmetric)
  group?: string;        // optional visual grouping label
  created: string;       // ISO date "YYYY-MM-DD"
  // Set only while a card sits in archive/, cleared on restore. `archived` is a full
  // timestamp (not a date like `created`) so the drawer can order by what was thrown away
  // most recently; `archivedFrom` is the column slug to put it back into.
  archived?: string;     // ISO timestamp
  archivedFrom?: string; // column slug
}

export interface Card extends CardFrontmatter {
  board: BoardName;      // derived from path
  columnSlug: string;    // derived from path; "archive" if soft-deleted
  body: string;          // markdown body
  filePath: string;      // absolute path on disk
}

export interface BoardConfig {
  columns: string[];     // ordered display names
}

export interface ProjectConfig {
  name: string;
  boards: Record<BoardName, BoardConfig>;
  miniatureChars: number;
  idPadding: number;
  keepChats: number;     // retain the last N copilot chats per project (older pruned)
  copilot: { backend: string; model?: string; effort?: string };
}
