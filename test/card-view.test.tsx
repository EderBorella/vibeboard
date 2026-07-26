// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CardView } from '../web/src/components/CardView.js';
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

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'P-002',
    title: 'Ship the view tab',
    board: 'product',
    columnSlug: 'in-progress',
    order: 10,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: '',
    filePath: '/tmp/P-002.md',
    ...over,
  }) as Card;

describe('CardView', () => {
  it('offers no control that could change the card', () => {
    // The whole point of the tab: three surfaces exist and only two of them write.
    const { container } = render(
      <CardView
        card={card({ description: 'a summary', tags: ['bug'], body: '# Heading\n\ntext' })}
        config={config}
        allCards={[]}
      />,
    );
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('shows the board and the column display name, not the slug', () => {
    render(<CardView card={card()} config={config} allCards={[]} />);
    expect(screen.getByText('Product › In Progress')).toBeTruthy();
    expect(screen.getByText('Created 2026-07-26')).toBeTruthy();
  });

  it('shows the group, the tags and the description it is given', () => {
    // The positive side of three optional rows. Asserting only their absence leaves "render
    // nothing at all" indistinguishable from correct.
    const { container } = render(
      <CardView
        card={card({ group: 'Platform', tags: ['bug', 'ui'], description: 'a summary' })}
        config={config}
        allCards={[]}
      />,
    );
    expect(container.querySelector('.cv-group')?.textContent).toBe('Platform');
    expect([...container.querySelectorAll('.cv-tags .tag')].map((t) => t.textContent)).toEqual([
      'bug',
      'ui',
    ]);
    expect(container.querySelector('.cv-desc')?.textContent).toBe('a summary');
  });

  it('renders the body as markdown rather than as text', () => {
    const { container } = render(
      <CardView card={card({ body: '## Plan\n\n- one\n- two\n\n`code`' })} config={config} allCards={[]} />,
    );
    // Scoped to the body pane: the card's own title is an h2 too, and an unscoped query finds
    // that one first — it would pass with the body rendered as nothing at all.
    const body = container.querySelector('.cv-body');
    expect(body?.querySelector('h2')?.textContent).toBe('Plan');
    expect([...(body?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(body?.querySelector('code')?.textContent).toBe('code');
  });

  it('says so instead of rendering a blank pane when there is no body', () => {
    const { container } = render(<CardView card={card({ body: '   \n  ' })} config={config} allCards={[]} />);
    expect(screen.getByText('No body yet.')).toBeTruthy();
    expect(container.querySelector('.cv-body')).toBeNull();
  });

  it('lists linked cards by id and title, dropping ids nothing resolves', () => {
    const other = card({ id: 'E-001', board: 'engineering', title: 'Wire the tab' });
    render(
      <CardView card={card({ links: ['E-001', 'GONE-9'] })} config={config} allCards={[other]} />,
    );
    expect(screen.getByText('E-001')).toBeTruthy();
    expect(screen.getByText('Wire the tab')).toBeTruthy();
    expect(screen.queryByText('GONE-9')).toBeNull();
  });

  it('omits the tag row, the description and the link list when the card has none', () => {
    const { container } = render(<CardView card={card()} config={config} allCards={[]} />);
    expect(container.querySelector('.cv-tags')).toBeNull();
    expect(container.querySelector('.cv-desc')).toBeNull();
    expect(container.querySelector('.cv-links')).toBeNull();
  });

  it('reports an archived card as archived, and where it came from', () => {
    render(
      <CardView
        card={card({ columnSlug: 'archive', archived: '2026-07-26T10:00:00Z', archivedFrom: 'backlog' })}
        config={config}
        allCards={[]}
      />,
    );
    expect(screen.getByText('Product › Archived · from Backlog')).toBeTruthy();
  });
});
