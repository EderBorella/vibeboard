// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getRaw: vi.fn(async () => 'file of the active card'),
  putRaw: vi.fn(async () => undefined),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { CardsPane } = await import('../web/src/components/CardsPane.js');
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
  onOpenCard: vi.fn(),
  onPatch: vi.fn(),
  onLinks: vi.fn(),
  config,
  skills: [],
  invalid: [],
  dispatch: {
    defaults: { backend: 'claude-code', model: 'opus', effort: 'high' },
    models: [],
    attachable: [],
    busy: false,
    error: null,
    onRun: vi.fn(async () => {}),
    onBackend: vi.fn(),
  },
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

  it('offers the Raw toggle for the active card, and not when there is no card', () => {
    const live = [card('E-001')];
    const { rerender } = render(
      <CardsPane {...props} tabs={[ref('E-001')]} activeId="E-001" live={live} />,
    );
    const toggle = screen.getByText('Raw');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.className).toBe('cards-raw');

    rerender(<CardsPane {...props} tabs={[]} activeId={null} live={live} />);
    expect(screen.queryByText('Raw')).toBeNull();
  });

  it('swaps the card view for its file, and back again', async () => {
    const { container } = render(
      <CardsPane {...props} tabs={[ref('E-001')]} activeId="E-001" live={[card('E-001')]} />,
    );
    expect(container.querySelector('.cardview')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Raw'));
    });
    expect(screen.getByText('Raw').className).toBe('cards-raw active');
    expect(screen.getByText('Raw').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.cardview')).toBeNull();
    expect((screen.getByLabelText('card file') as HTMLTextAreaElement).value).toBe(
      'file of the active card',
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Raw'));
    });
    expect(container.querySelector('.cardview')).toBeTruthy();
    expect(screen.queryByLabelText('card file')).toBeNull();
  });

  it('reports an inline edit against the card it belongs to', () => {
    const onPatch = vi.fn();
    const live = [card('E-001')];
    render(
      <CardsPane {...props} onPatch={onPatch} tabs={[ref('E-001')]} activeId="E-001" live={live} />,
    );
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'renamed' } });
    fireEvent.blur(screen.getByLabelText('title'));
    expect(onPatch.mock.calls).toEqual([[live[0], { title: 'renamed' }]]);
  });

  it('reports a link change against the card it belongs to', () => {
    const onLinks = vi.fn();
    const live = [card('E-001'), card('E-002')];
    render(
      <CardsPane {...props} onLinks={onLinks} tabs={[ref('E-001')]} activeId="E-001" live={live} />,
    );
    fireEvent.click(screen.getByText('Change'));
    fireEvent.click(screen.getByText('E-002').closest('label')?.querySelector('input') as HTMLElement);
    expect(onLinks.mock.calls).toEqual([[live[0], ['E-002']]]);
  });

  it('hands the catalogue to the rail, skills and invalid files alike', () => {
    // Without this, the pane could pass an empty list and every rail test would still pass — the
    // planted defect that found this gap was exactly that.
    render(
      <CardsPane
        {...props}
        skills={[
          {
            slug: 'execute',
            path: '.claude/skills/execute/SKILL.md',
            name: 'Execute',
            description: 'Implement the card',
            boards: [],
            columns: [],
            prompt: 'p',
          },
        ]}
        invalid={[{ slug: 'broken', path: '.claude/skills/broken/SKILL.md', reason: 'needs a name' }]}
        tabs={[ref('E-001')]}
        activeId="E-001"
        live={[card('E-001')]}
      />,
    );
    expect(screen.getByText('Execute').className).toBe('cs-action');
    expect(screen.getByText('⚠ 1 skill file invalid')).toBeTruthy();
  });

  it('rails the open card with its skill actions, and drops the rail when none is open', () => {
    const live = [card('E-001')];
    const { container, rerender } = render(
      <CardsPane {...props} tabs={[ref('E-001')]} activeId="E-001" live={live} />,
    );
    // Beside the body, not inside it: side-by-side is what gives the card a bounded measure, which
    // is the whole reason a long description used to run off the pane.
    expect(container.querySelector('.cards-main > .cards-body')).toBeTruthy();
    expect(container.querySelector('.cards-main > .card-skills')?.getAttribute('aria-label')).toBe(
      'Skills for E-001',
    );

    rerender(<CardsPane {...props} tabs={[]} activeId={null} live={live} />);
    expect(container.querySelector('.card-skills')).toBeNull();
  });

  it('keeps the rail up with the file showing, so switching to Raw does not shift the layout', async () => {
    const { container } = render(
      <CardsPane {...props} tabs={[ref('E-001')]} activeId="E-001" live={[card('E-001')]} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Raw'));
    });
    expect(container.querySelector('.card-skills')).toBeTruthy();
  });

  it('opens the details step for the skill that was clicked, and comes back', () => {
    const skills = [
      {
        slug: 'execute',
        path: '.claude/skills/execute/SKILL.md',
        name: 'Execute',
        description: 'Implement the card',
        boards: [],
        columns: [],
        prompt: 'p',
      },
    ];
    const { container } = render(
      <CardsPane
        {...props}
        skills={skills}
        tabs={[ref('E-001')]}
        activeId="E-001"
        live={[card('E-001')]}
      />,
    );
    fireEvent.click(screen.getByText('Execute'));
    expect(screen.getByLabelText('Run Execute on E-001')).toBeTruthy();
    // The card is replaced, not covered: nothing overlays anything in the dock.
    expect(container.querySelector('.cardview')).toBeNull();

    fireEvent.click(screen.getByText('Cancel'));
    expect(container.querySelector('.cardview')).toBeTruthy();
    expect(screen.queryByLabelText('Run Execute on E-001')).toBeNull();
  });

  it('returns to the card once a dispatch lands, and stays put when it is refused', async () => {
    const skills = [
      {
        slug: 'execute',
        path: '.claude/skills/execute/SKILL.md',
        name: 'Execute',
        description: 'Implement the card',
        boards: [],
        columns: [],
        prompt: 'p',
      },
    ];
    const onRun = vi.fn(async () => {});
    const { container, rerender } = render(
      <CardsPane
        {...props}
        dispatch={{ ...props.dispatch, onRun }}
        skills={skills}
        tabs={[ref('E-001')]}
        activeId="E-001"
        live={[card('E-001')]}
      />,
    );
    fireEvent.click(screen.getByText('Execute'));
    await act(async () => {
      fireEvent.click(screen.getByText('Run Execute'));
    });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.cardview')).toBeTruthy();

    // A refusal keeps the form up, with the shell's error showing.
    const rejecting = vi.fn(async () => {
      throw new Error('A run is already in flight');
    });
    rerender(
      <CardsPane
        {...props}
        dispatch={{ ...props.dispatch, onRun: rejecting, error: 'A run is already in flight' }}
        skills={skills}
        tabs={[ref('E-001')]}
        activeId="E-001"
        live={[card('E-001')]}
      />,
    );
    fireEvent.click(screen.getByText('Execute'));
    await act(async () => {
      fireEvent.click(screen.getByText('Run Execute'));
    });
    expect(screen.getByLabelText('Run Execute on E-001')).toBeTruthy();
    expect(screen.getByText('A run is already in flight')).toBeTruthy();
  });

  it('offers no run on an archived card, however many skills fit it', () => {
    // The rail is rendered either way, but a run edits the project and reports against a card that
    // is not on the board — so the actions are dead rather than misleading.
    const skills = [
      {
        slug: 'execute',
        path: '.claude/skills/execute/SKILL.md',
        name: 'Execute',
        description: 'Implement the card',
        boards: [],
        columns: [],
        prompt: 'p',
      },
    ];
    const frozen = card('E-009', { archived: '2026-07-26T10:00:00Z' });
    render(
      <CardsPane
        {...props}
        skills={skills}
        tabs={[{ board: 'engineering', id: 'E-009', frozen }]}
        activeId="E-009"
        live={[]}
      />,
    );
    const action = screen.getByText('Execute') as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(screen.queryByLabelText('Run Execute on E-009')).toBeNull();
  });

  it('edits a live card in place, and refuses to for an archived one', () => {
    // An archived card is not in the snapshot, so a patch would land on disk with nothing able to
    // show it — the pane offers no editing rather than lying about it.
    const live = [card('E-001')];
    const { container, rerender } = render(
      <CardsPane {...props} tabs={[ref('E-001')]} activeId="E-001" live={live} />,
    );
    expect(container.querySelector('.inline-view')).toBeTruthy();

    const frozen = card('E-009', { archived: '2026-07-26T10:00:00Z' });
    rerender(
      <CardsPane
        {...props}
        tabs={[{ board: 'engineering', id: 'E-009', frozen }]}
        activeId="E-009"
        live={[]}
      />,
    );
    expect(container.querySelector('.inline-view')).toBeNull();
  });

});
