import { useState } from 'react';
import type { Card } from '../../lib/shared';
import { type CardRef, closeTab, nextActive, openTab, tabFor } from './tabs';

export interface CardTabs {
  tabs: CardRef[];
  activeId: string | null;
  open: (card: Card, live: Card[]) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  clear: () => void;
}

// The open-cards state, out of the shell so it can be tested without mounting the app. Nothing
// here is persisted: tabs restored on load would reopen another project's cards.
export function useCardTabs(): CardTabs {
  const [tabs, setTabs] = useState<CardRef[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  return {
    tabs,
    activeId,
    open: (card, live) => {
      setTabs((prev) => openTab(prev, tabFor(card, live)));
      setActiveId(card.id);
    },
    close: (id) => {
      setActiveId((active) => nextActive(tabs, id, active));
      setTabs((prev) => closeTab(prev, id));
    },
    focus: setActiveId,
    // Switching project: every id belongs to the project being left, so keeping the tabs would
    // leave a dock full of cards that resolve to nothing.
    clear: () => {
      setTabs([]);
      setActiveId(null);
    },
  };
}
