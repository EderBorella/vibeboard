import type { CSSProperties } from 'react';
import type { BoardName, Card, ProjectSnapshot } from '../../lib/shared';
import { BOARD_LABELS, BOARDS } from '../../lib/shared';
import type { TagCount } from '../../lib/viewmodel';
import { filterByTags } from '../../lib/viewmodel';
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
  // ONE COLUMN WIDTH ACROSS ALL THREE BOARDS. They are stacked vertically and read as a single grid, so
  // their column edges have to line up — and with each board flexing independently they did not: measured
  // at 1600px with the copilot hidden, Features (4 columns) grew to 383px while Product and Engineering
  // (5 each) sat at 304px, a 79px step between rows of what looks like one table. With the copilot open
  // the growth reached Features alone and the other two still overflowed.
  //
  // The widest board decides the track count, so every board lays out on the same tracks and a board with
  // fewer columns simply ends early. Derived from the CONFIG rather than from the rendered columns, so a
  // collapsed board still contributes its width and expanding one does not reflow the others.
  const maxColumns = Math.max(
    1,
    ...BOARDS.map((board) => snapshot.config.boards[board]?.columns.length ?? 0),
  );

  return (
    <main className="boards" style={{ '--max-cols': maxColumns } as CSSProperties}>
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
