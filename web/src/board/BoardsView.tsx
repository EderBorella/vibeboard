import type { BoardName, Card, ProjectSnapshot } from '../shared';
import { BOARD_LABELS, BOARDS } from '../shared';
import type { TagCount } from '../viewmodel';
import { filterByTags } from '../viewmodel';
import { Board } from './Board';
import { TagFilter } from './TagFilter';

interface Props {
  snapshot: ProjectSnapshot;
  tags: TagCount[];
  activeTags: string[];
  collapsed: Set<BoardName>;
  onToggleBoard: (board: BoardName) => void;
  onTag: (tag: string) => void;
  onClearTags: () => void;
  onAdd: (board: BoardName, columnSlug: string) => void;
  onOpen: (card: Card) => void;
  onArchive: (card: Card) => void;
  onDragStart: (card: Card) => void;
  onDrop: (board: BoardName, columnSlug: string, beforeId: string | null) => void;
}

// The three boards and the tag filter above them. Extracted from App so the shell picks a view
// rather than also building one: the board map and its dozen props were what pushed App past the
// complexity gate when the Execution tab arrived.
export function BoardsView({
  snapshot,
  tags,
  activeTags,
  collapsed,
  onToggleBoard,
  onTag,
  onClearTags,
  onAdd,
  onOpen,
  onArchive,
  onDragStart,
  onDrop,
}: Props) {
  return (
    <main className="boards">
      <TagFilter tags={tags} active={activeTags} onToggle={onTag} onClear={onClearTags} />
      {BOARDS.map((board) => (
        <Board
          key={board}
          board={board}
          label={BOARD_LABELS[board]}
          cards={filterByTags(snapshot.boards[board] ?? [], activeTags)}
          config={snapshot.config}
          archivedCount={snapshot.archivedCounts?.[board] ?? 0}
          openSuggestions={snapshot.openSuggestions}
          carryingAProblem={snapshot.carryingAProblem}
          collapsed={collapsed.has(board)}
          onToggle={() => onToggleBoard(board)}
          onAdd={onAdd}
          onOpen={onOpen}
          onArchive={onArchive}
          onDragStart={onDragStart}
          onTag={onTag}
          onDrop={onDrop}
        />
      ))}
    </main>
  );
}
