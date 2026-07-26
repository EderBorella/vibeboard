// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardsPane } from '../web/src/components/CardsPane.js';
import type { CardRef } from '../web/src/dock/tabs.js';
import type { Card, ProjectConfig } from '../web/src/shared.js';

afterEach(cleanup);

const config: ProjectConfig = {
  name: 'T',
  boards: {
    features: { columns: ['Backlog', 'Done'] },
    product: { columns: ['Backlog', 'In Progress', 'Done'] },
    engineering: { columns: ['Todo', 'Done'] },
  },
  miniatureChars: 40,
  idPadding: 3,
  keepChats: 20,
  contextBudget: 200_000,
  copilot: { backend: 'claude-code', backends: {} },
};

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

const ref = (id: string): CardRef => ({ board: 'engineering', id });

const props = {
  onFocus: vi.fn(),
  onClose: vi.fn(),
  onEdit: vi.fn(),
  onOpenCard: vi.fn(),
  config,
};

describe('CardsPane', () => {
  // The title shows twice by design — once labelling the tab, once heading the view — so body
  // assertions are scoped rather than matched on text.
  const bodyTitle = (c: HTMLElement): string | undefined =>
    c.querySelector('.cards-body .cv-title')?.textContent ?? undefined;

  it('titles each tab by its card and shows the active one', () => {
    const live = [card('E-001'), card('E-002')];
    const { container } = render(
      <CardsPane {...props} tabs={[ref('E-001'), ref('E-002')]} activeId="E-002" live={live} />,
    );
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'title of E-001',
      'title of E-002',
    ]);
    const [first, second] = screen.getAllByRole('tab');
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(first.getAttribute('aria-selected')).toBe('false');
    // Exact classes on the wrappers: that is what the CSS highlights the active tab by.
    expect(first.parentElement?.className).toBe('cards-tab');
    expect(second.parentElement?.className).toBe('cards-tab active');
    // The body is the active card, not the first tab.
    expect(bodyTitle(container)).toBe('title of E-002');
  });

  it('says nothing is open, and offers nothing to act on, with no tabs', () => {
    // The dock only mounts this pane when a card is open, but the pane's own contract has to hold
    // on its own — and this is the only shape in which activeRef is absent.
    const { container } = render(<CardsPane {...props} tabs={[]} activeId={null} live={[]} />);
    expect(screen.getByText('No card open.')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByText('Edit')).toBeNull();
    expect(container.querySelector('.cv-title')).toBeNull();
  });

  it('reports focus and close per tab', () => {
    const onFocus = vi.fn();
    const onClose = vi.fn();
    render(
      <CardsPane
        {...props}
        onFocus={onFocus}
        onClose={onClose}
        tabs={[ref('E-001'), ref('E-002')]}
        activeId="E-001"
        live={[card('E-001'), card('E-002')]}
      />,
    );
    screen.getAllByRole('tab')[1].click();
    screen.getByTitle('Close E-001').click();
    expect(onFocus.mock.calls).toEqual([['E-002']]);
    expect(onClose.mock.calls).toEqual([['E-001']]);
  });

  it('falls back to the first tab when the active id names none of them', () => {
    render(<CardsPane {...props} tabs={[ref('E-001')]} activeId="E-404" live={[card('E-001')]} />);
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('renders the live card, so an edit by anyone reaches the pane', () => {
    const { container, rerender } = render(
      <CardsPane {...props} tabs={[ref('E-001')]} activeId="E-001" live={[card('E-001')]} />,
    );
    expect(bodyTitle(container)).toBe('title of E-001');

    rerender(
      <CardsPane
        {...props}
        tabs={[ref('E-001')]}
        activeId="E-001"
        live={[card('E-001', { title: 'renamed by an agent' })]}
      />,
    );
    // Both the body and the tab label follow the live card.
    expect(bodyTitle(container)).toBe('renamed by an agent');
    expect(screen.getByRole('tab').textContent).toBe('renamed by an agent');
  });

  it('says which card has gone rather than showing a blank pane', () => {
    render(<CardsPane {...props} tabs={[ref('E-009')]} activeId="E-009" live={[card('E-001')]} />);
    expect(screen.getByText('E-009 is no longer on the board.')).toBeTruthy();
    // Its tab stays, labelled by id since no title can be resolved, so it can still be closed.
    expect(screen.getByRole('tab').textContent).toBe('E-009');
    expect(screen.getByTitle('Close E-009')).toBeTruthy();
  });

  it('renders an archived card from the frozen copy its tab carries', () => {
    const frozen = card('E-009', { title: 'archived one', archived: '2026-07-26T10:00:00Z' });
    render(
      <CardsPane
        {...props}
        tabs={[{ board: 'engineering', id: 'E-009', frozen }]}
        activeId="E-009"
        live={[]}
      />,
    );
    expect(screen.getAllByText('archived one').length).toBeGreaterThan(0);
    expect(screen.queryByText('E-009 is no longer on the board.')).toBeNull();
  });

  it('opens a linked card as another tab', () => {
    // The browsing loop the dock exists for: a link in the pane re-targets the pane.
    const onOpenCard = vi.fn();
    const linked = card('E-002');
    render(
      <CardsPane
        {...props}
        onOpenCard={onOpenCard}
        tabs={[ref('E-001')]}
        activeId="E-001"
        live={[card('E-001', { links: ['E-002'] }), linked]}
      />,
    );
    screen.getByTitle('Open E-002').click();
    expect(onOpenCard.mock.calls).toEqual([[linked]]);
  });

  it('offers Edit for the active card, and not when there is nothing to edit', () => {
    const onEdit = vi.fn();
    const live = [card('E-001')];
    const { rerender } = render(
      <CardsPane {...props} onEdit={onEdit} tabs={[ref('E-001')]} activeId="E-001" live={live} />,
    );
    screen.getByText('Edit').click();
    expect(onEdit.mock.calls).toEqual([[live[0]]]);

    rerender(<CardsPane {...props} onEdit={onEdit} tabs={[ref('E-009')]} activeId="E-009" live={live} />);
    expect(screen.queryByText('Edit')).toBeNull();
  });
});
