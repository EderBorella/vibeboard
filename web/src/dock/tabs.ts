import type { BoardName, Card } from '../shared';

// A tab in the Cards pane. A reference, deliberately not a card: the live copy is looked up in the
// snapshot on every render, so an agent editing a card you have open updates the pane for free, and
// saving needs no plumbing back into the dock.
export interface CardRef {
  board: BoardName;
  id: string;
  // The card as it was when opened. Archived cards are not in the snapshot at all, so without this
  // a tab for one would resolve to nothing the moment it opened.
  frozen?: Card;
}

// A tab for a card, carrying a frozen copy only when the board cannot resolve it — otherwise the
// live lookup would be shadowed by a stale copy that never updates.
export function tabFor(card: Card, live: Card[]): CardRef {
  const ref: CardRef = { board: card.board, id: card.id };
  return live.some((c) => c.id === card.id) ? ref : { ...ref, frozen: card };
}

// Opening a card already open focuses its tab rather than adding a second one, so the same tabs
// come back unchanged.
export function openTab(tabs: CardRef[], ref: CardRef): CardRef[] {
  return tabs.some((t) => t.id === ref.id) ? tabs : [...tabs, ref];
}

export function closeTab(tabs: CardRef[], id: string): CardRef[] {
  return tabs.filter((t) => t.id !== id);
}

// Which tab takes focus once `closingId` goes: its right-hand neighbour, else its left, else
// nothing. Closing a tab that is not the active one must not move focus at all.
export function nextActive(tabs: CardRef[], closingId: string, activeId: string | null): string | null {
  if (activeId !== closingId) return activeId;
  const at = tabs.findIndex((t) => t.id === closingId);
  const rest = closeTab(tabs, closingId);
  return rest[at]?.id ?? rest[at - 1]?.id ?? null;
}

// The card a tab should show: the board's live copy, else the frozen one it was opened with, else
// null — the card has left the board entirely (deleted outside the app, or its file moved).
export function resolveTab(ref: CardRef, live: Card[]): Card | null {
  return live.find((c) => c.id === ref.id) ?? ref.frozen ?? null;
}
