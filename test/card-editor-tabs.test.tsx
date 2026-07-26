// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, ProjectConfig } from '../web/src/shared.js';

// Characterisation tests for the modal shell: which tab it opens on, which controls each tab
// offers, and the Raw tab's lazy read. Written before the pane extraction so the refactor has
// something to answer to — the component had no test of its own until now.

const api = vi.hoisted(() => ({
  getRaw: vi.fn(async () => '---\nid: P-002\n---\n\nfile body'),
  createCard: vi.fn(),
  patchCard: vi.fn(),
  putRaw: vi.fn(),
  setLinks: vi.fn(),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { CardEditor } = await import('../web/src/components/CardEditor.js');

afterEach(cleanup);
beforeEach(() => {
  api.getRaw.mockClear();
});

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

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'P-002',
    title: 'Ship the view tab',
    description: 'a summary',
    board: 'product',
    columnSlug: 'in-progress',
    order: 10,
    tags: ['ui'],
    links: [],
    created: '2026-07-26',
    body: '## Plan\n\ntext',
    filePath: '/tmp/P-002.md',
    ...over,
  }) as Card;

const open = (over: Partial<Card> = {}) =>
  render(
    <CardEditor
      editor={{ mode: 'edit', card: card(over) }}
      allCards={[card(over)]}
      config={config}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

const tabBtn = (name: string): HTMLElement => screen.getByRole('button', { name });

describe('CardEditor tabs', () => {
  it('opens an existing card on the read-only View tab', () => {
    const { container } = open();
    expect(tabBtn('View').className).toBe('active');
    expect(container.querySelector('.cardview')).toBeTruthy();
    // Nothing editable is mounted at all, not merely hidden.
    expect(container.querySelectorAll('input, textarea')).toHaveLength(0);
  });

  it('offers Close and Edit on View, and Cancel and Save once editing', () => {
    const { container } = open();
    expect(screen.getByText('Close')).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();

    act(() => screen.getByText('Edit').click());
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(container.querySelector('.cardview')).toBeNull();
  });

  it('opens a new card straight on the Form, with no View or Raw tab to offer', () => {
    render(
      <CardEditor
        editor={{ mode: 'create', board: 'product', columnSlug: 'backlog' }}
        allCards={[]}
        config={config}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(tabBtn('Form').className).toBe('active');
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Raw' })).toBeNull();
  });

  it('carries the card into the form fields', () => {
    const { container } = open();
    act(() => screen.getByText('Edit').click());
    expect(screen.getByDisplayValue('Ship the view tab')).toBeTruthy();
    expect(screen.getByDisplayValue('a summary')).toBeTruthy();
    expect(screen.getByDisplayValue('ui')).toBeTruthy();
    // Direct .value, not getByDisplayValue: that query normalises whitespace, so it cannot tell
    // the body's blank line from a space.
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('## Plan\n\ntext');
  });

  it('refuses to save a card with a blank title', () => {
    render(
      <CardEditor
        editor={{ mode: 'create', board: 'product', columnSlug: 'backlog' }}
        allCards={[]}
        config={config}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reads the file from disk only when Raw is opened, and only once', async () => {
    const { container } = open();
    expect(api.getRaw).not.toHaveBeenCalled();

    await act(async () => {
      tabBtn('Raw').click();
    });
    expect(api.getRaw.mock.calls).toEqual([['product', 'P-002']]);
    // The file's exact bytes: a frontmatter block is all separators, which a normalising query
    // would flatten into one line.
    expect(container.querySelector<HTMLTextAreaElement>('.raw-area')?.value).toBe(
      '---\nid: P-002\n---\n\nfile body',
    );

    // Away and back: the draft in the textarea must not be refetched over.
    await act(async () => {
      tabBtn('View').click();
    });
    await act(async () => {
      tabBtn('Raw').click();
    });
    expect(api.getRaw).toHaveBeenCalledTimes(1);
  });
});
