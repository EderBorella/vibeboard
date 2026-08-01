import type { FsNode } from '../api';
import { formatBytes } from '../explorer/format';
import type { TreeRow } from '../explorer/useTree';

interface Props {
  rows: TreeRow[];
  // The whole node, not just its path: the delete button names what it will delete.
  selected: FsNode | null;
  busy: boolean;
  error: string | null;
  // Where a new file or folder would land. '' is the project root; shown in the buttons' titles, so
  // the user never has to guess which folder a ＋ means.
  newIn: string;
  // The row currently being renamed, and the text in it. Both live in the parent because a freshly
  // created row arrives already in rename mode.
  renaming: string | null;
  renameDraft: string;
  // A directory row expands; a file row opens. One handler, because one click on a row does the one
  // thing that row can do — a separate chevron button would be a second way to do the same thing.
  onActivate: (node: FsNode) => void;
  onRefresh: () => void;
  onNew: (kind: 'file' | 'dir') => void;
  onDelete: () => void;
  onStartRename: (node: FsNode) => void;
  onRenameDraft: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}

// Row indentation, in the style rather than in nested elements, so every row is a sibling and the
// keyboard order matches what the eye sees.
const INDENT = 13;
const indent = (depth: number): { paddingLeft: number } => ({ paddingLeft: 8 + depth * INDENT });

// A link out of the project is listed so it can be removed, and never opened — see fs-sandbox.ts.
const expandable = (node: FsNode): boolean => node.kind === 'dir' && !node.escapes;

function icon(node: FsNode): string {
  if (node.escapes) return '⤴';
  if (node.kind === 'dir') return '📁';
  if (node.kind === 'other') return '？';
  return '📄';
}

function title(node: FsNode): string {
  if (node.escapes) return `${node.path} → ${node.target ?? '?'} (outside the project)`;
  if (node.symlink) return `${node.path} → ${node.target ?? '?'}`;
  return `${node.path} · double-click to rename`;
}

interface NodeRowProps {
  node: FsNode;
  depth: number;
  expanded: boolean;
  active: boolean;
  onActivate: (node: FsNode) => void;
  onStartRename: (node: FsNode) => void;
}

// Its own component rather than a branch inside the map: the twisty, the tags and the size are four
// nested conditionals, and cognitive complexity is charged for nesting far more than for length.
function NodeRow({ node, depth, expanded, active, onActivate, onStartRename }: NodeRowProps) {
  const twist = expandable(node) ? (expanded ? '▾' : '▸') : '';
  return (
    <button
      className={`control-item explorer-item${active ? ' active' : ''}`}
      style={indent(depth)}
      title={title(node)}
      aria-expanded={expandable(node) ? expanded : undefined}
      onClick={() => onActivate(node)}
      onDoubleClick={() => onStartRename(node)}
    >
      <span className="explorer-twist">{twist}</span>
      <span className="explorer-icon">{icon(node)}</span>
      <span className="control-item-name">{node.name}</span>
      {node.symlink && <span className="control-tag">link</span>}
      {node.escapes && <span className="control-tag">outside</span>}
      <span className="explorer-size">{formatBytes(node.size)}</span>
    </button>
  );
}

interface RenameRowProps {
  depth: number;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

// Sits exactly where the row was, so the row appears to become editable. The name is literal here —
// what is typed is what lands on disk — so the whole value is selected rather than a stem of it.
function RenameRow({ depth, value, onChange, onCommit, onCancel }: RenameRowProps) {
  return (
    <input
      className="control-rename"
      style={indent(depth)}
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

// The tail of a listing the server capped. Rendered rather than dropped: a truncated folder that
// looked complete would be a lie about what is in it.
function MoreRow({ depth, count }: { depth: number; count: number }) {
  return (
    <div className="explorer-more" style={indent(depth)}>
      … {count} more, not shown
    </div>
  );
}

// The left-hand tree: the project as it is on disk, one row per entry, lazily filled in as folders
// are opened. Presentation only — every action is a callback.
export function FileTree(props: Props) {
  const { rows, selected, busy, error, newIn, renaming, renameDraft } = props;
  const where = newIn === '' ? 'the project root' : newIn;
  return (
    <nav className="control-list explorer-list">
      <div className="control-group-head explorer-head">
        <span>Files</span>
        <div className="explorer-actions">
          <button className="control-new" title={`New file in ${where}`} onClick={() => props.onNew('file')}>
            📄＋
          </button>
          <button className="control-new" title={`New folder in ${where}`} onClick={() => props.onNew('dir')}>
            📁＋
          </button>
          <button
            className="control-new"
            title={selected ? `Delete ${selected.name}` : 'Select something to delete'}
            disabled={!selected}
            onClick={props.onDelete}
          >
            ✕
          </button>
          <button className="control-new" title="Re-read the project from disk" onClick={props.onRefresh}>
            ⟳
          </button>
        </div>
      </div>

      {error && <div className="control-error">{error}</div>}
      {rows.length === 0 && <div className="control-empty">{busy ? 'Reading…' : '— empty —'}</div>}

      {rows.map((row) => {
        if (row.kind === 'more') {
          return <MoreRow key={`more:${row.parent}`} depth={row.depth} count={row.count} />;
        }
        if (renaming === row.node.path) {
          return (
            <RenameRow
              key={row.node.path}
              depth={row.depth}
              value={renameDraft}
              onChange={props.onRenameDraft}
              onCommit={props.onCommitRename}
              onCancel={props.onCancelRename}
            />
          );
        }
        return (
          <NodeRow
            key={row.node.path}
            node={row.node}
            depth={row.depth}
            expanded={row.expanded}
            active={selected?.path === row.node.path}
            onActivate={props.onActivate}
            onStartRename={props.onStartRename}
          />
        );
      })}
    </nav>
  );
}
