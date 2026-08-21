import { renderMarkdown } from '../markdown';
import { BOARD_LABELS, type Card, type CardFrontmatterPatch, type ProjectConfig } from '../shared';
import { InlineField } from '../ui/InlineField';
import { Readout, ReadoutLine } from '../ui/Readout';
import { cardPlace, csv, parseCsv } from '../viewmodel';
import { CardLinks } from './CardLinks';

interface Props {
  card: Card;
  config: ProjectConfig;
  allCards: Card[];
  // Opens a linked card. Without it the links stay plain rows rather than promising navigation
  // that cannot happen.
  onOpenCard?: (card: Card) => void;
  // Commits one field. Absent for an archived card: the patch would succeed on disk, but archived
  // cards are not in the snapshot, so the pane could never show the result.
  onPatch?: (patch: CardFrontmatterPatch) => void;
  onLinks?: (links: string[]) => void;
}

// The card as a reader sees it, and — where a patch handler is given — as an editor does: every
// field is click-to-edit in place, committing on its own rather than through a form and a Save.
export function CardView({ card, config, allCards, onOpenCard, onPatch, onLinks }: Props) {
  const field = (
    key: keyof CardFrontmatterPatch & ('title' | 'description' | 'group'),
    label: string,
    placeholder: string,
    className: string,
  ) =>
    onPatch ? (
      <InlineField
        value={card[key] ?? ''}
        label={label}
        placeholder={placeholder}
        className={className}
        required={key === 'title'}
        onCommit={(value) => onPatch({ [key]: value })}
      />
    ) : null;

  return (
    <article className="cardview">
      {onPatch ? field('title', 'title', 'Untitled', 'cv-title') : <h2 className="cv-title">{card.title}</h2>}

      <ReadoutLine>
        <span>
          {BOARD_LABELS[card.board]} › {cardPlace(config, card)}
        </span>
        <Readout size="plain">Created {card.created}</Readout>
        {onPatch
          ? field('group', 'group', '+ group', 'cv-group')
          : card.group && <span className="cv-group">{card.group}</span>}
      </ReadoutLine>

      {onPatch ? (
        <InlineField
          value={csv(card.tags)}
          label="tags"
          placeholder="+ tags"
          className="cv-tags-edit"
          display={(value) => (
            <span className="cv-tags">
              {parseCsv(value).map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </span>
          )}
          onCommit={(value) => onPatch({ tags: parseCsv(value) })}
        />
      ) : (
        card.tags.length > 0 && (
          <div className="cv-tags">
            {card.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )
      )}

      {onPatch
        ? field('description', 'description', '+ description', 'cv-desc')
        : card.description && <p className="cv-desc">{card.description}</p>}

      <CardLinks card={card} allCards={allCards} onOpenCard={onOpenCard} onLinks={onLinks} />

      {onPatch ? (
        <InlineField
          value={card.body}
          label="body"
          placeholder="+ body"
          className="cv-body markdown"
          multiline
          rows={10}
          display={(value) => <>{renderMarkdown(value)}</>}
          onCommit={(body) => onPatch({ body })}
        />
      ) : card.body.trim() ? (
        <div className="markdown cv-body">{renderMarkdown(card.body)}</div>
      ) : (
        <div className="vb-empty">No body yet.</div>
      )}
    </article>
  );
}
