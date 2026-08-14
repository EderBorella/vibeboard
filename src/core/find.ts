import { readArchive, readBoard } from '../store/cards/board.js';
import type { BoardName, Card, ProjectConfig } from './types.js';

export async function findCard(
  projectRoot: string,
  board: BoardName,
  id: string,
  config: ProjectConfig,
): Promise<Card | undefined> {
  const [live, archived] = await Promise.all([
    readBoard(projectRoot, board, config),
    readArchive(projectRoot, board),
  ]);
  return [...live, ...archived].find((c) => c.id === id);
}
