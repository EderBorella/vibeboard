import type { Meta, StoryObj } from '@storybook/react-vite';
import { snapshot } from '../../../../.storybook/fixtures';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { FsNode } from '../../lib/api';
import { ExplorerView } from './ExplorerView';

// THE WHOLE PROJECT AS A TREE, with a text editor beside it. Hook-driven — `useTree` reads
// `/api/explorer/tree`, `useOpenFile` reads `/api/explorer/file`, and expanding a folder reads
// `/api/explorer/list` — so it exists only through the route stub.
//
// ONE OF EACH KIND OF ROW, because the kinds are what the tree has to say something different about: a
// directory, a file with a size, a symlink, and a symlink that ESCAPES the project. The last is shown so it
// can be removed and is never opened, which is a rule no fixture of ordinary files can exercise.

// ANNOTATED for the reason `Pages/Log` records: a `RouteTable` value is `object`, so an un-annotated
// literal handed to the stub is checked by nothing at all.
const entries: FsNode[] = [
  { path: '.vibeboard', name: '.vibeboard', kind: 'dir' },
  { path: 'src', name: 'src', kind: 'dir' },
  { path: 'README.md', name: 'README.md', kind: 'file', size: 4_182 },
  { path: 'package.json', name: 'package.json', kind: 'file', size: 1_044 },
  { path: 'notes', name: 'notes', kind: 'file', size: 71, symlink: true, target: '../shared/notes' },
  { path: 'outside', name: 'outside', kind: 'file', size: 12, symlink: true, target: '/etc', escapes: true },
];

const meta = {
  title: 'Pages/Explorer',
  component: ExplorerView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withRoutes({
      ...EMPTY,
      '/api/explorer/tree': { entries },
      '/api/explorer/list': { path: '', parent: null, entries },
      '/api/explorer/file': {
        path: 'README.md',
        kind: 'text',
        size: 4_182,
        content: '# demo\n\nA project VibeBoard opened.\n',
      },
    }),
  ],
  args: { snapshot },
} satisfies Meta<typeof ExplorerView>;
export default meta;

type Story = StoryObj<typeof meta>;

export const At900: Story = { globals: { viewport: { value: 'w900' } } };
export const At1200: Story = { globals: { viewport: { value: 'w1200' } } };
export const At1440: Story = { globals: { viewport: { value: 'w1440' } } };

// AN EMPTY ROOT, which is what a project scaffolded a second ago looks like — and the state in which the
// tree's own empty line, rather than the editor's, has to say what to do.
export const Empty: Story = {
  decorators: [withRoutes(EMPTY)],
  globals: { viewport: { value: 'w1440' } },
};
