// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkPicker } from '../web/src/organisms/cards/LinkPicker.js';
import type { Card } from '../web/src/lib/shared.js';

afterEach(cleanup);

const card = (id: string, over: Partial<Card> = {}): Card =>
  ({
    id,
    title: `title of ${id}`,
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

describe('LinkPicker', () => {
  it('groups by board and omits boards with nothing to offer', () => {
    render(
      <LinkPicker
        linkable={[card('E-001'), card('P-002', { board: 'product' })]}
        links={[]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Product')).toBeTruthy();
    expect(screen.getByText('Engineering')).toBeTruthy();
    expect(screen.queryByText('Features')).toBeNull();
  });

  it('ticks the cards already linked and no others', () => {
    render(<LinkPicker linkable={[card('E-001'), card('E-002')]} links={['E-002']} onToggle={vi.fn()} />);
    // The cast used to sit outside the `?.`, so a card rendered without its enclosing label read
    // `undefined.checked` and the case failed as an anonymous TypeError rather than naming the id
    // whose checkbox went missing. Narrow instead of asserting: this is the fixture's own contract.
    const ticked = (id: string): boolean => {
      const box = screen.getByText(id).closest('label')?.querySelector('input');
      if (!(box instanceof HTMLInputElement)) throw new Error(`no checkbox in the label beside ${id}`);
      return box.checked;
    };
    expect(ticked('E-002')).toBe(true);
    expect(ticked('E-001')).toBe(false);
  });

  it('reports a toggled card by id', () => {
    const onToggle = vi.fn();
    render(<LinkPicker linkable={[card('E-001')]} links={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle.mock.calls).toEqual([['E-001']]);
  });

  // Pinned for Phase 9 of docs/design-system.md before `Field layout="check"` took this row. A checkbox
  // row is a `<label>` wrapping its box, and that is behaviour rather than styling: the text is a click
  // target. A migration to a `<div>` wrapper would keep every assertion above green and lose it.
  it('is a label round its box, so the card title is a click target', () => {
    const onToggle = vi.fn();
    render(<LinkPicker linkable={[card('E-001')]} links={[]} onToggle={onToggle} />);
    const check = screen.getByRole('checkbox') as HTMLInputElement;
    expect(check.type).toBe('checkbox');
    expect(check.closest('label')).not.toBeNull();
    fireEvent.click(screen.getByText('title of E-001'));
    expect(onToggle.mock.calls).toEqual([['E-001']]);
  });

  it('says so when there is nothing to link to', () => {
    render(<LinkPicker linkable={[]} links={[]} onToggle={vi.fn()} />);
    expect(screen.getByText('No other cards yet to link.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
