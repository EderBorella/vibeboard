import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Icon } from '../../atoms/Icon';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import type { Card } from '../../lib/shared';
import { miniature } from '../../lib/viewmodel';

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
  // The blocked CARD ids under this card (decision 46). A card's OWN state is its column, which the
  // board already shows; this is the part a person cannot see from here — a story in Done carrying a
  // blocked task must not look identical to one that finished clean.
  //
  // Cards and not tasks, since decision 45's 2026-08-13 correction: a feature can be carrying a story
  // nobody could break down, so a tooltip that says "task" names the wrong kind of thing on screen.
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
    <Surface
      variant="inset"
      className="tile"
      // A REGION IN THE TAB ORDER, NOT A `<button>`, and the markup is a ruling rather than a
      // shortcut. A tile is a card-sized region that CONTAINS controls — a `Chip as="button"` per
      // tag and a bare archive button — and `<button>` may not contain a button, while
      // `role="button"` makes its children presentational, which would hide those same controls
      // from a screen reader. `role="group"` is what the tile actually is: a labelled region whose
      // interactive children stay interactive, and `tabIndex` is what puts it where a keyboard can
      // reach it. Before this, the board's primary control could not be operated without a mouse and
      // fourteen tiles were absent from the focus gate's population.
      role="group"
      aria-label={`Card ${card.id}: ${card.title}`}
      // Only where there is something to open. A tab stop that does nothing is worse than none, and
      // the archive drawer's read-only tiles pass no `onOpen`.
      tabIndex={onOpen ? 0 : undefined}
      draggable={!!onDragStart}
      onDragStart={(e) => {
        // setData is required for the browser to actually start a native drag (Firefox
        // won't drag at all without it). dragged card is tracked in App via onDragStart.
        e.dataTransfer.setData('text/plain', card.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(card);
      }}
      onClick={() => onOpen?.(card)}
      onKeyDown={(e) => {
        // THE SAME BOUNDARY THE CHILDREN'S `stopPropagation` DRAWS, on the keyboard side. Enter on
        // the archive button fires that button's click — which stops propagating — but its keydown
        // still bubbles here, so acting on a bubbled key would open the card as well as archive it.
        // Only the tile's own keystrokes count.
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Space scrolls the column otherwise, which moves the board under the card being opened.
        e.preventDefault();
        onOpen?.(card);
      }}
    >
      <Stack gap={3} className="tile-head">
        <Readout>{card.id}</Readout>
        {/* THREE STATE WORDS IN THREE TONES, and the tones are the meaning rather than the styling —
            see the three rules in organisms/board/tile-states.css and test/chip-boxes.test.tsx, which
            measures that a person can tell them apart in each theme's own palette. */}
        {card.setup && (
          // The project-level barrier. Worth a badge because its effect is invisible from the card
          // it is on: nothing outside this feature's subtree runs until it is finished, so a board
          // that looks stuck is explained by a tile somewhere else. `accent` and not `warn`: this is
          // structure, not a problem.
          <Chip
            tone="accent"
            testId="tile-setup"
            title="The setup feature — nothing outside it runs until it is done"
          >
            {/* `.tile-setup` WAS THE FACE AND NOTHING ELSE — uppercase, the tracking and a `nowrap` — so it
                is `Text caps nowrap` on the label. `size`/`ink` are `inherit` because the chip already
                decides both: its step is `--t-micro` and its ink is the tone this state means. */}
            <Text size="inherit" ink="inherit" caps nowrap>
              setup
            </Text>
          </Chip>
        )}
        {openSuggestions > 0 && (
          // `warn` — not failing, but not plainly done either.
          <Chip
            tone="warn"
            testId="tile-suggestions"
            title={`${openSuggestions} open ${openSuggestions === 1 ? 'suggestion' : 'suggestions'}`}
          >
            {/* The glyph and its count on one line, which is all `.tile-suggestions` ever said. */}
            <Text size="inherit" ink="inherit" nowrap>
              <Icon name="flag" /> {openSuggestions}
            </Text>
          </Chip>
        )}
        {blocked.length > 0 && (
          // `bad`, the strongest of the three: a real failure inside something that says it finished.
          <Chip
            tone="bad"
            testId="tile-problem"
            // Every one of them, not just the first: the ids are what a person goes and looks at.
            title={`Carrying ${blocked.length === 1 ? 'a blocked card' : `${blocked.length} blocked cards`}: ${blocked.join(', ')}`}
          >
            <Text size="inherit" ink="inherit" nowrap>
              <Icon name="warning" /> {blocked.length}
            </Text>
          </Chip>
        )}
        {card.links.length > 0 && (
          // A READOUT AND NOT A CHIP, beside three chips, on purpose. The other four badges in this head
          // wear a tone because each signals a state to act on — waiting, unfinished, failed. A link count
          // signals nothing: it is a structural fact about the card, and the tone vocabulary is worth more
          // if a count cannot borrow from it. Mono also puts it under the signature's own rule — the machine
          // counted these.
          <Readout testId="tile-link" title={card.links.join(', ')}>
            <Icon name="link" /> {card.links.length}
          </Readout>
        )}
        {onArchive && (
          <Button
            variant="bare"
            className="push"
            title="Archive"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(card);
            }}
          >
            <Icon name="close" />
          </Button>
        )}
      </Stack>
      <div className="tile-title">{card.title}</div>
      {summary && <Text className="tile-summary">{summary}</Text>}
      {/* The group a card belongs to, as an eyebrow over the title: `caps` is the face, `accent2` the hue
          the tile chose, and `micro` the step `.tile-group` used to be. */}
      {card.group && (
        <Text caps ink="accent2" size="micro">
          {card.group}
        </Text>
      )}
      {card.tags.length > 0 && (
        <Stack wrap gap={2} className="tile-tags">
          {card.tags.map((t) =>
            onTag ? (
              <Chip
                as="button"
                pill
                tone="neutral"
                key={t}
                className="tag tag-btn"
                testId="tile-tag"
                title={`Filter by ${t}`}
                // Without this the tile's own onClick opens the editor as well.
                onClick={(e) => {
                  e.stopPropagation();
                  onTag(t);
                }}
              >
                {t}
              </Chip>
            ) : (
              <Chip pill tone="neutral" key={t} className="tag" testId="tile-tag">
                {t}
              </Chip>
            ),
          )}
        </Stack>
      )}
    </Surface>
  );
}
