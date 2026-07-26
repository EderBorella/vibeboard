import { useState } from 'react';
import type { CardRef } from '../dock/tabs';
import { resolveTab } from '../dock/tabs';
import type { Card, CardFrontmatterPatch, ProjectConfig } from '../shared';
import { CardSkills } from './CardSkills';
import { CardView } from './CardView';
import { RawPane } from './RawPane';

interface Props {
  tabs: CardRef[];
  activeId: string | null;
  live: Card[];
  config: ProjectConfig;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  // A linked card opens as another tab, which is the browsing loop the dock exists for.
  onOpenCard: (card: Card) => void;
  onPatch: (card: Card, patch: CardFrontmatterPatch) => void;
  onLinks: (card: Card, links: string[]) => void;
}

export function CardsPane({
  tabs,
  activeId,
  live,
  config,
  onFocus,
  onClose,
  onOpenCard,
  onPatch,
  onLinks,
}: Props) {
  const [raw, setRaw] = useState(false);
  // Falls back to the first tab so a stale activeId cannot leave the pane blank. Resolved once:
  // inside the tab list it can never be absent, and repeating the optional chain there would only
  // add guards no caller can reach.
  const activeRef = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const activeTabId = activeRef?.id ?? null;
  const card = activeRef ? resolveTab(activeRef, live) : null;
  // An archived card is not in the snapshot, so a patch would land on disk with nothing to show it.
  const editable = card !== null && !card.archived;

  return (
    <div className="cards-pane">
      <div className="cards-tabs" role="tablist">
        {tabs.map((t) => (
          <span key={t.id} className={`cards-tab${t.id === activeTabId ? ' active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={t.id === activeTabId}
              className="cards-tab-label"
              onClick={() => onFocus(t.id)}
            >
              {resolveTab(t, live)?.title ?? t.id}
            </button>
            <button
              type="button"
              className="cards-tab-x"
              title={`Close ${t.id}`}
              onClick={() => onClose(t.id)}
            >
              ✕
            </button>
          </span>
        ))}
        {card && (
          <button
            type="button"
            className={`cards-raw${raw ? ' active' : ''}`}
            title="Show the card's file, frontmatter and all"
            aria-pressed={raw}
            onClick={() => setRaw((v) => !v)}
          >
            Raw
          </button>
        )}
      </div>

      <div className="cards-main">
        <div className="cards-body">
          {card && raw && <RawPane key={card.id} card={card} />}
          {card && !raw && (
            <CardView
              card={card}
              config={config}
              allCards={live}
              onOpenCard={onOpenCard}
              onPatch={editable ? (patch) => onPatch(card, patch) : undefined}
              onLinks={editable ? (links) => onLinks(card, links) : undefined}
            />
          )}
          {!card && (
            // Either nothing is open, or the card left the board while its tab was — deleted outside
            // the app, or its file moved. Saying so beats an empty pane that looks broken.
            <div className="cards-gone">
              {activeRef ? `${activeRef.id} is no longer on the board.` : 'No card open.'}
            </div>
          )}
        </div>
        {/* Actions belong to a card, so the rail goes when there is none — an empty rail would take
            width off the card for nothing. */}
        {card && <CardSkills card={card} />}
      </div>
    </div>
  );
}
