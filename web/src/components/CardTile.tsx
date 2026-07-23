import type { Card } from '../shared';
import { miniature } from '../viewmodel';

interface Props {
  card: Card;
  miniatureChars: number;
  onOpen?: (card: Card) => void;
  onArchive?: (card: Card) => void;
  onDragStart?: (card: Card) => void;
}

export function CardTile({ card, miniatureChars, onOpen, onArchive, onDragStart }: Props) {
  const summary = miniature(card, miniatureChars);
  return (
    <div
      className="tile"
      draggable={!!onDragStart}
      onDragStart={() => onDragStart?.(card)}
      onClick={() => onOpen?.(card)}
    >
      <div className="tile-head">
        <span className="tile-id">{card.id}</span>
        {card.links.length > 0 && <span className="tile-link" title={card.links.join(', ')}>🔗 {card.links.length}</span>}
        {onArchive && (
          <button
            className="tile-archive"
            title="Archive"
            onClick={(e) => { e.stopPropagation(); onArchive(card); }}
          >
            ✕
          </button>
        )}
      </div>
      <div className="tile-title">{card.title}</div>
      {summary && <div className="tile-summary">{summary}</div>}
      {card.tags.length > 0 && (
        <div className="tile-tags">
          {card.tags.map((t) => <span key={t} className="tag">{t}</span>)}
        </div>
      )}
    </div>
  );
}
