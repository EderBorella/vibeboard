// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardFields } from '../web/src/components/CardEditor.js';
import { CardForm } from '../web/src/components/CardForm.js';
import type { Card } from '../web/src/shared.js';

afterEach(cleanup);

const blank: CardFields = { title: '', description: '', tags: '', group: '', body: '' };

const card = (over: Partial<Card>): Card =>
  ({
    id: 'E-001',
    title: 'other',
    board: 'engineering',
    columnSlug: 'todo',
    order: 0,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: '',
    filePath: '/tmp/E-001.md',
    ...over,
  }) as Card;

describe('CardForm', () => {
  // One patch callback serves five inputs, so the field each input writes is exactly what a
  // refactor can silently swap. Every key is pinned individually.
  it.each([
    ['Title', 'title'],
    ['Description', 'description'],
    ['Tags (comma-separated)', 'tags'],
    ['Group', 'group'],
    ['Body (markdown)', 'body'],
  ])('the %s input patches only %s', (label, key) => {
    const onField = vi.fn();
    render(
      <CardForm fields={blank} onField={onField} linkable={[]} links={[]} onToggleLink={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'typed' } });
    expect(onField.mock.calls).toEqual([[{ [key]: 'typed' }]]);
  });

  it('shows the values it is given rather than keeping its own copy', () => {
    render(
      <CardForm
        fields={{ ...blank, title: 'a title', tags: 'ui, bug' }}
        onField={vi.fn()}
        linkable={[]}
        links={[]}
        onToggleLink={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Title')).toHaveProperty('value', 'a title');
    expect(screen.getByLabelText('Tags (comma-separated)')).toHaveProperty('value', 'ui, bug');
  });

  it('groups linkable cards by board and ticks the ones already linked', () => {
    render(
      <CardForm
        fields={blank}
        onField={vi.fn()}
        linkable={[card({ id: 'E-001' }), card({ id: 'P-002', board: 'product' })]}
        links={['P-002']}
        onToggleLink={vi.fn()}
      />,
    );
    // Only the boards with something to offer get a heading — Features has nothing here.
    expect(screen.getByText('Product')).toBeTruthy();
    expect(screen.getByText('Engineering')).toBeTruthy();
    expect(screen.queryByText('Features')).toBeNull();

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]); // product first, per BOARDS order
  });

  it('reports a toggled link by id', () => {
    const onToggleLink = vi.fn();
    render(
      <CardForm
        fields={blank}
        onField={vi.fn()}
        linkable={[card({ id: 'E-001' })]}
        links={[]}
        onToggleLink={onToggleLink}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleLink.mock.calls).toEqual([['E-001']]);
  });

  it('says so when there is nothing to link to', () => {
    render(
      <CardForm fields={blank} onField={vi.fn()} linkable={[]} links={[]} onToggleLink={vi.fn()} />,
    );
    expect(screen.getByText('No other cards yet to link.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
