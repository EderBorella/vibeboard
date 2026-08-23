import type { Meta, StoryObj } from '@storybook/react-vite';
import { snapshot } from '../../../../.storybook/fixtures';
import type { BoardName } from '../../lib/shared';
import { BoardsView } from './BoardsView';

// THE THREE BOARDS. §820's first page, and the one the whole grid argument is about: the boards are stacked
// vertically and read as ONE table, so their column edges have to line up even though they have 4, 5 and 5
// columns. The track count is derived from the widest board in the CONFIG rather than from the rendered
// columns, which is why a collapsed board still contributes its width — the fixture gives the three
// different column counts on purpose, because with equal counts the story cannot tell the fix from the bug.
//
// ENTIRELY PROP-DRIVEN, so no route stub: this page takes its snapshot from the shell.

const meta = {
  title: 'Pages/Boards',
  component: BoardsView,
  parameters: { layout: 'fullscreen' },
  args: {
    snapshot,
    tags: [
      { tag: 'auth', count: 1 },
      { tag: 'perf', count: 1 },
      { tag: 'runs', count: 1 },
      { tag: 'cost', count: 1 },
    ],
    activeTags: [],
    collapsed: new Set<BoardName>(),
    onToggleBoard: () => {},
    onTag: () => {},
    onClearTags: () => {},
    onAdd: () => {},
    onOpen: () => {},
    onArchive: () => {},
    onDragStart: () => {},
    onDrop: () => {},
  },
} satisfies Meta<typeof BoardsView>;
export default meta;

type Story = StoryObj<typeof meta>;

// THE THREE WIDTHS THE PLAN ACCEPTS A PAGE AT. Real viewport widths and not a container: `board.css` carries
// `@container vbboards (max-width: 720px)` and `(min-width: 1160px)`, and `app-shell.css` a
// `@media (max-width: 1100px)`, so 900 is a different layout rather than a narrower one.
export const At900: Story = { globals: { viewport: { value: 'w900' } } };
export const At1200: Story = { globals: { viewport: { value: 'w1200' } } };
export const At1440: Story = { globals: { viewport: { value: 'w1440' } } };

// A FILTER THAT IS ON, because the chip's selected state and the "clear" affordance only exist in it, and
// filtering to a tag no card carries is how an empty column and a hidden column come to look the same.
export const Filtered: Story = {
  args: { activeTags: ['perf'] },
  globals: { viewport: { value: 'w1440' } },
};

// COLLAPSED, which is the state that has to keep its track width: a board contributing no rendered columns
// and still deciding the grid is the whole of the argument above.
export const Collapsed: Story = {
  args: { collapsed: new Set<BoardName>(['product', 'engineering']) },
  globals: { viewport: { value: 'w1440' } },
};
