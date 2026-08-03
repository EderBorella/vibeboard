import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  archiveCard,
  cancelRun,
  createCard,
  getState,
  patchCard,
  placeCard,
  resolveRunRecord,
  setLinks,
} from './api';
import { HaltOverlay } from './components/HaltOverlay';
import { ProjectGate } from './components/ProjectGate';
import { SettingsModal } from './components/SettingsModal';
import { type MainTab, TopBar } from './components/TopBar';
import { WorkArea } from './components/WorkArea';
import { archiveCardRequest, stopRunRequest } from './confirm/requests';
import { useConfirm } from './confirm/useConfirm';
import { type CopilotMode, useCopilot } from './copilot/useCopilot';
import { useCardTabs } from './dock/useCardTabs';
import { useDock } from './dock/useDock';
import { useDispatch } from './runs/useDispatch';
import { useRuns } from './runs/useRuns';
import { needsAttention } from './runs/viewmodel';
import { BOARDS, type BoardName, type Card, type CardFrontmatterPatch } from './shared';
import { useSkills } from './skills/useSkills';
import { useAutopilot } from './useAutopilot';
import { useCopilotChoice } from './useCopilotChoice';
import { useCollapsedBoards, useTheme } from './useLocalPrefs';
import { useSnapshot } from './useSnapshot';
import { canPlace, presentTags, tagCounts, toggleTag } from './viewmodel';

export function App() {
  const [bump, setBump] = useState(0);
  const [showGate, setShowGate] = useState(false);
  const [ready, setReady] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<MainTab>('boards');
  // Asked before anything irreversible. `dialog` is rendered at the bottom of the shell, above
  // everything else — see useConfirm.
  const { confirm, dialog } = useConfirm();
  // Tag filter: one filter across all three boards, and deliberately NOT persisted — a filter
  // restored on the next load reads as cards having gone missing.
  const [activeTags, setActiveTags] = useState<string[]>([]);
  // Open cards, one dock tab each. The state lives in its own hook so it is testable without
  // mounting the shell — see dock/useCardTabs.ts.
  const cards = useCardTabs();
  const dock = useDock();
  const dragged = useRef<Card | null>(null);
  const { snapshot, conn } = useSnapshot(bump);
  // Auto-pilot's state: the chip in the bar, and the overlay when the project is halted. From the
  // endpoint on mount and from the socket after that, so a kill in another tab raises the overlay here.
  const autopilot = useAutopilot(bump);

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
  // Every run in the project, for the Execution tab and its badge.
  const allRuns = useRuns(snapshot);

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
  // Reversible, and the copy says so — but it is a one-click ✕ on every tile, which makes it the
  // easiest thing here to do by accident.
  const onArchive = (card: Card): void => {
    void confirm(archiveCardRequest(card)).then((ok) => {
      if (ok) void archiveCard(card.board, card.id);
    });
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
  // A flat chain rather than nested ternaries in the JSX: same four outcomes, and cognitive
  // complexity counts nesting far more heavily than sequence.
  let content: ReactNode;
  if (!ready) content = <div className="empty">Loading…</div>;
  else if (showGate) content = <ProjectGate onOpened={onOpened} />;
  else if (!snapshot)
    content = <div className="empty">{conn === 'open' ? 'No project open.' : 'Connecting…'}</div>;
  else
    content = (
      <WorkArea
        snapshot={snapshot}
        tab={tab}
        allCards={allCards}
        runs={allRuns}
        skills={catalogue}
        cards={cards}
        dock={dock}
        copilot={{
          state: copilot,
          open: copilotOpen,
          mode: copilotMode,
          choice,
          overridden,
          onMode: setCopilotMode,
          onModel: setModel,
          onEffort: setEffort,
          onBackend,
          onReset: onResetCopilot,
          onClose: () => setCopilotOpen(false),
        }}
        dispatch={dispatch}
        boards={{
          tags,
          activeTags: active,
          collapsed,
          onToggleBoard: toggleBoard,
          onTag,
          onClearTags: () => setActiveTags([]),
        }}
        onAdd={onAdd}
        onOpen={onOpen}
        onArchive={onArchive}
        onDragStart={onDragStart}
        onDrop={onDrop}
        onPatch={onPatch}
        onLinks={onLinks}
        onMoveCard={onMoveCard}
        onCancelRun={(record) => {
          void confirm(stopRunRequest(record)).then((ok) => {
            if (ok) void cancelRun(record.run).catch(() => {});
          });
        }}
        onResolveRun={(record) => {
          void resolveRunRecord(record).catch(() => {});
        }}
      />
    );

  return (
    <div className="app-shell">
      <TopBar
        attentionCount={allRuns.runs.filter(needsAttention).length}
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
        autopilot={autopilot.state}
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

      {/* Last in the shell and above everything, like the confirm dialog: a halted project is not a
          state anything else in here should be reachable through. Only once a project is open — the
          gate has nothing to halt. */}
      {autopilot.state?.state === 'halted' && !showGate && (
        <HaltOverlay state={autopilot.state} onRestarted={autopilot.refresh} />
      )}

      {dialog}
    </div>
  );
}
