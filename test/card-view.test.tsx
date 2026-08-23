// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardView } from '../web/src/organisms/cards/CardView.js';
import type { Card, ProjectConfig } from '../web/src/lib/shared.js';

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
  maxConcurrentRuns: 3,
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
    expect([...container.querySelectorAll('[data-testid="cv-tag"]')].map((t) => t.textContent)).toEqual([
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
    render(<CardView card={card({ links: ['E-001', 'GONE-9'] })} config={config} allCards={[other]} />);
    expect(screen.getByText('E-001')).toBeTruthy();
    expect(screen.getByText('Wire the tab')).toBeTruthy();
    expect(screen.queryByText('GONE-9')).toBeNull();
  });

  it('makes each link a button that reports the card to open', () => {
    const other = card({ id: 'E-001', board: 'engineering', title: 'Wire the tab' });
    const onOpenCard = vi.fn();
    render(
      <CardView
        card={card({ links: ['E-001'] })}
        config={config}
        allCards={[other]}
        onOpenCard={onOpenCard}
      />,
    );
    const link = screen.getByTitle('Open E-001');
    expect(link.tagName).toBe('BUTTON');
    link.click();
    expect(onOpenCard.mock.calls).toEqual([[other]]);
  });

  it('leaves links as plain rows where nothing can open them', () => {
    // A view with no handler must not offer navigation it cannot perform.
    const other = card({ id: 'E-001', title: 'Wire the tab' });
    const { container } = render(
      <CardView card={card({ links: ['E-001'] })} config={config} allCards={[other]} />,
    );
    expect(screen.queryByTitle('Open E-001')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('.cv-link')?.tagName).toBe('DIV');
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

// The editable surface: with a patch handler every field is click-to-edit and commits on its own.
describe('CardView editing', () => {
  const editable = (over: Partial<Card> = {}, onPatch = vi.fn()) => ({
    onPatch,
    ...render(<CardView card={card(over)} config={config} allCards={[]} onPatch={onPatch} />),
  });

  it.each([
    ['title', 'cv-title', 'a new title', { title: 'a new title' }],
    ['description', 'cv-desc', 'a summary', { description: 'a summary' }],
    ['group', 'cv-group', 'Platform', { group: 'Platform' }],
    ['body', 'cv-body', 'new body', { body: 'new body' }],
  ])('commits %s on its own, patching only that field', (label, _cls, typed, patch) => {
    const onPatch = vi.fn();
    editable({ title: 'old', description: 'old', group: 'old', body: 'old' }, onPatch);
    fireEvent.click(screen.getByTitle(`Edit ${label}`));
    fireEvent.change(screen.getByLabelText(label), { target: { value: typed } });
    fireEvent.blur(screen.getByLabelText(label));
    expect(onPatch.mock.calls).toEqual([[patch]]);
  });

  it('commits tags as a parsed list, not as the line that was typed', () => {
    const onPatch = vi.fn();
    editable({ tags: ['ui'] }, onPatch);
    fireEvent.click(screen.getByTitle('Edit tags'));
    fireEvent.change(screen.getByLabelText('tags'), { target: { value: 'ui, bug,' } });
    fireEvent.blur(screen.getByLabelText('tags'));
    expect(onPatch.mock.calls).toEqual([[{ tags: ['ui', 'bug'] }]]);
  });

  it('shows tags as chips and the body as markdown while not editing', () => {
    const { container } = editable({ tags: ['ui', 'bug'], body: '## Plan' });
    expect([...container.querySelectorAll('[data-testid="cv-tag"]')].map((t) => t.textContent)).toEqual([
      'ui',
      'bug',
    ]);
    expect(container.querySelector('.cv-body h2')?.textContent).toBe('Plan');
  });

  it('offers every empty field as something to click', () => {
    editable({ title: 'kept', description: undefined, group: undefined, tags: [], body: '' });
    expect(screen.getByTitle('Edit description').textContent).toBe('+ description');
    expect(screen.getByTitle('Edit group').textContent).toBe('+ group');
    expect(screen.getByTitle('Edit tags').textContent).toBe('+ tags');
    expect(screen.getByTitle('Edit body').textContent).toBe('+ body');
  });

  it('has no editable field at all without a patch handler', () => {
    // The archived case: the pane cannot show the result of a patch, so it offers none.
    const { container } = render(
      <CardView card={card({ title: 'archived' })} config={config} allCards={[]} />,
    );
    expect(container.querySelectorAll('.inline-view')).toHaveLength(0);
    expect(container.querySelector('.cv-title')?.tagName).toBe('H2');
  });
});

describe('CardView field wiring', () => {
  const patchOf = (over: Partial<Card>, label: string, typed: string) => {
    const onPatch = vi.fn();
    render(<CardView card={card(over)} config={config} allCards={[]} onPatch={onPatch} />);
    fireEvent.click(screen.getByTitle(`Edit ${label}`));
    fireEvent.change(screen.getByLabelText(label), { target: { value: typed } });
    fireEvent.blur(screen.getByLabelText(label));
    return onPatch;
  };

  it('refuses to empty the title but allows emptying the others', () => {
    // Only the title is required — a card with no name is unfindable everywhere it is listed.
    expect(patchOf({ title: 'kept' }, 'title', '   ')).not.toHaveBeenCalled();
    cleanup();
    expect(patchOf({ description: 'gone' }, 'description', '').mock.calls).toEqual([[{ description: '' }]]);
  });

  it('names each empty field by what it would add', () => {
    render(<CardView card={card({ title: '' })} config={config} allCards={[]} onPatch={vi.fn()} />);
    expect(screen.getByTitle('Edit title').textContent).toBe('Untitled');
  });

  it('keeps the display classes the theme styles the fields by', () => {
    const { container } = render(
      <CardView
        card={card({ group: 'Platform', description: 'a summary' })}
        config={config}
        allCards={[]}
        onPatch={vi.fn()}
      />,
    );
    expect(container.querySelector('.cv-title.inline-view')).toBeTruthy();
    expect(container.querySelector('.cv-group.inline-view')).toBeTruthy();
    expect(container.querySelector('.cv-desc.inline-view')).toBeTruthy();
    expect(container.querySelector('.cv-body.inline-view')).toBeTruthy();
  });
});
