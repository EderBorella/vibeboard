import { useState } from 'react';
import type { FsNode } from '../api';
import { Button } from '../atoms/Button';
import { Chip } from '../atoms/Chip';
import { Control } from '../atoms/Control';
import { Readout } from '../atoms/Readout';
import { Surface } from '../atoms/Surface';
import { Text } from '../atoms/Text';
import { formatBytes } from './format';
import { canDropInto } from './paths';
import type { TreeRow } from './useTree';

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
  // Drag to move. The node being dragged lives in the parent, because the drop handler needs it and
  // the row that started the drag is not the row that ends it.
  dragging: FsNode | null;
  onDragStart: (node: FsNode | null) => void;
  onDropInto: (dir: string) => void;
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
  // A folder that the current drag could legitimately land in, and whether the pointer is over it.
  droppable: boolean;
  over: boolean;
  onActivate: (node: FsNode) => void;
  onStartRename: (node: FsNode) => void;
  onDragStart: (node: FsNode | null) => void;
  onOver: (path: string | null) => void;
  onDropInto: (dir: string) => void;
}

// Its own component rather than a branch inside the map: the twisty, the tags and the size are four
// nested conditionals, and cognitive complexity is charged for nesting far more than for length.
function NodeRow(props: NodeRowProps) {
  const { node, depth, expanded, active, droppable, over } = props;
  const twist = expandable(node) ? (expanded ? '▾' : '▸') : '';
  return (
    <Surface
      as="button"
      variant="flat"
      className={`control-item explorer-item${active ? ' active' : ''}${over ? ' explorer-over' : ''}`}
      data-testid="explorer-item"
      style={indent(depth)}
      title={title(node)}
      aria-expanded={expandable(node) ? expanded : undefined}
      draggable
      onClick={() => props.onActivate(node)}
      onDoubleClick={() => props.onStartRename(node)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', node.path); // Firefox starts no drag without this
        e.dataTransfer.effectAllowed = 'move';
        props.onDragStart(node);
      }}
      onDragEnd={() => props.onDragStart(null)}
      onDragOver={
        droppable
          ? (e) => {
              e.preventDefault(); // without this the drop never fires
              e.dataTransfer.dropEffect = 'move';
              props.onOver(node.path);
            }
          : undefined
      }
      onDragLeave={droppable ? () => props.onOver(null) : undefined}
      onDrop={
        droppable
          ? (e) => {
              e.preventDefault();
              props.onOver(null);
              props.onDropInto(node.path);
            }
          : undefined
      }
    >
      <span className="explorer-twist vb-twist">{twist}</span>
      <span className="explorer-icon">{icon(node)}</span>
      <span className="control-item-name">{node.name}</span>
      {node.symlink && <Chip className="control-tag">link</Chip>}
      {node.escapes && <Chip className="control-tag">outside</Chip>}
      <Readout>{formatBytes(node.size)}</Readout>
    </Surface>
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
    <Control
      
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
    // The indent is a layout and stays on the row that carries it; the face is the atom's. A `style`
    // prop on `Text` would be the hole every other atom refuses — it is where a padding comes back.
    <div className="explorer-more" style={indent(depth)}>
      <Text role="hint">… {count} more, not shown</Text>
    </div>
  );
}

// The left-hand tree: the project as it is on disk, one row per entry, lazily filled in as folders
// are opened. Presentation only — every action is a callback.
export function FileTree(props: Props) {
  const { rows, selected, busy, error, newIn, renaming, renameDraft, dragging } = props;
  const where = newIn === '' ? 'the project root' : newIn;
  // Which row the pointer is over during a drag. Local, because it is nothing but a highlight.
  const [over, setOver] = useState<string | null>(null);
  // The header doubles as the project root's drop target: there is no row for the root, so without it
  // a file dragged into a folder could never come back out.
  const rootDroppable = canDropInto(dragging, '');
  return (
    <nav className="control-list explorer-list">
      <div
        className={`control-group-head explorer-head${over === '' ? ' explorer-over' : ''}`}
        onDragOver={
          rootDroppable
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver('');
              }
            : undefined
        }
        onDragLeave={rootDroppable ? () => setOver(null) : undefined}
        onDrop={
          rootDroppable
            ? (e) => {
                e.preventDefault();
                setOver(null);
                props.onDropInto('');
              }
            : undefined
        }
      >
        <span>{dragging && rootDroppable ? 'Drop here for the project root' : 'Files'}</span>
        <div className="explorer-actions">
          <Button
            variant="bare"
            size="sm"
            className="control-new"
            title={`New file in ${where}`}
            onClick={() => props.onNew('file')}
          >
            📄＋
          </Button>
          <Button
            variant="bare"
            size="sm"
            className="control-new"
            title={`New folder in ${where}`}
            onClick={() => props.onNew('dir')}
          >
            📁＋
          </Button>
          <Button
            variant="bare"
            size="sm"
            className="control-new"
            title={selected ? `Delete ${selected.name}` : 'Select something to delete'}
            disabled={!selected}
            onClick={props.onDelete}
          >
            ✕
          </Button>
          <Button
            variant="bare"
            size="sm"
            className="control-new"
            title="Re-read the project from disk"
            onClick={props.onRefresh}
          >
            ⟳
          </Button>
        </div>
      </div>

      {error && <Text role="error">{error}</Text>}
      {rows.length === 0 && (
        <Text role="hint" className="control-empty">{busy ? 'Reading…' : '— empty —'}</Text>
      )}

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
            droppable={expandable(row.node) && canDropInto(dragging, row.node.path)}
            over={over === row.node.path}
            onActivate={props.onActivate}
            onStartRename={props.onStartRename}
            onDragStart={props.onDragStart}
            onOver={setOver}
            onDropInto={props.onDropInto}
          />
        );
      })}
    </nav>
  );
}
