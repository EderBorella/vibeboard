import { type ReactNode, useEffect, useRef, useState } from 'react';
import { archiveCard, getState, placeCard } from './api';
import { Board } from './components/Board';
import { CardEditor, type EditorState } from './components/CardEditor';
import { ProjectControl } from './components/ProjectControl';
import { ProjectGate } from './components/ProjectGate';
import { SettingsModal } from './components/SettingsModal';
import { TagFilter } from './components/TagFilter';
import { TopBar } from './components/TopBar';
import { CopilotPanel } from './copilot/CopilotPanel';
import { type CopilotMode, useCopilot } from './copilot/useCopilot';
import { BOARD_LABELS, BOARDS, type BoardName, type Card, DEFAULT_CONTEXT_BUDGET } from './shared';
import { useCopilotChoice } from './useCopilotChoice';
import { useCollapsedBoards, useTheme } from './useLocalPrefs';
import { useSnapshot } from './useSnapshot';
import { canPlace, filterByTags, presentTags, tagCounts, toggleTag } from './viewmodel';

export function App() {
  const [bump, setBump] = useState(0);
  const [showGate, setShowGate] = useState(false);
  const [ready, setReady] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<'boards' | 'control'>('boards');
  // Tag filter: one filter across all three boards, and deliberately NOT persisted — a filter
  // restored on the next load reads as cards having gone missing.
  const [activeTags, setActiveTags] = useState<string[]>([]);
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

  const onAdd = (board: BoardName, columnSlug: string): void =>
    setEditor({ mode: 'create', board, columnSlug });
  const onOpen = (card: Card): void => setEditor({ mode: 'edit', card });
  const onDragStart = (card: Card): void => {
    dragged.current = card;
  };
  const onArchive = (card: Card): void => {
    void archiveCard(card.board, card.id);
  };
  const onTag = (tag: string): void => setActiveTags((prev) => toggleTag(prev, tag));
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
  }

  const allCards = snapshot ? BOARDS.flatMap((b) => snapshot.boards[b] ?? []) : [];
  // Chips come from every card, not the filtered set, so the bar does not shrink out from under
  // the pointer as you narrow — the counts stay absolute for the same reason.
  const tags = tagCounts(allCards);
  const active = presentTags(activeTags, tags);

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

      {/* snapshot is only ever set, never cleared, so a card cannot be open without one. */}
      {editor && snapshot && (
        <CardEditor
          editor={editor}
          allCards={allCards}
          config={snapshot.config}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      )}
    </div>
  );
}
