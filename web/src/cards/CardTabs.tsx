import type { CardRef } from '../dock/tabs';
import { resolveTab } from '../dock/tabs';
import type { Card } from '../shared';
import { Button } from '../atoms/Button';

interface Props {
  tabs: CardRef[];
  activeTabId: string | null;
  live: Card[];
  // Only offered when a card actually resolves — there is nothing to show the file of otherwise.
  rawAvailable: boolean;
  rawActive: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onToggleRaw: () => void;
}

// The pane's tab strip: one tab per open card, plus the Raw toggle. Presentation only — extracted
// so CardsPane is orchestration, which is what kept it under the complexity gate once the body grew
// a third and fourth view.
export function CardTabs({
  tabs,
  activeTabId,
  live,
  rawAvailable,
  rawActive,
  onFocus,
  onClose,
  onToggleRaw,
}: Props) {
  return (
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
          <Button
            variant="bare"
            size="sm"
            className="cards-tab-x"
            title={`Close ${t.id}`}
            onClick={() => onClose(t.id)}
          >
            ✕
          </Button>
        </span>
      ))}
      {rawAvailable && (
        <Button
          variant={rawActive ? 'primary' : 'default'}
          size="sm"
          className="push"
          data-testid="cards-raw"
          title="Show the card's file, frontmatter and all"
          aria-pressed={rawActive}
          onClick={onToggleRaw}
        >
          Raw
        </Button>
      )}
    </div>
  );
}
