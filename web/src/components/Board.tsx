import type { BoardName, Card, ProjectConfig } from '../shared';
import { cardsByColumn, columnSlugs } from '../viewmodel';
import { Column } from './Column';

interface Props {
  board: BoardName;
  label: string;
  cards: Card[];
  config: ProjectConfig;
  onAdd?: (board: BoardName, slug: string) => void;
  onOpen?: (card: Card) => void;
  onArchive?: (card: Card) => void;
  onDragStart?: (card: Card) => void;
  onDrop?: (board: BoardName, slug: string) => void;
}

export function Board({ board, label, cards, config, onAdd, onOpen, onArchive, onDragStart, onDrop }: Props) {
  const slugs = columnSlugs(config, board);
  const grouped = cardsByColumn(cards, slugs);
  const displayNames = config.boards[board].columns;

  return (
    <section className="board">
      <h2 className="board-label">{label}</h2>
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
    </section>
  );
}
