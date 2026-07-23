import type { BoardName, Card } from '../shared';
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
  onDrop?: (board: BoardName, slug: string) => void;
}

export function Column({
  board, title, slug, cards, miniatureChars,
  onAdd, onOpen, onArchive, onDragStart, onDrop,
}: Props) {
  return (
    <div
      className="column"
      onDragOver={onDrop ? (e) => e.preventDefault() : undefined}
      onDrop={onDrop ? () => onDrop(board, slug) : undefined}
    >
      <div className="column-head">
        <span className="column-title">{title}</span>
        <span className="column-count">{cards.length}</span>
        {onAdd && (
          <button className="column-add" title="New card" onClick={() => onAdd(board, slug)}>+</button>
        )}
      </div>
      <div className="column-body">
        {cards.length === 0 && <div className="column-empty">Drop a card here</div>}
        {cards.map((c) => (
          <CardTile
            key={c.id}
            card={c}
            miniatureChars={miniatureChars}
            onOpen={onOpen}
            onArchive={onArchive}
            onDragStart={onDragStart}
          />
        ))}
      </div>
    </div>
  );
}
