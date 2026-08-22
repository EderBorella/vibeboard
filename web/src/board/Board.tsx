import { useState } from 'react';
import { Chip } from '../atoms/Chip';
import { Row } from '../organisms/shared/Row';
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
  openSuggestions?: Record<string, number>;
  carryingAProblem?: Record<string, string[]>;
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
  openSuggestions,
  carryingAProblem,
  onDrop,
}: Props) {
  const [showArchive, setShowArchive] = useState(false);
  const slugs = columnSlugs(config, board);
  const grouped = cardsByColumn(cards, slugs);
  const displayNames = config.boards[board].columns;

  return (
    <section className="board">
      <div className="board-head">
        {/* A `Row` with an accent rail. `.board-label` keeps its display FACE and no geometry at all —
            which is what empties `check:radius-scale`'s button ratchet to 0/0: its `font-size` was
            `var(--t-body)`, the value `body` already gives it, and its padding is `flat`'s. */}
        <Row
          as="button"
          variant="flat"
          rail="accent"
          interactive
          className="board-label"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          <span className="board-chevron vb-twist">{collapsed ? '▸' : '▾'}</span>
          {label}
          <Chip pill fill className="vb-readout" testId="board-count">
            {cards.length}
          </Chip>
        </Row>
        {!collapsed && archivedCount > 0 && (
          <Chip
            as="button"
            pill
            fill
            tone="neutral"
            className={`board-archive vb-readout${showArchive ? ' active' : ''}`}
            testId="board-archive"
            title={showArchive ? 'Hide the archive' : 'Show archived cards'}
            ariaExpanded={showArchive}
            onClick={() => setShowArchive((v) => !v)}
          >
            🗄 {archivedCount}
          </Chip>
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
                openSuggestions={openSuggestions}
                carryingAProblem={carryingAProblem}
                onDrop={onDrop}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
