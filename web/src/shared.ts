// Wire types the UI consumes. Mirrors the small public surface of src/core/types.ts
// across the Vite/tsc boundary — keep in sync with the server's core.

export type BoardName = 'product' | 'engineering';

export interface Card {
  id: string;
  title: string;
  description?: string;
  order: number;
  tags: string[];
  links: string[];
  group?: string;
  created: string;
  board: BoardName;
  columnSlug: string;
  body: string;
  filePath: string;
}

// Fields the PATCH /cards endpoint accepts (frontmatter subset + optional body).
export interface CardFrontmatterPatch {
  title?: string;
  description?: string;
  tags?: string[];
  links?: string[];
  group?: string;
  body?: string;
}

export interface BoardConfig {
  columns: string[];
}

export interface ProjectConfig {
  name: string;
  boards: Record<BoardName, BoardConfig>;
  miniatureChars: number;
  idPadding: number;
  copilot: { backend: string };
}

export interface ProjectSnapshot {
  root: string;
  name: string;
  config: ProjectConfig;
  boards: { product: Card[]; engineering: Card[] };
}
