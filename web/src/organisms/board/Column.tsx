import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import type { BoardName, Card } from '../../lib/shared';
import { CardTile } from './CardTile';

interface Props {
  board: BoardName;
  title: string;
  slug: string;
  cards: Card[];
  miniatureChars: number;
  onAdd?: (board: BoardName, slug: string) => void;
  onOpen?: (card: Card) => void;
  onArchive?: (card: Card) => void;
  onDragStart?: (card: Card) => void;
  onTag?: (tag: string) => void;
  // Open suggestions per card id, straight from the snapshot. Threaded rather than fetched here:
  // the board re-renders on every file change, and a badge that arrives a request later is a badge
  // beforeId identifies the card to insert in front of; null means the end of the column.
  onDrop?: (board: BoardName, slug: string, beforeId: string | null) => void;
}

export function Column({
  board,
  title,
  slug,
  cards,
  miniatureChars,
  onAdd,
  onOpen,
  onArchive,
  onDragStart,
  onTag,
  onDrop,
}: Props) {
  const [over, setOver] = useState(false);
  // Which gap the card would land in: 0 = above the first tile, cards.length = at the end.
  const [gap, setGap] = useState<number | null>(null);

  const reset = (): void => {
    setOver(false);
    setGap(null);
  };
  const release = (e: React.DragEvent): void => {
    e.preventDefault();
    const at = gap ?? cards.length;
    reset();
    onDrop?.(board, slug, at >= cards.length ? null : cards[at].id);
  };

  return (
    <Surface
      variant="raised"
      className={`column${over ? ' column-over' : ''}`}
      data-testid="column"
      header={
        <>
          {/* `caps` is the display face and `lead` the `--t-body` step; the brackets are the class. */}
          <Text caps lead className="column-title">
            {title}
          </Text>
          <Chip pill fill className="vb-readout" testId="column-count">
            {cards.length}
          </Chip>
          {onAdd && (
            <Button
              variant="bare"
              size="sm"
              className="push"
              title="New card"
              onClick={() => onAdd(board, slug)}
            >
              +
            </Button>
          )}
        </>
      }
      onDragOver={
        onDrop
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOver(true);
              setGap((g) => g ?? cards.length); // over the column but not a tile → the end
            }
          : undefined
      }
      onDragLeave={
        onDrop
          ? (e) => {
              // Ignore leaves fired while crossing between children of this column.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) reset();
            }
          : undefined
      }
      onDrop={onDrop ? release : undefined}
    >
      <Stack direction="column" gap={4} className="column-body">
        {cards.length === 0 && <Text className="column-empty">Drop a card here</Text>}
        {cards.map((c, i) => (
          <div
            key={c.id}
            // Each tile owns the two gaps around it: the pointer's half decides which. Stop
            // propagation so the column's own handler doesn't overwrite it with "the end".
            onDragOver={
              onDrop
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const box = e.currentTarget.getBoundingClientRect();
                    setOver(true);
                    setGap(e.clientY < box.top + box.height / 2 ? i : i + 1);
                  }
                : undefined
            }
          >
            {gap === i && <div className="drop-line" />}
            <CardTile
              card={c}
              miniatureChars={miniatureChars}
              onOpen={onOpen}
              onArchive={onArchive}
              onDragStart={onDragStart}
              onTag={onTag}
            />
          </div>
        ))}
        {gap !== null && gap >= cards.length && cards.length > 0 && <div className="drop-line" />}
      </Stack>
    </Surface>
  );
}
