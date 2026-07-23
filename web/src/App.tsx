import { useState } from 'react';
import { useSnapshot } from './useSnapshot';
import { Board } from './components/Board';

export function App() {
  const [bump] = useState(0);
  const { snapshot, conn } = useSnapshot(bump);

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">VibeBoard</span>
        {snapshot && <span className="project-name">{snapshot.name}</span>}
        <span className={`conn conn-${conn}`} title={`WebSocket ${conn}`} />
      </header>

      {!snapshot ? (
        <div className="empty">
          {conn === 'open' ? 'No project open.' : 'Connecting…'}
        </div>
      ) : (
        <main className="boards">
          <Board board="product" label="Product" cards={snapshot.boards.product} config={snapshot.config} />
          <Board board="engineering" label="Engineering" cards={snapshot.boards.engineering} config={snapshot.config} />
        </main>
      )}
    </div>
  );
}
