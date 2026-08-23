import { useEffect, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import { listArchive, restoreCard } from '../../lib/api';
import { errorText } from '../../lib/errors';
import type { ArchivedCard, BoardName, ProjectConfig } from '../../lib/shared';
import { columnSlugs } from '../../lib/viewmodel';
import { Row } from '../shared/Row';

interface Props {
  board: BoardName;
  config: ProjectConfig;
  // Snapshot count for this board. It changes whenever anything lands in or leaves the
  // archive — including edits made by the copilot — so it doubles as the refetch trigger.
  count: number;
  onOpen?: (card: ArchivedCard) => void;
}

// Day and time, no year: the archive is a recent-history view, and the full ISO stamp is
// noise on a tile.
function when(iso?: string): string {
  if (!iso) return 'archived';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'archived';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ArchiveDrawer({ board, config, count, onOpen }: Props) {
  const [cards, setCards] = useState<ArchivedCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slugs = columnSlugs(config, board);
  const labels = config.boards[board].columns;
  const labelOf = (slug: string): string => labels[slugs.indexOf(slug)] ?? slug;

  // Refetch on mount and whenever the count moves. Restoring changes the count too, so the
  // list reconciles itself without an optimistic local update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: count is a deliberate trigger
  useEffect(() => {
    let live = true;
    listArchive(board)
      .then((c) => {
        if (live) {
          setCards(c);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [board, count]);

  const restore = (card: ArchivedCard, toColumnSlug?: string): void => {
    setError(null);
    restoreCard(board, card.id, toColumnSlug)
      // The watcher's snapshot bumps `count`, which refetches — but do it now so the tile
      // disappears immediately rather than a filesystem event later.
      .then(() => listArchive(board).then(setCards))
      .catch((e: unknown) => setError(errorText(e)));
  };

  // A FACE ON A `Surface` WAS THE SMEAR THE ATOM LAYER REMOVES: these three wrote a text class into the
  // container's `className`, which is documented as layout-only, so the drawer itself was italic. The
  // container is the container and the line inside it is a `Text`.
  if (error)
    return (
      <Surface className="archive-drawer">
        <Text role="error">{error}</Text>
      </Surface>
    );
  if (cards === null)
    return (
      <Surface className="archive-drawer">
        <Text role="hint">Loading the archive…</Text>
      </Surface>
    );
  if (cards.length === 0) {
    return (
      <Surface className="archive-drawer">
        <Text role="hint">Nothing archived on this board.</Text>
      </Surface>
    );
  }

  return (
    <Surface className="archive-drawer" data-testid="archive-drawer">
      {cards.map((c) => (
        <Row variant="inset" key={c.id}>
          <Stack align="baseline" gap={4} className="vb-fixed">
            <Readout>{c.id}</Readout>
            <Readout>{when(c.archived)}</Readout>
          </Stack>
          <Button
            variant="bare"
            className="archive-title vb-clip"
            onClick={() => onOpen?.(c)}
            title="Open this card"
          >
            {c.title}
          </Button>
          <Stack gap={3} className="vb-fixed">
            <Button size="sm" onClick={() => restore(c)}>
              Restore → {labelOf(c.restoreTo)}
            </Button>
            {/* Somewhere else, for when the original column is no longer the right home. */}
            {/* NOT a `Field`: this is one of two actions in a row of actions, and its own first option
                — "Elsewhere…" — is what names it. The box is the primitive's; the muted ink is the
                surface's, because a secondary restore must not read as loudly as the button beside it. */}
            <Control
              as="select"
              className="archive-column"
              value=""
              title="Restore to another column"
              onChange={(e) => {
                if (e.target.value) restore(c, e.target.value);
              }}
            >
              <option value="">Elsewhere…</option>
              {slugs.map((slug, i) => (
                <option key={slug} value={slug}>
                  {labels[i]}
                </option>
              ))}
            </Control>
          </Stack>
        </Row>
      ))}
    </Surface>
  );
}
