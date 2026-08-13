import { type CardProblem, countArchived, readBoard } from '../core/board.js';
import { readConfig } from '../core/config.js';
import { blockedUnder } from '../core/derived-status.js';
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
  // Card id → the blocked task ids under it (decision 46). Here rather than per tile for the same
  // reason as `openSuggestions` above; ids rather than a boolean so the tile's title can name them.
  // A card with nothing blocked under it is ABSENT, not an empty array: an empty array is truthy.
  carryingAProblem: Record<string, string[]>;
}

// The field set as data, so test/mirror.test.ts can hold the web copy to it. An interface has no
// runtime keys, and until this list existed nothing compared the two sides at all.
export const SNAPSHOT_KEYS = [
  'root',
  'name',
  'config',
  'boards',
  'archivedCounts',
  'problems',
  'openSuggestions',
  'carryingAProblem',
] as const;

// `never` when every field is listed; otherwise this line fails to compile and names the one missed.
type UnlistedSnapshotField = Exclude<keyof ProjectSnapshot, (typeof SNAPSHOT_KEYS)[number]>;
const _everySnapshotFieldIsListed: UnlistedSnapshotField extends never ? true : UnlistedSnapshotField = true;
void _everySnapshotFieldIsListed;

// Every card that is carrying a problem, over the whole set rather than per board: a feature's blocked
// task is two levels down and on another board, which is why `blockedUnder` recurses.
function carryingAProblemOf(
  config: ProjectConfig,
  boards: Record<BoardName, Card[]>,
): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  const ap = config.autopilot;
  // No autopilot block is no blocked column, so nothing can be carrying anything — a project created
  // before the lifecycle existed, not an error.
  if (!ap) return found;
  const every = BOARDS.flatMap((board) => boards[board]);
  for (const card of every) {
    const blocked = blockedUnder(ap, card, every);
    if (blocked.length > 0) found[card.id] = blocked.map((c) => c.id);
  }
  return found;
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
  return {
    root: projectRoot,
    name: config.name,
    config,
    boards,
    archivedCounts,
    problems,
    openSuggestions,
    carryingAProblem: carryingAProblemOf(config, boards),
  };
}
