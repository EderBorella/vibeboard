// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCardTabs } from '../web/src/organisms/dock/useCardTabs.js';
import type { Card } from '../web/src/lib/shared.js';

const card = (id: string, over: Partial<Card> = {}): Card =>
  ({
    id,
    title: id,
    board: 'engineering',
    columnSlug: 'todo',
    order: 0,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: '',
    filePath: `/tmp/${id}.md`,
    ...over,
  }) as Card;

const live = [card('E-001'), card('E-002'), card('E-003')];

describe('useCardTabs', () => {
  it('opens a card as a tab and focuses it', () => {
    const { result } = renderHook(() => useCardTabs());
    act(() => result.current.open(card('E-001'), live));
    expect(result.current.tabs.map((t) => t.id)).toEqual(['E-001']);
    expect(result.current.activeId).toBe('E-001');
  });

  it('re-opening an open card focuses it without adding a second tab', () => {
    const { result } = renderHook(() => useCardTabs());
    act(() => result.current.open(card('E-001'), live));
    act(() => result.current.open(card('E-002'), live));
    act(() => result.current.open(card('E-001'), live));
    expect(result.current.tabs.map((t) => t.id)).toEqual(['E-001', 'E-002']);
    expect(result.current.activeId).toBe('E-001');
  });

  it('freezes a card the board cannot resolve, so archived cards survive in a tab', () => {
    const { result } = renderHook(() => useCardTabs());
    const archived = card('E-009', { archived: '2026-07-26T10:00:00Z' });
    act(() => result.current.open(archived, live));
    expect(result.current.tabs[0].frozen).toBe(archived);
  });

  it('closing the active tab moves focus to its neighbour', () => {
    const { result } = renderHook(() => useCardTabs());
    act(() => result.current.open(card('E-001'), live));
    act(() => result.current.open(card('E-002'), live));
    act(() => result.current.open(card('E-003'), live));
    act(() => result.current.focus('E-002'));

    act(() => result.current.close('E-002'));
    expect(result.current.tabs.map((t) => t.id)).toEqual(['E-001', 'E-003']);
    expect(result.current.activeId).toBe('E-003');
  });

  it('closing a tab that is not active leaves focus where it was', () => {
    const { result } = renderHook(() => useCardTabs());
    act(() => result.current.open(card('E-001'), live));
    act(() => result.current.open(card('E-002'), live));

    act(() => result.current.close('E-001'));
    expect(result.current.activeId).toBe('E-002');
  });

  it('closing the last tab leaves nothing focused', () => {
    const { result } = renderHook(() => useCardTabs());
    act(() => result.current.open(card('E-001'), live));
    act(() => result.current.close('E-001'));
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeId).toBeNull();
  });

  it('clear empties the dock, so switching project does not carry its cards over', () => {
    // Every id belongs to the project being left; without this the dock fills with cards that
    // resolve to nothing.
    const { result } = renderHook(() => useCardTabs());
    act(() => result.current.open(card('E-001'), live));
    act(() => result.current.open(card('E-002'), live));

    act(() => result.current.clear());
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeId).toBeNull();
  });
});
