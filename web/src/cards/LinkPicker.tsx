import { BOARD_LABELS, BOARDS, type Card } from '../shared';
import { Field } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { Readout } from '../ui/Readout';

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
  if (linkable.length === 0) return <div className="vb-hint">No other cards yet to link.</div>;
  return (
    <Panel variant="inset" className="links-list">
      {BOARDS.map((b) => {
        const group = linkable.filter((c) => c.board === b);
        if (group.length === 0) return null;
        return (
          <div key={b}>
            <div className="links-group">{BOARD_LABELS[b]}</div>
            {group.map((c) => (
              <Field
                key={c.id}
                layout="check"
                label={
                  <>
                    <Readout size="small" tone="accent">
                      {c.id}
                    </Readout>
                    <span className="link-title">{c.title}</span>
                  </>
                }
              >
                <input type="checkbox" checked={links.includes(c.id)} onChange={() => onToggle(c.id)} />
              </Field>
            ))}
          </div>
        );
      })}
    </Panel>
  );
}
