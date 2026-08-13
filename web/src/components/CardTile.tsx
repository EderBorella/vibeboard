import type { Card } from '../shared';
import { miniature } from '../viewmodel';

interface Props {
  card: Card;
  miniatureChars: number;
  onOpen?: (card: Card) => void;
  onArchive?: (card: Card) => void;
  onDragStart?: (card: Card) => void;
  // Clicking a tag on the tile toggles it in the board filter. Omitted where filtering makes no
  // sense (the archive drawer), which leaves the tags as plain labels.
  onTag?: (tag: string) => void;
  // Work the agent found and deliberately did not do. Nothing blocks on a suggestion, so a card can
  // pass every gate and advance with things left behind — the tile has to say so, because the
  // blocker belongs in the artefact a human reviews rather than in a log.
  openSuggestions?: number;
  // The blocked task ids under this card (decision 46). A card's OWN state is its column, which the
  // board already shows; this is the part a person cannot see from here — a story in Done carrying a
  // blocked task must not look identical to one that finished clean.
  carryingAProblem?: string[];
}

export function CardTile({
  card,
  miniatureChars,
  onOpen,
  onArchive,
  onDragStart,
  onTag,
  openSuggestions = 0,
  carryingAProblem,
}: Props) {
  const summary = miniature(card, miniatureChars);
  // Non-empty, not merely present: an empty array is truthy, and the clean card is the ordinary case —
  // a badge on every tile is a badge that says nothing.
  const blocked = carryingAProblem ?? [];
  return (
    <div
      className="tile"
      draggable={!!onDragStart}
      onDragStart={(e) => {
        // setData is required for the browser to actually start a native drag (Firefox
        // won't drag at all without it). dragged card is tracked in App via onDragStart.
        e.dataTransfer.setData('text/plain', card.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(card);
      }}
      onClick={() => onOpen?.(card)}
    >
      <div className="tile-head">
        <span className="tile-id">{card.id}</span>
        {card.setup && (
          // The project-level barrier. Worth a badge because its effect is invisible from the card
          // it is on: nothing outside this feature's subtree runs until it is finished, so a board
          // that looks stuck is explained by a tile somewhere else.
          <span className="tile-setup" title="The setup feature — nothing outside it runs until it is done">
            setup
          </span>
        )}
        {openSuggestions > 0 && (
          <span
            className="tile-suggestions"
            title={`${openSuggestions} open ${openSuggestions === 1 ? 'suggestion' : 'suggestions'}`}
          >
            ⚑ {openSuggestions}
          </span>
        )}
        {blocked.length > 0 && (
          <span
            className="tile-problem"
            // Every one of them, not just the first: the ids are what a person goes and looks at.
            title={`Carrying ${blocked.length === 1 ? 'a blocked task' : `${blocked.length} blocked tasks`}: ${blocked.join(', ')}`}
          >
            ⚠ {blocked.length}
          </span>
        )}
        {card.links.length > 0 && (
          <span className="tile-link" title={card.links.join(', ')}>
            🔗 {card.links.length}
          </span>
        )}
        {onArchive && (
          <button
            className="tile-archive"
            title="Archive"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(card);
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div className="tile-title">{card.title}</div>
      {summary && <div className="tile-summary">{summary}</div>}
      {card.group && <div className="tile-group">{card.group}</div>}
      {card.tags.length > 0 && (
        <div className="tile-tags">
          {card.tags.map((t) =>
            onTag ? (
              <button
                key={t}
                className="tag tag-btn"
                title={`Filter by ${t}`}
                // Without this the tile's own onClick opens the editor as well.
                onClick={(e) => {
                  e.stopPropagation();
                  onTag(t);
                }}
              >
                {t}
              </button>
            ) : (
              <span key={t} className="tag">
                {t}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
