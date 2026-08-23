import { describe, expect, it } from 'vitest';
import { type CardRef, closeTab, nextActive, openTab, resolveTab, tabFor } from '../web/src/organisms/dock/tabs.js';
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

const ref = (id: string): CardRef => ({ board: 'engineering', id });

describe('tabFor', () => {
  it('holds no frozen copy for a card the board can resolve', () => {
    // A frozen copy would shadow the live one and stop updating. Two live cards, not one: with a
    // single-element board, "some card matches" and "every card matches" agree, so a fixture of
    // one cannot tell the lookup from its opposite.
    const c = card('E-001');
    expect(tabFor(c, [card('E-002'), c])).toEqual({ board: 'engineering', id: 'E-001' });
  });

  it('freezes a card the board cannot resolve, so an archived card still renders', () => {
    const archived = card('E-009', { archived: '2026-07-26T10:00:00Z' });
    expect(tabFor(archived, [card('E-001')])).toEqual({
      board: 'engineering',
      id: 'E-009',
      frozen: archived,
    });
  });
});

describe('openTab', () => {
  it('appends a card that is not open', () => {
    expect(openTab([ref('E-001')], ref('E-002')).map((t) => t.id)).toEqual(['E-001', 'E-002']);
  });

  it('returns the same tabs when the card is already open', () => {
    const tabs = [ref('E-001'), ref('E-002')];
    expect(openTab(tabs, ref('E-001'))).toBe(tabs);
  });

  it('does not mutate the tabs it is given', () => {
    const tabs = [ref('E-001')];
    openTab(tabs, ref('E-002'));
    expect(tabs.map((t) => t.id)).toEqual(['E-001']);
  });
});

describe('closeTab', () => {
  it('removes only the named tab', () => {
    const tabs = [ref('E-001'), ref('E-002'), ref('E-003')];
    expect(closeTab(tabs, 'E-002').map((t) => t.id)).toEqual(['E-001', 'E-003']);
  });

  it('leaves the tabs alone when the id is not open', () => {
    expect(closeTab([ref('E-001')], 'GONE').map((t) => t.id)).toEqual(['E-001']);
  });
});

describe('nextActive', () => {
  const tabs = [ref('E-001'), ref('E-002'), ref('E-003')];

  it('moves to the right-hand neighbour', () => {
    expect(nextActive(tabs, 'E-002', 'E-002')).toBe('E-003');
  });

  it('falls back to the left-hand neighbour when the last tab closes', () => {
    expect(nextActive(tabs, 'E-003', 'E-003')).toBe('E-002');
  });

  it('leaves focus alone when the tab closing is not the active one', () => {
    // Closing E-001 from under E-003 must not drag focus to E-002.
    expect(nextActive(tabs, 'E-001', 'E-003')).toBe('E-003');
  });

  it('is null once the only tab closes', () => {
    expect(nextActive([ref('E-001')], 'E-001', 'E-001')).toBeNull();
  });
});

describe('resolveTab', () => {
  it('prefers the live card so edits by anyone reach the pane', () => {
    const live = card('E-001', { title: 'renamed by an agent' });
    const stale = card('E-001', { title: 'as opened' });
    expect(resolveTab({ board: 'engineering', id: 'E-001', frozen: stale }, [live])?.title).toBe(
      'renamed by an agent',
    );
  });

  it('falls back to the frozen copy when the board has no such card', () => {
    const frozen = card('E-009');
    expect(resolveTab({ board: 'engineering', id: 'E-009', frozen }, [card('E-001')])).toBe(frozen);
  });

  it('is null when the card has left the board and nothing was frozen', () => {
    expect(resolveTab(ref('E-009'), [card('E-001')])).toBeNull();
  });
});
