// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardLinks } from '../web/src/organisms/cards/CardLinks.js';
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

const other = card('P-002', { board: 'product' });

// The picker groups by board (features, product, engineering), NOT by the order cards were passed,
// so a checkbox is found through its card rather than by position.
const boxFor = (id: string): HTMLElement =>
  screen.getByText(id).closest('label')?.querySelector('input') as HTMLElement;

describe('CardLinks', () => {
  it('renders nothing when there is nothing linked and no way to link', () => {
    const { container } = render(<CardLinks card={card('E-001')} allCards={[other]} />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps the heading when links can be changed but none exist yet', () => {
    render(<CardLinks card={card('E-001')} allCards={[other]} onLinks={vi.fn()} />);
    expect(screen.getByText('Linked cards')).toBeTruthy();
    expect(screen.getByText('Change')).toBeTruthy();
  });

  it('opens a link when it can, and leaves it a plain row when it cannot', () => {
    const onOpenCard = vi.fn();
    const { rerender } = render(
      <CardLinks card={card('E-001', { links: ['P-002'] })} allCards={[other]} onOpenCard={onOpenCard} />,
    );
    fireEvent.click(screen.getByTitle('Open P-002'));
    expect(onOpenCard.mock.calls).toEqual([[other]]);

    rerender(<CardLinks card={card('E-001', { links: ['P-002'] })} allCards={[other]} />);
    expect(screen.queryByTitle('Open P-002')).toBeNull();
  });

  it('shows the picker behind Change, and hides it again behind Done', () => {
    render(<CardLinks card={card('E-001')} allCards={[other]} onLinks={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();

    fireEvent.click(screen.getByText('Change'));
    expect(screen.getByRole('checkbox')).toBeTruthy();

    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('adds a link by id, keeping the ones already set', () => {
    const onLinks = vi.fn();
    const third = card('F-003', { board: 'features' });
    render(
      <CardLinks card={card('E-001', { links: ['P-002'] })} allCards={[other, third]} onLinks={onLinks} />,
    );
    fireEvent.click(screen.getByText('Change'));
    fireEvent.click(boxFor('F-003')); // unticked; ticking it must not drop P-002
    expect(onLinks.mock.calls).toEqual([[['P-002', 'F-003']]]);
  });

  it('removes a link that is already set, keeping the others', () => {
    const onLinks = vi.fn();
    const third = card('F-003', { board: 'features' });
    render(
      <CardLinks
        card={card('E-001', { links: ['P-002', 'F-003'] })}
        allCards={[other, third]}
        onLinks={onLinks}
      />,
    );
    fireEvent.click(screen.getByText('Change'));
    fireEvent.click(boxFor('P-002'));
    expect(onLinks.mock.calls).toEqual([[['F-003']]]);
  });

  it('never offers the card itself as something to link to', () => {
    render(<CardLinks card={card('E-001')} allCards={[card('E-001'), other]} onLinks={vi.fn()} />);
    fireEvent.click(screen.getByText('Change'));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText('P-002')).toBeTruthy();
  });
});
