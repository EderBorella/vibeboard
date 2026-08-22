import { Readout } from '../atoms/Readout';
import { Surface } from '../atoms/Surface';
import { Text } from '../atoms/Text';
import { Field } from '../molecules/Field';
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
  if (linkable.length === 0) return <Text role="hint">No other cards yet to link.</Text>;
  return (
    <Surface variant="inset" className="links-list">
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
                    <Readout>{c.id}</Readout>
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
    </Surface>
  );
}
