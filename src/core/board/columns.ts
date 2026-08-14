import { slugify } from '../slug.js';
import type { BoardName, ProjectConfig } from '../types.js';

// A board's configured columns, as slugs. Three lines of pure config reading, and they used to live in
// `core/board.ts` beside `readdir` — so every module that needed to know a board's columns imported
// `node:fs/promises` transitively to get them, the lifecycle machine included. Here so a pure module
// can stay pure.
//
// Slugging is one-way, so every comparison against config goes through this rather than against the
// display names.
export function boardColumnSlugs(config: ProjectConfig, board: BoardName): string[] {
  return config.boards[board].columns.map(slugify);
}
