import type { ControlCategory, ControlFile, ControlGroup } from '../api';
import { Button } from '../atoms/Button';
import { Chip } from '../atoms/Chip';
import { Control } from '../atoms/Control';
import { Text } from '../atoms/Text';
import { Row } from '../organisms/shared/Row';

// A selection that means "the links registry", not a path on disk. It travels through the same
// `selected` state as a real file path so the list has one notion of what is active.
export const RESOURCES_SENTINEL = '@resources';

interface Props {
  groups: ControlGroup[];
  // The active selection — a file path, RESOURCES_SENTINEL, or nothing selected yet.
  selected: string | null;
  // The path whose row is in rename mode, plus the in-progress text. Both live in the parent
  // because a create puts the brand-new row straight into rename mode.
  renaming: string | null;
  renameDraft: string;
  onSelect: (path: string) => void;
  onNew: (category: ControlCategory) => void;
  onStartRename: (f: ControlFile) => void;
  onRenameDraft: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}

// The left-hand file list: one section per category, a ＋ per creatable category, and the rows
// themselves — which swap to a text input while being renamed. Presentation only; every action
// is a callback, so the parent stays the single owner of selection and rename state.
export function ControlFileList({
  groups,
  selected,
  renaming,
  renameDraft,
  onSelect,
  onNew,
  onStartRename,
  onRenameDraft,
  onCommitRename,
  onCancelRename,
}: Props) {
  return (
    <nav className="vb-list control-list">
      {groups.map((g) => (
        <div key={g.key} className="control-group">
          {/* A `Row` and a `Text caps`, where `.control-group-head` was a flex row plus the caps face —
              and it was ALSO the Explorer's, which is the layer fault the gate now refuses. */}
          <Row>
            <Text caps>{g.label}</Text>
            {g.creatable && (
              <Button
                variant="bare"
                size="sm"
                className="control-new push"
                title={`New ${g.label.toLowerCase().replace(/s$/, '')}`}
                onClick={() => onNew(g.key)}
              >
                ＋
              </Button>
            )}
          </Row>
          {g.key === 'resources' && (
            <Row
              as="button"
              variant="flat"
              interactive
              active={selected === RESOURCES_SENTINEL}
              data-testid="control-item"
              onClick={() => onSelect(RESOURCES_SENTINEL)}
            >
              <span className="vb-clip">🔗 Links registry</span>
            </Row>
          )}
          {g.files.length === 0 && g.key !== 'resources' && (
            <Text role="hint" className="control-empty">
              — none —
            </Text>
          )}
          {g.files.map((f) =>
            renaming === f.path ? (
              <Control
                key={f.path}
                value={renameDraft}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onRenameDraft(e.target.value)}
                onBlur={onCommitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onCommitRename();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancelRename();
                  }
                }}
              />
            ) : (
              <Row
                as="button"
                variant="flat"
                interactive
                active={selected === f.path}
                key={f.path}
                data-testid="control-item"
                title={`${f.path}${f.deletable ? ' · double-click to rename' : ''}`}
                onClick={() => onSelect(f.path)}
                onDoubleClick={() => onStartRename(f)}
              >
                <span className="vb-clip">{f.name}</span>
                {f.managed && <Chip className="control-tag">managed</Chip>}
              </Row>
            ),
          )}
        </div>
      ))}
    </nav>
  );
}
