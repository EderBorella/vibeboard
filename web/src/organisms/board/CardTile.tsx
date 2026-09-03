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
}

// THE THREE STATE BADGES ARE GONE FROM THE TILE — ruled 2026-09-02 by the owner, and they now live in
// the CARD ITSELF rather than in its miniature on the board. `setup`, the open-suggestion count and the
// blocked-cards list are all in `CardView`.
//
// WHY THEY COULD NOT STAY. The head is a flex row inside a tile of FIXED height, and once the glyphs
// became icons the row ran out of slack: the link readout has `flex-shrink: 1`, so it squeezed to 13px
// and wrapped its own content, putting a chain above a number in a box twice its height. Moving them
// into the tile's body instead cost a line of the summary, because `.tile` is `height: var(--tile-h)`
// with `overflow: hidden` — the second line was cut mid-glyph. There is no room in a miniature for five
// signals, and the head now carries the two that belong there: which card it is, and how many it links.
//
// `openSuggestions` and `carryingAProblem` are therefore no longer props here, and the whole
// BoardsView → Board → Column → CardTile chain that carried them is gone with them.

export function CardTile({ card, miniatureChars, onOpen, onArchive, onDragStart, onTag }: Props) {
  const summary = miniature(card, miniatureChars);
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
      {/* THE HEAD CARRIES THE ID AND THE LINK COUNT, AND NOTHING ELSE — ruled 2026-09-02 by the owner
          after the icons landed. It used to hold three state chips as well, and at a column's width they
          did not fit: the link readout was a flex item with `flex-shrink: 1`, so the row squeezed it to
          13px and its own content wrapped, leaving a chain above a number in a box twice the height it
          should be. Fewer things in the row is the fix that does not need one.
          The three states moved into the card body below, where they wrap freely. */}
      <Stack gap={3} className="tile-head">
        <Readout>{card.id}</Readout>
        {card.links.length > 0 && (
          // A READOUT AND NOT A CHIP, and now the only badge up here. The other three wear a tone because
          // each signals a state to act on; a link count signals nothing — it is a structural fact, and
          // the tone vocabulary is worth more if a count cannot borrow from it.
          //
          // `push` puts it right, and `vb-fixed` is `flex: none`: it is the shrink that broke it before,
          // and a count that can be squeezed is a count that can wrap.
          <Readout testId="tile-link" className="push vb-fixed" title={card.links.join(', ')}>
            <Icon name="link" /> {card.links.length}
          </Readout>
        )}
        {onArchive && (
          <Button
            variant="bare"
            // `push` only when nothing before it already pushed, or the two would fight for the slack.
            className={card.links.length > 0 ? 'vb-fixed' : 'push'}
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
