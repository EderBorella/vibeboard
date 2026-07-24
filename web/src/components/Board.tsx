import type { BoardName, Card, ProjectConfig } from '../shared';
import { cardsByColumn, columnSlugs } from '../viewmodel';
import { Column } from './Column';

interface Props {
  board: BoardName;
  label: string;
  cards: Card[];
  config: ProjectConfig;
  collapsed?: boolean;
  onToggle?: () => void;
  onAdd?: (board: BoardName, slug: string) => void;
  onOpen?: (card: Card) => void;
  onArchive?: (card: Card) => void;
  onDragStart?: (card: Card) => void;
  onDrop?: (board: BoardName, slug: string) => void;
}

export function Board({ board, label, cards, config, collapsed, onToggle, onAdd, onOpen, onArchive, onDragStart, onDrop }: Props) {
  const slugs = columnSlugs(config, board);
  const grouped = cardsByColumn(cards, slugs);
  const displayNames = config.boards[board].columns;

  return (
    <section className="board">
      <button className="board-label" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="board-chevron">{collapsed ? '▸' : '▾'}</span>
        {label}
        <span className="board-count">{cards.length}</span>
      </button>
      {!collapsed && (
      <div className="board-columns">
        {slugs.map((slug, i) => (
          <Column
            key={slug}
            board={board}
            title={displayNames[i]}
            slug={slug}
            cards={grouped[slug]}
            miniatureChars={config.miniatureChars}
            onAdd={onAdd}
            onOpen={onOpen}
            onArchive={onArchive}
            onDragStart={onDragStart}
            onDrop={onDrop}
          />
        ))}
      </div>
      )}
    </section>
  );
}
