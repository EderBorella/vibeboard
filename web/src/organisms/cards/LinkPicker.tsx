import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Text } from '../../atoms/Text';
import { BOARD_LABELS, BOARDS, type Card } from '../../lib/shared';
import { Field } from '../../molecules/Field';
import { Row } from '../shared/Row';

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
    <Row stack variant="inset" gap={2} className="links-list">
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
                <Control type="checkbox" checked={links.includes(c.id)} onChange={() => onToggle(c.id)} />
              </Field>
            ))}
          </div>
        );
      })}
    </Row>
  );
}
