import { renderMarkdown } from '../markdown';
import { BOARD_LABELS, type Card, type ProjectConfig } from '../shared';
import { cardPlace, linkedCards } from '../viewmodel';

interface Props {
  card: Card;
  config: ProjectConfig;
  allCards: Card[];
  // Opens a linked card. Without it the links stay plain rows — nothing in the archive drawer's
  // future or a preview pane should promise navigation it cannot perform.
  onOpenCard?: (card: Card) => void;
}

// The card as a reader sees it: the frontmatter as chrome, the body as rendered markdown, and no
// control that could change anything. The editing surfaces are the Form and Raw tabs.
export function CardView({ card, config, allCards, onOpenCard }: Props) {
  const linked = linkedCards(allCards, card.links);

  return (
    <article className="cardview">
      <h2 className="cv-title">{card.title}</h2>

      <div className="cv-meta">
        <span className="cv-crumb">
          {BOARD_LABELS[card.board]} › {cardPlace(config, card)}
        </span>
        <span className="cv-created">Created {card.created}</span>
        {card.group && <span className="cv-group">{card.group}</span>}
      </div>

      {card.tags.length > 0 && (
        <div className="cv-tags">
          {card.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      )}

      {card.description && <p className="cv-desc">{card.description}</p>}

      {linked.length > 0 && (
        <div className="cv-links">
          <div className="cv-label">Linked cards</div>
          {linked.map((c) =>
            onOpenCard ? (
              <button
                key={c.id}
                type="button"
                className="cv-link cv-link-btn"
                title={`Open ${c.id}`}
                onClick={() => onOpenCard(c)}
              >
                <span className="link-id">{c.id}</span>
                <span className="link-title">{c.title}</span>
              </button>
            ) : (
              <div key={c.id} className="cv-link">
                <span className="link-id">{c.id}</span>
                <span className="link-title">{c.title}</span>
              </div>
            ),
          )}
        </div>
      )}

      {card.body.trim() ? (
        <div className="markdown cv-body">{renderMarkdown(card.body)}</div>
      ) : (
        <div className="cv-nobody">No body yet.</div>
      )}
    </article>
  );
}
