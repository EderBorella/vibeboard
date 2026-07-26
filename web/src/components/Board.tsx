import { useState } from 'react';
import type { BoardName, Card, ProjectConfig } from '../shared';
import { cardsByColumn, columnSlugs } from '../viewmodel';
import { ArchiveDrawer } from './ArchiveDrawer';
import { Column } from './Column';

interface Props {
  board: BoardName;
  label: string;
  cards: Card[];
  config: ProjectConfig;
  archivedCount?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  onAdd?: (board: BoardName, slug: string) => void;
  onOpen?: (card: Card) => void;
  onArchive?: (card: Card) => void;
  onDragStart?: (card: Card) => void;
  onTag?: (tag: string) => void;
  onDrop?: (board: BoardName, slug: string, beforeId: string | null) => void;
}

export function Board({
  board,
  label,
  cards,
  config,
  archivedCount = 0,
  collapsed,
  onToggle,
  onAdd,
  onOpen,
  onArchive,
  onDragStart,
  onTag,
  onDrop,
}: Props) {
  const [showArchive, setShowArchive] = useState(false);
  const slugs = columnSlugs(config, board);
  const grouped = cardsByColumn(cards, slugs);
  const displayNames = config.boards[board].columns;

  return (
    <section className="board">
      <div className="board-head">
        <button className="board-label" onClick={onToggle} aria-expanded={!collapsed}>
          <span className="board-chevron">{collapsed ? '▸' : '▾'}</span>
          {label}
          <span className="board-count">{cards.length}</span>
        </button>
        {!collapsed && archivedCount > 0 && (
          <button
            className={`board-archive${showArchive ? ' active' : ''}`}
            title={showArchive ? 'Hide the archive' : 'Show archived cards'}
            aria-expanded={showArchive}
            onClick={() => setShowArchive((v) => !v)}
          >
            🗄 {archivedCount}
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          {showArchive && (
            <ArchiveDrawer board={board} config={config} count={archivedCount} onOpen={onOpen} />
          )}
          <div className="board-columns">
            {slugs.map((slug, i) => (
              <Column
                key={slug}
                board={board}
                title={displayNames[i]}
                slug={slug}
                cards={grouped[slug]}
                miniatureChars={config.miniatureChars}
                onAdd={onAdd}
                onOpen={onOpen}
                onArchive={onArchive}
                onDragStart={onDragStart}
                onTag={onTag}
                onDrop={onDrop}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
