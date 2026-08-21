import { useEffect, useState } from 'react';
import { listArchive, restoreCard } from '../api';
import { errorText } from '../errors';
import type { ArchivedCard, BoardName, ProjectConfig } from '../shared';
import { Button } from '../ui/Button';
import { columnSlugs } from '../viewmodel';

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

  if (error) return <div className="archive-drawer archive-error">{error}</div>;
  if (cards === null) return <div className="archive-drawer archive-empty">Loading the archive…</div>;
  if (cards.length === 0) {
    return <div className="archive-drawer archive-empty">Nothing archived on this board.</div>;
  }

  return (
    <div className="archive-drawer">
      {cards.map((c) => (
        <div className="archive-item" key={c.id}>
          <div className="archive-meta">
            <span className="tile-id">{c.id}</span>
            <span className="archive-when">{when(c.archived)}</span>
          </div>
          <button className="archive-title" onClick={() => onOpen?.(c)} title="Open this card">
            {c.title}
          </button>
          <div className="archive-actions">
            <Button size="sm" onClick={() => restore(c)}>
              Restore → {labelOf(c.restoreTo)}
            </Button>
            {/* Somewhere else, for when the original column is no longer the right home. */}
            <select
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
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}
