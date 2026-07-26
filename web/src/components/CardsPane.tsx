import type { CardRef } from '../dock/tabs';
import { resolveTab } from '../dock/tabs';
import type { Card, ProjectConfig } from '../shared';
import { CardView } from './CardView';

interface Props {
  tabs: CardRef[];
  activeId: string | null;
  live: Card[];
  config: ProjectConfig;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onEdit: (card: Card) => void;
  // A linked card opens as another tab, which is the browsing loop the dock exists for.
  onOpenCard: (card: Card) => void;
}

export function CardsPane({ tabs, activeId, live, config, onFocus, onClose, onEdit, onOpenCard }: Props) {
  // Falls back to the first tab so a stale activeId cannot leave the pane blank. Resolved once:
  // inside the tab list it can never be absent, and repeating the optional chain there would only
  // add guards no caller can reach.
  const activeRef = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const activeTabId = activeRef?.id ?? null;
  const card = activeRef ? resolveTab(activeRef, live) : null;

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
          <button type="button" className="cards-edit" onClick={() => onEdit(card)}>
            Edit
          </button>
        )}
      </div>

      <div className="cards-body">
        {card ? (
          <CardView card={card} config={config} allCards={live} onOpenCard={onOpenCard} />
        ) : (
          // The card left the board while its tab was open — deleted outside the app, or its file
          // moved. Saying so beats an empty pane that looks broken.
          <div className="cards-gone">
            {activeRef ? `${activeRef.id} is no longer on the board.` : 'No card open.'}
          </div>
        )}
      </div>
    </div>
  );
}
