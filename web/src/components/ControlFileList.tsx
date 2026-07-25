import type { ControlCategory, ControlFile, ControlGroup } from '../api';

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
  groups, selected, renaming, renameDraft,
  onSelect, onNew, onStartRename, onRenameDraft, onCommitRename, onCancelRename,
}: Props) {
  return (
    <nav className="control-list">
      {groups.map((g) => (
        <div key={g.key} className="control-group">
          <div className="control-group-head">
            <span>{g.label}</span>
            {g.key !== 'instructions' && (
              <button
                className="control-new"
                title={`New ${g.label.toLowerCase().replace(/s$/, '')}`}
                onClick={() => onNew(g.key)}
              >
                ＋
              </button>
            )}
          </div>
          {g.key === 'resources' && (
            <button
              className={`control-item${selected === RESOURCES_SENTINEL ? ' active' : ''}`}
              onClick={() => onSelect(RESOURCES_SENTINEL)}
            >
              <span className="control-item-name">🔗 Links registry</span>
            </button>
          )}
          {g.files.length === 0 && g.key !== 'resources' && <div className="control-empty">— none —</div>}
          {g.files.map((f) => (
            renaming === f.path ? (
              <input
                key={f.path}
                className="control-rename"
                value={renameDraft}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onRenameDraft(e.target.value)}
                onBlur={onCommitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); onCommitRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
                }}
              />
            ) : (
              <button
                key={f.path}
                className={`control-item${selected === f.path ? ' active' : ''}`}
                title={`${f.path}${f.deletable ? ' · double-click to rename' : ''}`}
                onClick={() => onSelect(f.path)}
                onDoubleClick={() => onStartRename(f)}
              >
                <span className="control-item-name">{f.name}</span>
                {f.managed && <span className="control-tag">managed</span>}
              </button>
            )
          ))}
        </div>
      ))}
    </nav>
  );
}
