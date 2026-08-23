import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FsNode } from '../../lib/api';
import { FileTree } from './FileTree';
import type { TreeRow } from './useTree';

// THE PROJECT AS A FLAT LIST OF ROWS WITH DEPTHS, which is what a tree actually is once `flatten()` has run.
// Entirely prop-driven — the expansion state and the listings are `useTree`'s — so no route stub.
//
// ONE ROW OF EVERY KIND, because the kinds are the whole behaviour: a directory (expanded and collapsed), a
// file with a size, a symlink, a symlink that ESCAPES the project — shown so it can be removed and never
// opened — and the `more` row that stands for a listing the server capped. That last one is rendered rather
// than dropped precisely so a truncated listing never reads as a complete one, and a fixture without it
// cannot tell those two apart.

const node = (path: string, kind: FsNode['kind'], over: Partial<FsNode> = {}): FsNode => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  kind,
  ...over,
});

const rows: TreeRow[] = [
  { kind: 'node', node: node('.vibeboard', 'dir'), depth: 0, expanded: true },
  { kind: 'node', node: node('.vibeboard/engineering', 'dir'), depth: 1, expanded: false },
  { kind: 'node', node: node('.vibeboard/AGENTS.md', 'file', { size: 2_140 }), depth: 1, expanded: false },
  { kind: 'more', parent: '.vibeboard', depth: 1, count: 12 },
  { kind: 'node', node: node('src', 'dir'), depth: 0, expanded: false },
  { kind: 'node', node: node('README.md', 'file', { size: 4_182 }), depth: 0, expanded: false },
  {
    kind: 'node',
    node: node('notes', 'file', { size: 71, symlink: true, target: '../shared/notes' }),
    depth: 0,
    expanded: false,
  },
  {
    kind: 'node',
    node: node('outside', 'file', { size: 12, symlink: true, target: '/etc', escapes: true }),
    depth: 0,
    expanded: false,
  },
];

const meta = {
  title: 'Organisms/File tree',
  component: FileTree,
  args: {
    rows,
    selected: rows[2].kind === 'node' ? rows[2].node : null,
    busy: false,
    error: null,
    newIn: '.vibeboard',
    renaming: null,
    renameDraft: '',
    onActivate: () => {},
    onRefresh: () => {},
    onNew: () => {},
    onDelete: () => {},
    dragging: null,
    onDragStart: () => {},
    onDropInto: () => {},
    onStartRename: () => {},
    onRenameDraft: () => {},
    onCommitRename: () => {},
    onCancelRename: () => {},
  },
} satisfies Meta<typeof FileTree>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// A ROW IN RENAME MODE, which is where a freshly created row arrives.
export const Renaming: Story = {
  args: { renaming: 'README.md', renameDraft: 'README' },
};

// A FAILED READ, which is a different picture from an empty project: the tree keeps whatever it had and says
// what went wrong, rather than emptying itself and implying the folder is gone.
export const Failed: Story = { args: { error: 'Failed to read that folder' } };

// AN EMPTY ROOT, and nothing selected — a project scaffolded a second ago.
export const Empty: Story = { args: { rows: [], selected: null, newIn: '' } };
