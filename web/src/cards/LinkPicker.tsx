import { BOARD_LABELS, BOARDS, type Card } from '../shared';

// The link picker: cards grouped by board, boards with nothing to offer omitted.
export function LinkPicker({
  linkable,
  links,
  onToggle,
}: {
  linkable: Card[];
  links: string[];
  onToggle: (id: string) => void;
}) {
  if (linkable.length === 0) return <div className="links-hint">No other cards yet to link.</div>;
  return (
    <div className="links-list">
      {BOARDS.map((b) => {
        const group = linkable.filter((c) => c.board === b);
        if (group.length === 0) return null;
        return (
          <div key={b}>
            <div className="links-group">{BOARD_LABELS[b]}</div>
            {group.map((c) => (
              <label key={c.id} className="link-option">
                <input type="checkbox" checked={links.includes(c.id)} onChange={() => onToggle(c.id)} />
                <span className="link-id">{c.id}</span>
                <span className="link-title">{c.title}</span>
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}
