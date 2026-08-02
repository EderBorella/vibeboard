import { type CardProblem, countArchived, readBoard } from '../core/board.js';
import { readConfig } from '../core/config.js';
import { BOARDS, type BoardName, type Card, type ProjectConfig } from '../core/types.js';

export interface ProjectSnapshot {
  root: string;
  name: string;
  config: ProjectConfig;
  boards: Record<BoardName, Card[]>;
  // Counts only, not the cards: the snapshot is pushed on every file change, and the archive
  // grows without bound. The count keeps the drawer's badge live and tells the UI when to
  // refetch the list from GET /api/archive/:board.
  archivedCounts: Record<BoardName, number>;
  // Files in a column folder that could not be read as cards. Carried on the snapshot rather than
  // only logged: the card is missing from the board, and the person looking for it is looking at
  // the board. Normally empty.
  problems: CardProblem[];
}

export async function buildSnapshot(projectRoot: string): Promise<ProjectSnapshot> {
  const config = await readConfig(projectRoot);
  const problems: CardProblem[] = [];
  const [read, counts] = await Promise.all([
    Promise.all(BOARDS.map((board) => readBoard(projectRoot, board, config, problems))),
    Promise.all(BOARDS.map((board) => countArchived(projectRoot, board))),
  ]);
  const boards = {} as Record<BoardName, Card[]>;
  const archivedCounts = {} as Record<BoardName, number>;
  BOARDS.forEach((board, i) => {
    boards[board] = read[i];
    archivedCounts[board] = counts[i];
  });
  return { root: projectRoot, name: config.name, config, boards, archivedCounts, problems };
}
