import { useState } from 'react';
import { Chip } from '../../atoms/Chip';
import { Stack } from '../../atoms/Stack';
import { Text } from '../../atoms/Text';
import type { BoardName, Card, ProjectConfig } from '../../lib/shared';
import { cardsByColumn, columnSlugs } from '../../lib/viewmodel';
import { Row } from '../shared/Row';
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
    <Stack direction="column" gap={4} as="section">
      <Stack gap={4}>
        {/* A `Row` with an accent rail, and it now names NO class of its own: `.board-label` was the caps
            face and the `--text` ink, which are `Text caps ink="strong"` on the label itself. Selected in
            the tests by `data-testid` for exactly that reason. */}
        <Row
          as="button"
          variant="flat"
          rail="accent"
          interactive
          data-testid="board-head"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          <Text ink="accent" className="board-chevron vb-twist">
            {collapsed ? '▸' : '▾'}
          </Text>
          <Text caps ink="strong">
            {label}
          </Text>
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
            className={`board-archive vb-fixed vb-readout${showArchive ? ' active' : ''}`}
            testId="board-archive"
            title={showArchive ? 'Hide the archive' : 'Show archived cards'}
            ariaExpanded={showArchive}
            onClick={() => setShowArchive((v) => !v)}
          >
            🗄 {archivedCount}
          </Chip>
        )}
      </Stack>
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
    </Stack>
  );
}
