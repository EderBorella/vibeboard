import { type ReactNode, useEffect, useRef, useState } from 'react';
import { archiveCard, createCard, getState, patchCard, placeCard, setLinks } from './api';
import { Board } from './components/Board';
import { CardsPane } from './components/CardsPane';
import { ProjectControl } from './components/ProjectControl';
import { ProjectGate } from './components/ProjectGate';
import { SettingsModal } from './components/SettingsModal';
import { TagFilter } from './components/TagFilter';
import { TopBar } from './components/TopBar';
import { UtilityDock } from './components/UtilityDock';
import { CopilotPanel } from './copilot/CopilotPanel';
import { type CopilotMode, useCopilot } from './copilot/useCopilot';
import type { DockPane } from './dock/panes';
import { useCardTabs } from './dock/useCardTabs';
import { useDock } from './dock/useDock';
import { useDispatch } from './runs/useDispatch';
import {
  BOARD_LABELS,
  BOARDS,
  type BoardName,
  type Card,
  type CardFrontmatterPatch,
  DEFAULT_CONTEXT_BUDGET,
} from './shared';
import { useSkills } from './skills/useSkills';
import { useCopilotChoice } from './useCopilotChoice';
import { useCollapsedBoards, useTheme } from './useLocalPrefs';
import { useSnapshot } from './useSnapshot';
import { canPlace, filterByTags, presentTags, tagCounts, toggleTag } from './viewmodel';

export function App() {
  const [bump, setBump] = useState(0);
  const [showGate, setShowGate] = useState(false);
  const [ready, setReady] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<'boards' | 'control'>('boards');
  // Tag filter: one filter across all three boards, and deliberately NOT persisted — a filter
  // restored on the next load reads as cards having gone missing.
  const [activeTags, setActiveTags] = useState<string[]>([]);
  // Open cards, one dock tab each. The state lives in its own hook so it is testable without
  // mounting the shell — see dock/useCardTabs.ts.
  const cards = useCardTabs();
  const dock = useDock();
  const dragged = useRef<Card | null>(null);
  const { snapshot, conn } = useSnapshot(bump);

  // Copilot state lives here (not in the panel) so the transcript + socket survive
  // closing/reopening the dock. The server-side session persists regardless.
  const copilot = useCopilot(bump);
  // Mode is per-turn and deliberately NOT persisted — you pick it for the task at hand.
  const [copilotMode, setCopilotMode] = useState<CopilotMode>('bypassPermissions');

  // Backend/model/effort: the config holds the defaults, the dock holds a session override.
  const {
    choice,
    overridden,
    setModel,
    setEffort,
    setBackend,
    reset: onResetCopilot,
  } = useCopilotChoice(snapshot?.config.copilot);

  const [theme, setTheme] = useTheme();
  const [collapsed, toggleBoard] = useCollapsedBoards();
  // Refetched on every snapshot, so a SKILL.md written by the user or an agent reaches the rail
  // without a reload.
  const catalogue = useSkills(snapshot);
  // Everything the details step needs. `choice.backend` drives the model list, so switching
  // connector in the form reloads it exactly as it does in the copilot dock.
  const dispatch = useDispatch(choice.backend, snapshot);

  const allCards = snapshot ? BOARDS.flatMap((b) => snapshot.boards[b] ?? []) : [];
  // Chips come from every card, not the filtered set, so the bar does not shrink out from under
  // the pointer as you narrow — the counts stay absolute for the same reason.
  const tags = tagCounts(allCards);
  const active = presentTags(activeTags, tags);

  // Creating a card writes it straight away and docks it, with the title ready to type over.
  // There is no create dialog: every field is editable in the pane, so a form would only be a
  // second way to do the same thing.
  const onAdd = (board: BoardName, columnSlug: string): void => {
    void createCard({ board, columnSlug, title: 'Untitled' }).then(onOpen);
  };
  const onPatch = (card: Card, patch: CardFrontmatterPatch): void => {
    void patchCard(card.board, card.id, patch);
  };
  const onLinks = (card: Card, links: string[]): void => {
    void setLinks(card.board, card.id, links);
  };
  // Opening a card docks it instead of covering the app with a modal, so the boards, the copilot
  // and the card stay usable together. Editing is still the modal, reached from the pane.
  const onOpen = (card: Card): void => {
    cards.open(card, allCards);
    dock.show('cards'); // unfolds the dock too, or the card opens out of sight
  };
  const onDragStart = (card: Card): void => {
    dragged.current = card;
  };
  const onArchive = (card: Card): void => {
    void archiveCard(card.board, card.id);
  };
  const onTag = (tag: string): void => setActiveTags((prev) => toggleTag(prev, tag));
  // Moving a card after a successful run is the user's click, never something the run does: 'Review'
  // does not exist on every board, and a wrong automatic move is worse than none.
  const onMoveCard = (card: Card, columnSlug: string): void => {
    void placeCard(card.board, card.id, columnSlug, null);
  };
  // Start a fresh chat on a backend switch, since a session belongs to the backend that
  // created it. Coordinating that is the shell's job; useCopilotChoice owns the override state.
  const onBackend = (backend: string): void => {
    if (backend === choice.backend) return;
    copilot.newSession();
    setBackend(backend);
  };
  // Position the dragged card: reorder within its column, or move it into another one.
  // beforeId is the card to land in front of; null means the end of the column.
  const onDrop = (board: BoardName, columnSlug: string, beforeId: string | null): void => {
    const card = dragged.current;
    dragged.current = null;
    if (!canPlace(card, board, beforeId)) return;
    void placeCard(card.board, card.id, columnSlug, beforeId);
  };

  useEffect(() => {
    getState()
      .then((s) => setShowGate(!s.open))
      .catch(() => setShowGate(true))
      .finally(() => setReady(true));
  }, []);

  // A newly-opened/scaffolded project: reconnect the socket so it receives the snapshot
  // of the now-open project (the server pushes a snapshot on connect when a project is open).
  function onOpened(): void {
    setShowGate(false);
    setBump((b) => b + 1);
    cards.clear(); // the open tabs all belong to the project being left
  }

  // The dock's occupants. Cards is the only one today; a terminal would be one more entry here
  // and one more component, with no change to UtilityDock.
  const panes: DockPane[] = snapshot
    ? [
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
              onOpenCard={onOpen}
              onPatch={onPatch}
              onLinks={onLinks}
              skills={catalogue.skills}
              invalid={catalogue.invalid}
              dispatch={{
                defaults: choice,
                models: dispatch.models,
                attachable: dispatch.attachable,
                busy: dispatch.busy,
                error: dispatch.error,
                onRun: dispatch.run,
                onBackend: onBackend,
              }}
              trigger={snapshot}
              onMove={onMoveCard}
            />
          ),
        },
      ]
    : [];

  // A flat chain rather than nested ternaries in the JSX: same four outcomes, and cognitive
  // complexity counts nesting far more heavily than sequence.
  let content: ReactNode;
  if (!ready) content = <div className="empty">Loading…</div>;
  else if (showGate) content = <ProjectGate onOpened={onOpened} />;
  else if (!snapshot)
    content = <div className="empty">{conn === 'open' ? 'No project open.' : 'Connecting…'}</div>;
  else
    content = (
      <div className="work">
        {/* The dock belongs inside this column, not across the window: the copilot keeps its full
            height beside it, which is the whole point of docking rather than overlaying. */}
        <div className="work-main">
          {tab === 'boards' ? (
            <main className="boards">
              <TagFilter tags={tags} active={active} onToggle={onTag} onClear={() => setActiveTags([])} />
              {BOARDS.map((board) => (
                <Board
                  key={board}
                  board={board}
                  label={BOARD_LABELS[board]}
                  cards={filterByTags(snapshot.boards[board] ?? [], active)}
                  config={snapshot.config}
                  archivedCount={snapshot.archivedCounts?.[board] ?? 0}
                  collapsed={collapsed.has(board)}
                  onToggle={() => toggleBoard(board)}
                  onAdd={onAdd}
                  onOpen={onOpen}
                  onArchive={onArchive}
                  onDragStart={onDragStart}
                  onTag={onTag}
                  onDrop={onDrop}
                />
              ))}
            </main>
          ) : (
            <ProjectControl snapshot={snapshot} />
          )}
          <UtilityDock
            panes={panes}
            activeId={dock.pane}
            onPane={dock.show}
            collapsed={dock.collapsed}
            onCollapse={dock.toggle}
          />
        </div>
        {copilotOpen && (
          <CopilotPanel
            copilot={copilot}
            backend={choice.backend}
            mode={copilotMode}
            model={choice.model}
            effort={choice.effort}
            onMode={setCopilotMode}
            onModel={setModel}
            onEffort={setEffort}
            onBackend={onBackend}
            overridden={overridden}
            contextBudget={snapshot.config.contextBudget ?? DEFAULT_CONTEXT_BUDGET}
            onReset={onResetCopilot}
            onClose={() => setCopilotOpen(false)}
          />
        )}
      </div>
    );

  return (
    <div className="app-shell">
      <TopBar
        showProject={Boolean(snapshot) && !showGate}
        projectName={snapshot?.name}
        tab={tab}
        onTab={setTab}
        theme={theme}
        onTheme={setTheme}
        copilotOpen={copilotOpen}
        onToggleCopilot={() => setCopilotOpen((v) => !v)}
        onSettings={() => setSettingsOpen(true)}
        onSwitchProject={() => setShowGate(true)}
        conn={conn}
      />

      {content}

      {settingsOpen && snapshot && (
        <SettingsModal
          config={snapshot.config}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
