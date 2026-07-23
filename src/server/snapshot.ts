import { readConfig } from '../core/config.js';
import { readBoard } from '../core/board.js';
import { BOARDS, type BoardName, type Card, type ProjectConfig } from '../core/types.js';

export interface ProjectSnapshot {
  root: string;
  name: string;
  config: ProjectConfig;
  boards: Record<BoardName, Card[]>;
}

export async function buildSnapshot(projectRoot: string): Promise<ProjectSnapshot> {
  const config = await readConfig(projectRoot);
  const read = await Promise.all(BOARDS.map((board) => readBoard(projectRoot, board, config)));
  const boards = {} as Record<BoardName, Card[]>;
  BOARDS.forEach((board, i) => { boards[board] = read[i]; });
  return { root: projectRoot, name: config.name, config, boards };
}
