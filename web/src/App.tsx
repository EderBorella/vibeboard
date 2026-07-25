import { useEffect, useRef, useState } from 'react';
import { BOARDS, BOARD_LABELS, type BoardName, type Card } from './shared';
import { useSnapshot } from './useSnapshot';
import { getState, moveCard, archiveCard, patchConfig } from './api';
import { Board } from './components/Board';
import { ProjectControl } from './components/ProjectControl';
import { ProjectGate } from './components/ProjectGate';
import { CardEditor, type EditorState } from './components/CardEditor';
import { SettingsModal } from './components/SettingsModal';
import { CopilotPanel } from './copilot/CopilotPanel';
import { useCopilot, type CopilotMode, type EffortLevel } from './copilot/useCopilot';

// Add a theme here after adding its [data-theme] block in themes.css.
const THEMES: { value: string; label: string }[] = [
  { value: 'cyberpunk', label: 'Cyberpunk' },
  { value: 'classic-dark', label: 'Classic Dark' },
];

export function App() {
  const [bump, setBump] = useState(0);
  const [showGate, setShowGate] = useState(false);
  const [ready, setReady] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<'boards' | 'control'>('boards');
  const dragged = useRef<Card | null>(null);
  const { snapshot, conn } = useSnapshot(bump);

  // Copilot state lives here (not in the panel) so the transcript + socket survive
  // closing/reopening the dock. The server-side session persists regardless.
  const copilot = useCopilot();
  const [copilotMode, setCopilotMode] = useState<CopilotMode>('bypassPermissions');
  const [copilotModel, setCopilotModel] = useState('');
  const [copilotEffort, setCopilotEffort] = useState<'' | EffortLevel>('');

  // Theme: applied to <html data-theme>, persisted. Default cyberpunk.
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('vb-theme') || 'cyberpunk');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('vb-theme', theme);
  }, [theme]);

  // Collapsed boards, persisted.
  const [collapsed, setCollapsed] = useState<Set<BoardName>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('vb-collapsed') ?? '[]')); } catch { return new Set(); }
  });
  const toggleBoard = (b: BoardName): void => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(b)) next.delete(b); else next.add(b);
    localStorage.setItem('vb-collapsed', JSON.stringify([...next]));
    return next;
  });

  const onAdd = (board: BoardName, columnSlug: string): void => setEditor({ mode: 'create', board, columnSlug });
  const onOpen = (card: Card): void => setEditor({ mode: 'edit', card });
  const onDragStart = (card: Card): void => { dragged.current = card; };
  const onArchive = (card: Card): void => { void archiveCard(card.board, card.id); };
  // Switch the copilot backend: persist it, reset the (backend-specific) model, and start a
  // fresh chat so we don't try to resume a session under the other backend.
  const onBackend = (backend: string): void => {
    if (backend === (snapshot?.config.copilot.backend || 'claude-code')) return;
    setCopilotModel('');
    copilot.newSession();
    void patchConfig({ copilot: { backend, model: '' } });
  };
  const onDrop = (board: BoardName, columnSlug: string): void => {
    const card = dragged.current;
    dragged.current = null;
    if (!card || card.board !== board || card.columnSlug === columnSlug) return; // no cross-board / no-op
    void moveCard(card.board, card.id, columnSlug);
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">VibeBoard</span>
        {snapshot && !showGate && <span className="project-name">{snapshot.name}</span>}
        {snapshot && !showGate && (
          <div className="topbar-tabs" role="group" aria-label="View">
            <button className={`tab-btn${tab === 'boards' ? ' active' : ''}`} onClick={() => setTab('boards')}>Boards</button>
            <button className={`tab-btn${tab === 'control' ? ' active' : ''}`} onClick={() => setTab('control')}>Project Control</button>
          </div>
        )}
        <div className="topbar-right">
          <select className="theme-select" value={theme} title="Theme" onChange={(e) => setTheme(e.target.value)}>
            {THEMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {snapshot && !showGate && (
            <button className="switch-btn" title="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
          )}
          {snapshot && !showGate && (
            <button className="switch-btn" onClick={() => setShowGate(true)}>Switch project</button>
          )}
          {snapshot && !showGate && (
            <button className={`switch-btn${copilotOpen ? ' active' : ''}`} onClick={() => setCopilotOpen((v) => !v)}>
              {copilotOpen ? 'Hide copilot' : 'Copilot'}
            </button>
          )}
          <span className={`conn conn-${conn}`} title={`WebSocket ${conn}`} />
        </div>
      </header>

      {!ready ? (
        <div className="empty">Loading…</div>
      ) : showGate ? (
        <ProjectGate onOpened={onOpened} />
      ) : !snapshot ? (
        <div className="empty">{conn === 'open' ? 'No project open.' : 'Connecting…'}</div>
      ) : (
        <div className="work">
        {tab === 'boards' ? (
          <main className="boards">
            {BOARDS.map((board) => (
              <Board
                key={board}
                board={board}
                label={BOARD_LABELS[board]}
                cards={snapshot.boards[board] ?? []}
                config={snapshot.config}
                collapsed={collapsed.has(board)}
                onToggle={() => toggleBoard(board)}
                onAdd={onAdd}
                onOpen={onOpen}
                onArchive={onArchive}
                onDragStart={onDragStart}
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
            backend={snapshot.config.copilot.backend || 'claude-code'}
            mode={copilotMode}
            model={copilotModel}
            effort={copilotEffort}
            onMode={setCopilotMode}
            onModel={setCopilotModel}
            onEffort={setCopilotEffort}
            onBackend={onBackend}
            onClose={() => setCopilotOpen(false)}
          />
        )}
        </div>
      )}

      {settingsOpen && snapshot && (
        <SettingsModal config={snapshot.config} onClose={() => setSettingsOpen(false)} onSaved={() => setSettingsOpen(false)} />
      )}

      {editor && (
        <CardEditor
          editor={editor}
          allCards={snapshot ? BOARDS.flatMap((b) => snapshot.boards[b] ?? []) : []}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      )}
    </div>
  );
}
