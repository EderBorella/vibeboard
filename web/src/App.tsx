import { useEffect, useState } from 'react';
import type { BoardName, Card } from './shared';
import { useSnapshot } from './useSnapshot';
import { getState } from './api';
import { Board } from './components/Board';
import { ProjectGate } from './components/ProjectGate';
import { CardEditor, type EditorState } from './components/CardEditor';

export function App() {
  const [bump, setBump] = useState(0);
  const [showGate, setShowGate] = useState(false);
  const [ready, setReady] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const { snapshot, conn } = useSnapshot(bump);

  const onAdd = (board: BoardName, columnSlug: string): void => setEditor({ mode: 'create', board, columnSlug });
  const onOpen = (card: Card): void => setEditor({ mode: 'edit', card });

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
          <button className="switch-btn" onClick={() => setShowGate(true)}>Switch project</button>
        )}
        <span className={`conn conn-${conn}`} title={`WebSocket ${conn}`} />
      </header>

      {!ready ? (
        <div className="empty">Loading…</div>
      ) : showGate ? (
        <ProjectGate onOpened={onOpened} />
      ) : !snapshot ? (
        <div className="empty">{conn === 'open' ? 'No project open.' : 'Connecting…'}</div>
      ) : (
        <main className="boards">
          <Board board="product" label="Product" cards={snapshot.boards.product} config={snapshot.config} onAdd={onAdd} onOpen={onOpen} />
          <Board board="engineering" label="Engineering" cards={snapshot.boards.engineering} config={snapshot.config} onAdd={onAdd} onOpen={onOpen} />
        </main>
      )}

      {editor && (
        <CardEditor editor={editor} onClose={() => setEditor(null)} onSaved={() => setEditor(null)} />
      )}
    </div>
  );
}
