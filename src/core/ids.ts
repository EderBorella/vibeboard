import type { BoardName } from './types.js';

export function idPrefix(board: BoardName): 'P' | 'E' {
  return board === 'product' ? 'P' : 'E';
}

export function nextId(board: BoardName, existingIds: string[], padding: number): string {
  const prefix = idPrefix(board);
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const id of existingIds) {
    const m = re.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(padding, '0')}`;
}
