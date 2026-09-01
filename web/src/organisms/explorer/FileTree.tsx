import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Text } from '../../atoms/Text';
import type { FsNode } from '../../lib/api';
import { List } from '../shared/List';
import { Row } from '../shared/Row';
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

// Two words at most, because it sits in a row beside a name and a size. The WHY is a sentence and lives
// on the node; this is only the flag that makes a reader look for it.
const SENSITIVE_LABEL: Record<NonNullable<FsNode['sensitive']>['kind'], string> = {
  'git-internal': 'git',
  'board-state': 'board state',
  'run-scratch': 'run files',
};

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
    <Row
      as="button"
      variant="flat"
      interactive
      active={active}
      gap={2}
      className={over ? 'explorer-over' : undefined}
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
      <Text className="explorer-twist vb-twist">{twist}</Text>
      {/* The ink is the ROW's and moves with its hover, which is what `inherit` says. */}
      <Text ink="inherit" className="vb-fixed">
        {icon(node)}
      </Text>
      <span className="vb-clip">{node.name}</span>
      {/* `.control-tag` IS GONE — the caps face and the ink are a nested `Text`'s. */}
      {node.symlink && (
        <Chip>
          <Text caps size="inherit" ink="accent2">
            link
          </Text>
        </Chip>
      )}
      {node.escapes && (
        <Chip>
          <Text caps size="inherit" ink="accent2">
            outside
          </Text>
        </Chip>
      )}
      {/* NOT the user's content: git internals, board state, or a run's scratch space. Marked rather
          than hidden or locked — the tab reaches everything on purpose, and fixing a corrupt config by
          hand is the reason it does. The sentence arrives with the node and is quoted at save time. */}
      {node.sensitive && (
        <Chip>
          {/* `accent2`, the same ink as the two chips above rather than a caution colour of its own.
              A marker is not a warning: the warning is the dialog at save time, and the atom has no
              `warn` ink — adding one for a chip nobody has to act on would be a design ruling for a
              label. What distinguishes it is the word. */}
          <Text caps size="inherit" ink="accent2">
            {SENSITIVE_LABEL[node.sensitive.kind]}
          </Text>
        </Chip>
      )}
      <Readout className="vb-fixed">{formatBytes(node.size)}</Readout>
    </Row>
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
      <Text role="hint" size="micro">
        … {count} more, not shown
      </Text>
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
    <List as="nav" className="explorer-list">
      <div
        // The header has no text at rest now, so nothing nameable is left to find it by. A testid
        // rather than `.explorer-head`: that class exists to make the head sticky, and a test holding
        // onto it would make the next sweep over the stylesheet a red suite.
        data-testid="explorer-head"
        className={`vb-row explorer-head${over === '' ? ' explorer-over' : ''}`}
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
        {/* NO RESTING TITLE. It said "Files" at the head of a list of files, above a tab already
            labelled Explorer — and it was the widest thing in the row, so swapping it for the drag
            message moved every button. The message stays, because the header IS the project root's
            drop target and there is no other cue that it is one.

            `push` keeps the actions against the right edge whether the message is there or not, so
            the row no longer moves when a drag starts. Without it, removing the title would only
            change WHEN the shift happens rather than remove it. */}
        {dragging && rootDroppable && <span>Drop here for the project root</span>}
        <Stack gap={1} className="explorer-actions push">
          <Button variant="bare" size="sm" title={`New file in ${where}`} onClick={() => props.onNew('file')}>
            {/* `.control-new` IS GONE: the accent ink is a nested `Text`'s at all four. */}
            <Text size="inherit" ink="accent">
              📄＋
            </Text>
          </Button>
          <Button
            variant="bare"
            size="sm"
            title={`New folder in ${where}`}
            onClick={() => props.onNew('dir')}
          >
            <Text size="inherit" ink="accent">
              📁＋
            </Text>
          </Button>
          <Button
            variant="bare"
            size="sm"
            title={selected ? `Delete ${selected.name}` : 'Select something to delete'}
            disabled={!selected}
            onClick={props.onDelete}
          >
            <Text size="inherit" ink="accent">
              ✕
            </Text>
          </Button>
          <Button variant="bare" size="sm" title="Re-read the project from disk" onClick={props.onRefresh}>
            <Text size="inherit" ink="accent">
              ⟳
            </Text>
          </Button>
        </Stack>
      </div>

      {error && <Text role="error">{error}</Text>}
      {rows.length === 0 && (
        <Stack pad={[0, 4]}>
          <Text role="hint">{busy ? 'Reading…' : '— empty —'}</Text>
        </Stack>
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
    </List>
  );
}
