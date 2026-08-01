import type { FsNode } from '../api';
import { formatBytes } from '../explorer/format';
import type { TreeRow } from '../explorer/useTree';

interface Props {
  rows: TreeRow[];
  selected: string | null;
  busy: boolean;
  error: string | null;
  // A directory row expands; a file row opens. One handler, because one click on a row does the one
  // thing that row can do — a separate chevron button would be a second way to do the same thing.
  onActivate: (node: FsNode) => void;
  onRefresh: () => void;
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
  return node.path;
}

interface NodeRowProps {
  node: FsNode;
  depth: number;
  expanded: boolean;
  active: boolean;
  onActivate: (node: FsNode) => void;
}

// Its own component rather than a branch inside the map: the twisty, the tags and the size are four
// nested conditionals, and cognitive complexity is charged for nesting far more than for length.
function NodeRow({ node, depth, expanded, active, onActivate }: NodeRowProps) {
  const twist = expandable(node) ? (expanded ? '▾' : '▸') : '';
  return (
    <button
      className={`control-item explorer-item${active ? ' active' : ''}`}
      style={indent(depth)}
      title={title(node)}
      aria-expanded={expandable(node) ? expanded : undefined}
      onClick={() => onActivate(node)}
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
// are opened. Presentation only — expanding, selecting and refreshing are all callbacks.
export function FileTree({ rows, selected, busy, error, onActivate, onRefresh }: Props) {
  return (
    <nav className="control-list explorer-list">
      <div className="control-group-head explorer-head">
        <span>Files</span>
        <button className="control-new" title="Re-read the project from disk" onClick={onRefresh}>
          ⟳
        </button>
      </div>

      {error && <div className="control-error">{error}</div>}
      {rows.length === 0 && <div className="control-empty">{busy ? 'Reading…' : '— empty —'}</div>}

      {rows.map((row) =>
        row.kind === 'more' ? (
          <MoreRow key={`more:${row.parent}`} depth={row.depth} count={row.count} />
        ) : (
          <NodeRow
            key={row.node.path}
            node={row.node}
            depth={row.depth}
            expanded={row.expanded}
            active={selected === row.node.path}
            onActivate={onActivate}
          />
        ),
      )}
    </nav>
  );
}
