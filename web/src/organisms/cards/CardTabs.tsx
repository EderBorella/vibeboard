import { Button } from '../../atoms/Button';
import type { CardRef } from '../dock/tabs';
import { resolveTab } from '../dock/tabs';
import { Tabs } from '../../molecules/Tabs';
import type { Card } from '../../lib/shared';

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
    // `Tabs closable`. THE SELECTED INK IS THE CELL'S OWN NOW: `.cards-tab.active` coloured its CHILD and
    // drew the border on itself, which is why this family read as neither a tab nor a label to any census.
    // `.cards-tabs` survives as two declarations that are genuinely this strip's — it is the only tab row
    // in the app that scrolls sideways and the only one with a rule under it.
    <Tabs
      label="Open cards"
      className="cards-tabs"
      closable
      items={tabs.map((t) => ({ value: t.id, label: resolveTab(t, live)?.title ?? t.id }))}
      value={activeTabId}
      onChange={onFocus}
      onClose={onClose}
    >
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
    </Tabs>
  );
}
