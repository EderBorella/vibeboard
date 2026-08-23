import { Readout } from '../../atoms/Readout';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import { BOARD_LABELS, BOARDS, type Card } from '../../lib/shared';
import { Field } from '../../molecules/Field';

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
    <Surface variant="inset" className="vb-list links-list">
      {BOARDS.map((b) => {
        const group = linkable.filter((c) => c.board === b);
        if (group.length === 0) return null;
        return (
          <div key={b}>
            <Text caps size="micro" className="links-group">
              {BOARD_LABELS[b]}
            </Text>
            {group.map((c) => (
              <Field
                key={c.id}
                layout="check"
                label={
                  <>
                    <Readout>{c.id}</Readout>
                    <span className="vb-clip">{c.title}</span>
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
