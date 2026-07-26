import { BOARD_LABELS, BOARDS, type Card } from '../shared';
// Type-only, so no runtime cycle: CardEditor owns the field shape and mounts this pane.
import type { CardFields } from './CardEditor';

interface Props {
  fields: CardFields;
  onField: (patch: Partial<CardFields>) => void;
  linkable: Card[];
  links: string[];
  onToggleLink: (id: string) => void;
}

// The link picker: cards grouped by board, boards with nothing to offer omitted.
function LinkPicker({
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

// The editable frontmatter form. One patch callback rather than five setters, so adding a field
// costs one entry here and nothing in the modal shell.
export function CardForm({ fields, onField, linkable, links, onToggleLink }: Props) {
  return (
    <>
      <label className="field">
        <span>Title</span>
        <input value={fields.title} onChange={(e) => onField({ title: e.target.value })} autoFocus />
      </label>
      <label className="field">
        <span>Description</span>
        <input
          value={fields.description}
          onChange={(e) => onField({ description: e.target.value })}
          placeholder="Miniature summary"
        />
      </label>
      <label className="field">
        <span>Tags (comma-separated)</span>
        <input value={fields.tags} onChange={(e) => onField({ tags: e.target.value })} />
      </label>
      <label className="field">
        <span>Group</span>
        <input value={fields.group} onChange={(e) => onField({ group: e.target.value })} />
      </label>
      <div className="field">
        <span>Linked cards</span>
        <LinkPicker linkable={linkable} links={links} onToggle={onToggleLink} />
      </div>
      <label className="field">
        <span>Body (markdown)</span>
        <textarea rows={8} value={fields.body} onChange={(e) => onField({ body: e.target.value })} />
      </label>
    </>
  );
}
