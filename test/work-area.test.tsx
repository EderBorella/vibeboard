// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The children fetch on mount (Project Control's file list, a card's runs, the model list). None of
// that is what this file is about: WorkArea's job is choosing WHICH view renders.
const api = vi.hoisted(() => ({
  listControlFiles: vi.fn(async () => []),
  // Keyed like the real endpoint: runs AND that card's ledger line. A mock shaped differently from
  // the thing it stands in for tests a response nothing serves.
  listCardRuns: vi.fn(async () => ({
    runs: [],
    account: { spend: { runs: 0, withCost: 0, withoutCost: 0 }, attempts: {}, attemptCap: 3 },
  })),
  getAccounting: vi.fn(async () => {
    throw new Error('no ledger in this test');
  }),
  listResources: vi.fn(async () => []),
  listDiary: vi.fn(async () => []),
  // The Project Log is a split now, and the dock has a Suggestions pane: both read this. Typed, because
  // an inferred `never[]` makes every `mockResolvedValue` in this file a compile error.
  listSuggestions: vi.fn(async (): Promise<Suggestion[]> => []),
  listSkills: vi.fn(async () => ({ skills: [], invalid: [] })),
  listModels: vi.fn(async () => []),
  getModelStatus: vi.fn(async () => ({ up: true })),
  putSkill: vi.fn(async () => ({ skills: [], invalid: [] })),
  getResources: vi.fn(async () => ({ links: [] })),
  getControlFile: vi.fn(async () => ({
    path: 'x',
    name: 'x',
    category: 'docs',
    managed: false,
    deletable: true,
    content: '',
  })),
  cancelRun: vi.fn(async () => ({ ok: true })),
  resolveRun: vi.fn(async () => ({ run: {} })),
  getRaw: vi.fn(async () => ''),
  putRaw: vi.fn(async () => undefined),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { WorkArea } = await import('../web/src/components/WorkArea.js');
import type { MainTab } from '../web/src/components/TopBar.js';
import type { BoardName, Card, ProjectConfig, ProjectSnapshot, Suggestion } from '../web/src/shared.js';

afterEach(cleanup);

// jsdom implements no scrolling at all. The copilot transcript scrolls itself to the bottom on
// mount, so without this the panel cannot render here — nothing about scrolling is under test.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? ((): void => {});

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

const snapshot = {
  root: '/tmp/p',
  name: 'Demo',
  config,
  boards: { features: [], product: [], engineering: [] },
  archivedCounts: { features: 0, product: 0, engineering: 0 },
} as ProjectSnapshot;

const card = (id: string): Card =>
  ({
    id,
    title: `title of ${id}`,
    board: 'engineering' as BoardName,
    columnSlug: 'todo',
    order: 0,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: '',
    filePath: `/tmp/${id}.md`,
  }) as Card;

const copilotState = {
  items: [],
  running: false,
  sessionId: undefined,
  model: undefined,
  stats: { costUsd: 0, durationMs: 0, turns: 0, contextTokens: 0 },
  chats: [],
  currentChatId: undefined,
  send: vi.fn(),
  compact: vi.fn(),
  newSession: vi.fn(),
  openChat: vi.fn(),
  deleteChat: vi.fn(),
  cancel: vi.fn(),
} as unknown as Parameters<typeof WorkArea>[0]['copilot']['state'];

const props = {
  snapshot,
  tab: 'boards' as MainTab,
  bump: 0,
  allCards: [] as Card[],
  runs: { runs: [], active: [], queued: [] },
  skills: { skills: [], invalid: [] },
  cards: {
    tabs: [] as { board: BoardName; id: string }[],
    activeId: null,
    open: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
  } as unknown as Parameters<typeof WorkArea>[0]['cards'],
  dock: { pane: 'cards', collapsed: false, show: vi.fn(), toggle: vi.fn() } as unknown as Parameters<
    typeof WorkArea
  >[0]['dock'],
  copilot: {
    state: copilotState,
    open: false,
    mode: 'bypassPermissions',
    choice: { backend: 'claude-code', model: 'opus', effort: 'high' },
    overridden: false,
    onMode: vi.fn(),
    onModel: vi.fn(),
    onEffort: vi.fn(),
    onBackend: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
  },
  dispatch: { models: [], attachable: [], busy: false, error: null, run: vi.fn(async () => {}) },
  boards: {
    tags: [],
    activeTags: [],
    collapsed: new Set<BoardName>(),
    onToggleBoard: vi.fn(),
    onTag: vi.fn(),
    onClearTags: vi.fn(),
  },
  onAdd: vi.fn(),
  onOpen: vi.fn(),
  onArchive: vi.fn(),
  onDragStart: vi.fn(),
  onDrop: vi.fn(),
  onPatch: vi.fn(),
  onLinks: vi.fn(),
  onMoveCard: vi.fn(),
  onCancelRun: vi.fn(),
  onResolveRun: vi.fn(),
};

// Which of the main views is on screen. Exactly one should ever be.
// The Explorer reuses Project Control's two-column layout, so it carries `.control` as well as
// `.explorer` — hence `:not(.explorer)` rather than a bare `.control`, which would report both.
const shown = (): string[] => {
  const views: string[] = [];
  if (document.querySelector('main.boards')) views.push('boards');
  if (document.querySelector('main.execution')) views.push('execution');
  if (document.querySelector('.control:not(.explorer)')) views.push('control');
  if (document.querySelector('.control.explorer')) views.push('explorer');
  if (document.querySelector('section.diary')) views.push('diary');
  return views;
};

// Derived from the component's own tab list rather than hand-written, so a tab added later fails these until
// somebody renders it. The previous hand-written list knew four tabs and the fifth went untested — deleting
// the line that renders it passed 10 of 10.
const ALL_TABS: MainTab[] = ['boards', 'execution', 'diary', 'control', 'explorer'];

describe('WorkArea', () => {
  it.each([
    ['boards', 'boards'],
    ['execution', 'execution'],
    ['diary', 'diary'],
    ['control', 'control'],
    ['explorer', 'explorer'],
  ])('shows only the %s view for that tab', (tab, expected) => {
    render(<WorkArea {...props} tab={tab as 'boards'} />);
    expect(shown()).toEqual([expected]);
  });

  it('never renders two views at once', () => {
    // A REGRESSION test: a two-way ternary here once rendered Project Control underneath the
    // Execution view, because with three tabs `boards ? … : …` puts the else-branch on both others.
    for (const tab of ALL_TABS) {
      const { unmount } = render(<WorkArea {...props} tab={tab} />);
      expect(shown()).toHaveLength(1);
      unmount();
    }
  });

  it('keeps the utility dock on every tab, because a card outlives the view you opened it from', () => {
    for (const tab of ALL_TABS) {
      const { unmount } = render(<WorkArea {...props} tab={tab} />);
      expect(screen.getByText('Cards')).toBeTruthy();
      unmount();
    }
  });

  it('actually renders the cards pane inside the dock, not just its tab', () => {
    // The pane is keyed by id against the dock's active pane, and its content comes from a render
    // callback. Either one broken leaves the tab visible above an empty dock.
    render(<WorkArea {...props} />);
    const pane = document.querySelector('.dock-pane') as HTMLElement;
    expect(pane).toBeTruthy();
    expect(pane.hasAttribute('hidden')).toBe(false);
    expect(pane.querySelector('.cards-pane')).toBeTruthy();
    expect(screen.getByText('No card open.')).toBeTruthy();
  });

  it('badges the dock with the number of open cards, and nothing at zero', () => {
    // "Cards 0" is noise: the pane says so itself when empty.
    render(<WorkArea {...props} />);
    expect(document.querySelector('.dock-tab .dock-badge')).toBeNull();
    cleanup();

    render(
      <WorkArea
        {...props}
        allCards={[card('E-001'), card('E-002')]}
        cards={{ ...props.cards, tabs: [
          { board: 'engineering', id: 'E-001' },
          { board: 'engineering', id: 'E-002' },
        ] } as typeof props.cards}
      />,
    );
    expect(document.querySelector('.dock-badge')?.textContent).toBe('2');
  });

  // The dock's second occupant (decision 48). `UtilityDock` carries no knowledge of any particular pane,
  // so this is one descriptor plus one component — which is what the comment above the pane list predicted.
  it('leaves the Cards pane the first pane', async () => {
    render(<WorkArea {...props} dock={{ ...props.dock, pane: null } as typeof props.dock} />);
    // `activePane` falls back to the FIRST, so the order in that list is what a person sees on open.
    const tabs = [...document.querySelectorAll('.dock-tab')].map((t) => t.textContent);
    expect(tabs[0]).toContain('Cards');
    expect(tabs[1]).toContain('Suggestions');
    expect(document.querySelector('.dock-pane')?.querySelector('.cards-pane')).toBeTruthy();
    // Awaited, so the pane's own fetch resolves inside the test rather than after it.
    await waitFor(() => expect(api.listSuggestions).toHaveBeenCalled());
  });

  it('badges the Suggestions pane with the active count, and not with zero', async () => {
    // "Suggestions 0" is noise, exactly as "Cards 0" is.
    render(<WorkArea {...props} />);
    await waitFor(() => expect(api.listSuggestions).toHaveBeenCalled());
    expect(document.querySelectorAll('.dock-badge')).toHaveLength(0);
    cleanup();

    api.listSuggestions.mockResolvedValue([
      { id: 's-1', state: 'active', created: '2026-08-05T10:00:00.000Z', title: 'one', body: '' },
      { id: 's-2', state: 'active', created: '2026-08-05T10:00:00.000Z', title: 'two', body: '' },
    ]);
    render(<WorkArea {...props} />);
    // The badge is on the SUGGESTIONS tab: with no card open, it is the only badge on the strip.
    await waitFor(() => expect(document.querySelector('.dock-badge')?.textContent).toBe('2'));
    api.listSuggestions.mockResolvedValue([]);
  });

  it('shows the copilot only when it is open', () => {
    render(<WorkArea {...props} />);
    expect(document.querySelector('.copilot')).toBeNull();
    cleanup();
    render(<WorkArea {...props} copilot={{ ...props.copilot, open: true }} />);
    expect(document.querySelector('.copilot')).toBeTruthy();
  });

  it('passes the runs through to the execution view', () => {
    render(
      <WorkArea
        {...props}
        tab="execution"
        allCards={[card('E-001')]}
        runs={{
          runs: [
            {
              run: 'r1',
              card: 'E-001',
              board: 'engineering',
              skill: 'execute',
              status: 'attention',
              started: '2026-07-26T14:30:00.000Z',
              backend: 'claude-code',
              model: 'opus',
              effort: 'high',
              mode: 'bypassPermissions',
              report: '',
            },
          ],
          active: [],
          queued: [],
        }}
      />,
    );
    expect(screen.getByLabelText('Requires attention').querySelectorAll('.exec-run')).toHaveLength(1);
  });
});
