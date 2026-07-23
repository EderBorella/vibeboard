export type BoardName = 'product' | 'engineering';

export interface CardFrontmatter {
  id: string;            // "P-001" | "E-010"
  title: string;
  description?: string;  // optional miniature summary
  order: number;         // position within a column
  tags: string[];
  links: string[];       // product ids; only meaningful on engineering cards
  group?: string;        // optional visual grouping label
  created: string;       // ISO date "YYYY-MM-DD"
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
  copilot: { backend: string };
}
