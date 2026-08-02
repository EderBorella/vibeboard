import { type CardProblem, countArchived, readBoard } from '../core/board.js';
import { readConfig } from '../core/config.js';
import { BOARDS, type BoardName, type Card, type ProjectConfig } from '../core/types.js';
import { listSuggestions } from './suggestion-store.js';

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
  // Open suggestions per card id. On the snapshot rather than fetched per tile, because the board
  // re-renders on every file change and the point is that a card with work left behind must not
  // read as plainly done — a badge that arrives a request later is a badge nobody sees.
  openSuggestions: Record<string, number>;
}

export async function buildSnapshot(projectRoot: string): Promise<ProjectSnapshot> {
  const config = await readConfig(projectRoot);
  const problems: CardProblem[] = [];
  const [read, counts, active] = await Promise.all([
    Promise.all(BOARDS.map((board) => readBoard(projectRoot, board, config, problems))),
    Promise.all(BOARDS.map((board) => countArchived(projectRoot, board))),
    listSuggestions(projectRoot, 'active'),
  ]);
  const openSuggestions: Record<string, number> = {};
  for (const s of active) {
    if (s.card) openSuggestions[s.card] = (openSuggestions[s.card] ?? 0) + 1;
  }
  const boards = {} as Record<BoardName, Card[]>;
  const archivedCounts = {} as Record<BoardName, number>;
  BOARDS.forEach((board, i) => {
    boards[board] = read[i];
    archivedCounts[board] = counts[i];
  });
  return { root: projectRoot, name: config.name, config, boards, archivedCounts, problems, openSuggestions };
}
