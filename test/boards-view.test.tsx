// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardsView } from '../web/src/board/BoardsView.js';
import type { BoardName, Card, ProjectConfig, ProjectSnapshot } from '../web/src/shared.js';

afterEach(cleanup);

const config: ProjectConfig = {
  name: 'T',
  boards: {
    features: { columns: ['Backlog', 'Done'] },
    product: { columns: ['Backlog', 'Done'] },
    engineering: { columns: ['Todo', 'Done'] },
  },
  miniatureChars: 40,
  idPadding: 3,
  keepChats: 20,
  contextBudget: 200_000,
  maxConcurrentRuns: 3,
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

const snapshot = (over: Partial<ProjectSnapshot> = {}): ProjectSnapshot =>
  ({
    root: '/tmp/p',
    name: 'Demo',
    config,
    boards: { features: [], product: [], engineering: [] },
    archivedCounts: { features: 0, product: 0, engineering: 0 },
    ...over,
  }) as ProjectSnapshot;

const props = {
  snapshot: snapshot(),
  tags: [] as { tag: string; count: number }[],
  activeTags: [] as string[],
  collapsed: new Set<BoardName>(),
  onToggleBoard: vi.fn(),
  onTag: vi.fn(),
  onClearTags: vi.fn(),
  onAdd: vi.fn(),
  onOpen: vi.fn(),
  onArchive: vi.fn(),
  onDragStart: vi.fn(),
  onDrop: vi.fn(),
};

// The head button holds a chevron, the label, and the card count as one text node run.
const boardLabels = (): string[] =>
  [...document.querySelectorAll('.board-label')].map((e) =>
    (e.textContent ?? '').replace(/[▸▾]/g, '').replace(/\d+$/, ''),
  );

describe('BoardsView', () => {
  it('renders all three boards, in the order the model defines', () => {
    render(<BoardsView {...props} />);
    expect(boardLabels()).toEqual(['Features', 'Product', 'Engineering']);
  });

  it('gives each board its own cards, not the whole project', () => {
    render(
      <BoardsView
        {...props}
        snapshot={snapshot({
          boards: {
            features: [card('F-001')],
            product: [],
            engineering: [card('E-001'), card('E-002')],
          },
        })}
      />,
    );
    // The count each board head shows: 1, 0, 2 — a mutant handing every board the same list makes
    // all three equal, which a single-board assertion would not notice.
    expect([...document.querySelectorAll('[data-testid="board-count"]')].map((e) => e.textContent)).toEqual([
      '1',
      '0',
      '2',
    ]);
  });

  it('survives a snapshot with a board missing entirely', () => {
    // Older projects, and any board added to the model after a snapshot was taken: `?? []` is what
    // stops the whole view throwing on a key that is not there.
    const partial = snapshot();
    delete (partial.boards as Partial<Record<BoardName, Card[]>>).product;
    render(<BoardsView {...props} snapshot={partial} />);
    expect(boardLabels()).toEqual(['Features', 'Product', 'Engineering']);
    // Empty, not "one card": the fallback has to be an empty list, and a board rendering a phantom
    // card is worse than one rendering none.
    expect([...document.querySelectorAll('[data-testid="board-count"]')].map((e) => e.textContent)).toEqual([
      '0',
      '0',
      '0',
    ]);
  });

  it('narrows every board to the cards carrying all the active tags', () => {
    render(
      <BoardsView
        {...props}
        activeTags={['api', 'urgent']}
        snapshot={snapshot({
          boards: {
            features: [card('F-001', { tags: ['api', 'urgent'] }), card('F-002', { tags: ['api'] })],
            product: [card('P-001', { tags: ['urgent'] })],
            engineering: [card('E-001', { tags: ['api', 'urgent', 'extra'] })],
          },
        })}
      />,
    );
    // Both tags required, not either: F-002 and P-001 each carry one and must be filtered out.
    expect([...document.querySelectorAll('[data-testid="board-count"]')].map((e) => e.textContent)).toEqual([
      '1',
      '0',
      '1',
    ]);
  });

  it('passes each board its own archived count', () => {
    render(
      <BoardsView
        {...props}
        snapshot={snapshot({ archivedCounts: { features: 0, product: 4, engineering: 1 } })}
      />,
    );
    // Only boards with archived cards offer the drawer, so the zero must stay a zero.
    expect([...document.querySelectorAll('.board-archive')].map((e) => e.textContent?.trim())).toEqual([
      '🗄 4',
      '🗄 1',
    ]);
  });

  it('treats a snapshot with no archive counts at all as none archived', () => {
    const partial = snapshot();
    delete (partial as { archivedCounts?: unknown }).archivedCounts;
    render(<BoardsView {...props} snapshot={partial} />);
    expect(document.querySelectorAll('.board-archive')).toHaveLength(0);
  });

  it('reports which board was collapsed, not just that one was', () => {
    // The handler is built per board inside the map; a mutant that closes over the wrong one
    // collapses a different board than the one clicked.
    const onToggleBoard = vi.fn();
    render(<BoardsView {...props} onToggleBoard={onToggleBoard} />);
    fireEvent.click(screen.getByText('Product'));
    expect(onToggleBoard.mock.calls).toEqual([['product']]);
  });

  it('shows a board as collapsed when the shell says it is', () => {
    render(<BoardsView {...props} collapsed={new Set<BoardName>(['product'])} />);
    const heads = [...document.querySelectorAll('.board-label')].map((e) => e.getAttribute('aria-expanded'));
    expect(heads).toEqual(['true', 'false', 'true']);
  });

  it('offers the tag filter above the boards', () => {
    render(<BoardsView {...props} tags={[{ tag: 'api', count: 2 }]} />);
    expect(screen.getByText(/api/)).toBeTruthy();
  });
});
