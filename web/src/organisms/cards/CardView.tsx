import { Chip } from '../../atoms/Chip';
import { Icon } from '../../atoms/Icon';
import { Readout } from '../../atoms/Readout';
import { Text } from '../../atoms/Text';
import { renderMarkdown } from '../../lib/markdown';
import { BOARD_LABELS, type Card, type CardFrontmatterPatch, type ProjectConfig } from '../../lib/shared';
import { cardPlace, csv, parseCsv } from '../../lib/viewmodel';
import { Field } from '../../molecules/Field';
import { FigureRow } from '../../molecules/FigureRow';
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
  // WORK THE AGENT FOUND AND DELIBERATELY DID NOT DO. Nothing blocks on a suggestion, so a card can pass
  // every gate and advance with things left behind — and the blocker belongs in the artefact a human
  // reviews rather than in a log.
  openSuggestions?: number;
  // The blocked CARD ids under this card (decision 46). A card's OWN state is its column, which the
  // board already shows; this is the part a person cannot see from there — a story in Done carrying a
  // blocked task must not look identical to one that finished clean.
  //
  // Cards and not tasks, since decision 45's 2026-08-13 correction: a feature can be carrying a story
  // nobody could break down, so a tooltip that says "task" names the wrong kind of thing on screen.
  carryingAProblem?: string[];
}

// THE THREE STATE BADGES, moved here from the board tile on 2026-09-02. They were in the tile's head, and
// once the glyphs became icons that row had no slack left — see the note in organisms/board/CardTile.tsx.
// They belong to the card rather than to its miniature: this is the artefact a person opens to decide
// something, and a state worth acting on is worth reading where the deciding happens.
//
// The tones are the meaning rather than the styling: accent for structure, warn for something left
// behind, bad for a real failure inside something that says it finished. They are three of the five in
// design/state-tones.ts, rendered by the `.vb-tone-*` rules in atoms/chip.css.
//
// That sentence used to name `organisms/board/tile-states.css`, which has never existed in this
// repository. It came over with the badges from the tile and was re-authored here, where it became the
// only occurrence of the name — a comment failing CLAUDE.md's "is it still true?" clause, and one no
// gate can see, since check:citations reads decision and slice identifiers and not file paths.
//
// LIFTED OUT OF `CardView` rather than inlined, for the reason `BackendStatus` was: three conditionals of
// its own on a function already at the complexity ceiling. Flattening beats a suppression.
function StateBadges({
  card,
  openSuggestions,
  carryingAProblem,
}: {
  card: Card;
  openSuggestions: number;
  carryingAProblem: string[] | undefined;
}) {
  // Non-empty, not merely present: an empty array is truthy, and the clean card is the ordinary case —
  // a badge on every card is a badge that says nothing.
  const blocked = carryingAProblem ?? [];
  return (
    <>
      {card.setup && (
        <Chip
          tone="accent"
          testId="cv-setup"
          title="The setup feature — nothing outside it runs until it is done"
        >
          <Text size="inherit" ink="inherit" caps nowrap>
            setup
          </Text>
        </Chip>
      )}
      {openSuggestions > 0 && (
        <Chip
          tone="warn"
          testId="cv-suggestions"
          title={`${openSuggestions} open ${openSuggestions === 1 ? 'suggestion' : 'suggestions'}`}
        >
          <Text size="inherit" ink="inherit" nowrap>
            <Icon name="flag" /> {openSuggestions}
          </Text>
        </Chip>
      )}
      {blocked.length > 0 && (
        <Chip
          tone="bad"
          testId="cv-problem"
          // Every one of them, not just the first: the ids are what a person goes and looks at.
          title={`Carrying ${blocked.length === 1 ? 'a blocked card' : `${blocked.length} blocked cards`}: ${blocked.join(', ')}`}
        >
          <Text size="inherit" ink="inherit" nowrap>
            <Icon name="warning" /> {blocked.length}
          </Text>
        </Chip>
      )}
    </>
  );
}

// The card as a reader sees it, and — where a patch handler is given — as an editor does: every
// field is click-to-edit in place, committing on its own rather than through a form and a Save.
export function CardView({
  card,
  config,
  allCards,
  onOpenCard,
  onPatch,
  onLinks,
  openSuggestions = 0,
  carryingAProblem,
}: Props) {
  const field = (
    key: keyof CardFrontmatterPatch & ('title' | 'description' | 'group'),
    label: string,
    placeholder: string,
    className: string,
  ) =>
    onPatch ? (
      <Field
        inline
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

      <FigureRow>
        <span>
          {BOARD_LABELS[card.board]} › {cardPlace(config, card)}
        </span>
        <Readout>Created {card.created}</Readout>
        <StateBadges card={card} openSuggestions={openSuggestions} carryingAProblem={carryingAProblem} />
        {onPatch
          ? field('group', 'group', '+ group', 'cv-group')
          : card.group && <span className="cv-group">{card.group}</span>}
      </FigureRow>

      {onPatch ? (
        <Field
          inline
          value={csv(card.tags)}
          label="tags"
          placeholder="+ tags"
          className="cv-tags-edit"
          display={(value) => (
            <span className="cv-tags">
              {parseCsv(value).map((t) => (
                <Chip pill tone="neutral" key={t} className="tag" testId="cv-tag">
                  {t}
                </Chip>
              ))}
            </span>
          )}
          onCommit={(value) => onPatch({ tags: parseCsv(value) })}
        />
      ) : (
        card.tags.length > 0 && (
          <div className="cv-tags">
            {card.tags.map((t) => (
              <Chip pill tone="neutral" key={t} className="tag" testId="cv-tag">
                {t}
              </Chip>
            ))}
          </div>
        )
      )}

      {onPatch
        ? field('description', 'description', '+ description', 'cv-desc')
        : card.description && <p className="cv-desc">{card.description}</p>}

      <CardLinks card={card} allCards={allCards} onOpenCard={onOpenCard} onLinks={onLinks} />

      {onPatch ? (
        <Field
          inline
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
        <Text role="hint" lead>
          No body yet.
        </Text>
      )}
    </article>
  );
}
