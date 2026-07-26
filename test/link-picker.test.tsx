// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkPicker } from '../web/src/components/LinkPicker.js';
import type { Card } from '../web/src/shared.js';

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
    render(
      <LinkPicker
        linkable={[card('E-001'), card('E-002')]}
        links={['E-002']}
        onToggle={vi.fn()}
      />,
    );
    const ticked = (id: string): boolean =>
      (screen.getByText(id).closest('label')?.querySelector('input') as HTMLInputElement).checked;
    expect(ticked('E-002')).toBe(true);
    expect(ticked('E-001')).toBe(false);
  });

  it('reports a toggled card by id', () => {
    const onToggle = vi.fn();
    render(<LinkPicker linkable={[card('E-001')]} links={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle.mock.calls).toEqual([['E-001']]);
  });

  it('says so when there is nothing to link to', () => {
    render(<LinkPicker linkable={[]} links={[]} onToggle={vi.fn()} />);
    expect(screen.getByText('No other cards yet to link.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
