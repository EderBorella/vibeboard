import type { DispatchRequest, InvalidSkill, ModelOption, RunList, RunRecord, Skill } from '../api';
import { CopilotPanel } from '../copilot/CopilotPanel';
import type { useCopilot } from '../copilot/useCopilot';
import type { DockPane } from '../dock/panes';
import type { useCardTabs } from '../dock/useCardTabs';
import type { Dock } from '../dock/useDock';
import type { BoardName, Card, CardFrontmatterPatch, ProjectSnapshot } from '../shared';
import { DEFAULT_CONTEXT_BUDGET } from '../shared';
import { useSuggestions } from '../suggestions/useSuggestions';
import type { TagCount } from '../viewmodel';
import { BoardsView } from './BoardsView';
import { CardsPane } from './CardsPane';
import { DiaryView } from './DiaryView';
import { ExecutionView } from './ExecutionView';
import { ExplorerView } from './ExplorerView';
import { ProjectControl } from './ProjectControl';
import { SuggestionsPane } from './SuggestionsPane';
import type { MainTab } from './TopBar';
import { UtilityDock } from './UtilityDock';

// Grouped rather than spread across twenty loose props: each of these is one concern the work area
// passes through, and naming them keeps the call site readable.
interface WorkAreaProps {
  snapshot: ProjectSnapshot;
  tab: MainTab;
  // App's project counter. Threaded rather than defaulted, so the diary refetches on a project switch —
  // and so nothing here opens a second socket, which is what a hard-coded 0 did in slice D's Settings panel.
  bump: number;
  allCards: Card[];
  runs: RunList;
  skills: { skills: Skill[]; invalid: InvalidSkill[] };
  cards: ReturnType<typeof useCardTabs>;
  dock: Dock;
  copilot: {
    state: ReturnType<typeof useCopilot>;
    open: boolean;
    mode: string;
    choice: { backend: string; model: string; effort: string };
    overridden: boolean;
    onMode: (mode: string) => void;
    onModel: (model: string) => void;
    onEffort: (effort: string) => void;
    onBackend: (backend: string) => void;
    onReset: () => void;
    onClose: () => void;
  };
  dispatch: {
    models: ModelOption[];
    attachable: string[];
    busy: boolean;
    error: string | null;
    run: (request: DispatchRequest) => Promise<void>;
  };
  boards: {
    tags: TagCount[];
    activeTags: string[];
    collapsed: Set<BoardName>;
    onToggleBoard: (board: BoardName) => void;
    onTag: (tag: string) => void;
    onClearTags: () => void;
  };
  onAdd: (board: BoardName, columnSlug: string) => void;
  onOpen: (card: Card) => void;
  onArchive: (card: Card) => void;
  onDragStart: (card: Card) => void;
  onDrop: (board: BoardName, columnSlug: string, beforeId: string | null) => void;
  onPatch: (card: Card, patch: CardFrontmatterPatch) => void;
  onLinks: (card: Card, links: string[]) => void;
  onMoveCard: (card: Card, columnSlug: string) => void;
  onCancelRun: (record: RunRecord) => void;
  onResolveRun: (record: RunRecord) => void;
}

// Everything below the top bar: the active view, the utility dock beneath it, and the copilot beside
// them. Split from App so the shell chooses a view while this builds one — App was over the
// complexity gate with both jobs in one function, and the extraction that mattered was this seam
// rather than the smaller ones tried first.
export function WorkArea(props: WorkAreaProps) {
  const { snapshot, tab, allCards, runs, skills, cards, dock, copilot, dispatch, boards } = props;
  // HERE rather than inside the pane, because the dock's badge needs the count whether or not that pane
  // is the one on screen — and a badge nobody can see until they click the tab is no badge.
  const filed = useSuggestions(props.bump, 'active');

  // The dock's occupants. A terminal would be one more entry here and one more component, with no
  // change to UtilityDock.
  const panes: DockPane[] = [
    {
      id: 'cards',
      label: 'Cards',
      // No badge at zero: "Cards 0" is noise, and the pane says so itself.
      badge: cards.tabs.length || undefined,
      render: () => (
        <CardsPane
          tabs={cards.tabs}
          activeId={cards.activeId}
          live={allCards}
          config={snapshot.config}
          onFocus={cards.focus}
          onClose={cards.close}
          onOpenCard={props.onOpen}
          onPatch={props.onPatch}
          onLinks={props.onLinks}
          skills={skills.skills}
          invalid={skills.invalid}
          dispatch={{
            defaults: copilot.choice,
            models: dispatch.models,
            attachable: dispatch.attachable,
            busy: dispatch.busy,
            error: dispatch.error,
            onRun: dispatch.run,
            onBackend: copilot.onBackend,
          }}
          trigger={snapshot}
          onMove={props.onMoveCard}
        />
      ),
    },
    {
      id: 'suggestions',
      label: 'Suggestions',
      // No badge at zero, like Cards: "Suggestions 0" is noise.
      badge: filed.suggestions.length || undefined,
      render: () => (
        <SuggestionsPane
          suggestions={filed.suggestions}
          failed={filed.failed}
          onRefresh={filed.refresh}
          onApply={filed.apply}
        />
      ),
    },
  ];

  return (
    <div className="work">
      {/* The dock belongs inside this column, not across the window: the copilot keeps its full
          height beside it, which is the whole point of docking rather than overlaying. */}
      <div className="work-main">
        {/* An explicit condition per tab, not a two-way ternary: with three tabs, `boards ? … : …`
            rendered Project Control underneath the Execution view. */}
        {tab === 'boards' && (
          <BoardsView
            snapshot={snapshot}
            tags={boards.tags}
            activeTags={boards.activeTags}
            collapsed={boards.collapsed}
            onToggleBoard={boards.onToggleBoard}
            onTag={boards.onTag}
            onClearTags={boards.onClearTags}
            onAdd={props.onAdd}
            onOpen={props.onOpen}
            onArchive={props.onArchive}
            onDragStart={props.onDragStart}
            onDrop={props.onDrop}
          />
        )}
        {tab === 'execution' && (
          <ExecutionView
            runs={runs.runs}
            active={runs.active}
            queued={runs.queued}
            cards={allCards}
            now={Date.now()}
            onOpenCard={props.onOpen}
            onCancel={props.onCancelRun}
            onResolve={props.onResolveRun}
          />
        )}
        {tab === 'diary' && <DiaryView bump={props.bump} />}
        {tab === 'control' && <ProjectControl snapshot={snapshot} />}
        {tab === 'explorer' && <ExplorerView snapshot={snapshot} />}
        <UtilityDock
          panes={panes}
          activeId={dock.pane}
          onPane={dock.show}
          collapsed={dock.collapsed}
          onCollapse={dock.toggle}
        />
      </div>
      {copilot.open && (
        <CopilotPanel
          copilot={copilot.state}
          backend={copilot.choice.backend}
          mode={copilot.mode}
          model={copilot.choice.model}
          effort={copilot.choice.effort}
          onMode={copilot.onMode}
          onModel={copilot.onModel}
          onEffort={copilot.onEffort}
          onBackend={copilot.onBackend}
          overridden={copilot.overridden}
          contextBudget={snapshot.config.contextBudget ?? DEFAULT_CONTEXT_BUDGET}
          onReset={copilot.onReset}
          onClose={copilot.onClose}
        />
      )}
    </div>
  );
}
