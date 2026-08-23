import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ControlGroup } from '../../lib/api';
import { ControlFileList, RESOURCES_SENTINEL } from './ControlFileList';

// THE LEFT-HAND PANE OF `Pages/Control`: five groups, one per category, and what each row is allowed to do.
// Prop-driven, so no route stub.
//
// `managed`, `deletable`, `renameable` AND `creatable` ARE FOUR SEPARATE FACTS and the list renders each of
// them differently — a managed file offers no rename and no delete, and only a creatable group shows "＋".
// A fixture with one group and one file can distinguish none of them, which is why there are five here.
//
// THIS IS ALSO CARRY-FORWARD 0n's SURFACE. The `<nav>` used to be hand-written as
// `className="vb-list control-list"` with `.control-list` re-declaring three of `.vb-list`'s four
// declarations; it is now `<List as="nav" className="control-list">` and the three are gone.

const groups: ControlGroup[] = [
  {
    key: 'instructions',
    label: 'Instructions',
    creatable: false,
    files: [
      {
        path: '.vibeboard/AGENTS.md',
        name: 'AGENTS.md',
        category: 'instructions',
        managed: true,
        deletable: false,
        renameable: false,
      },
    ],
  },
  {
    key: 'foundation',
    label: 'Foundation',
    creatable: true,
    files: [
      {
        path: '.vibeboard/foundation/product.md',
        name: 'product.md',
        category: 'foundation',
        managed: false,
        deletable: true,
        renameable: true,
      },
      {
        path: '.vibeboard/foundation/architecture.md',
        name: 'architecture.md',
        category: 'foundation',
        managed: false,
        deletable: true,
        renameable: true,
      },
    ],
  },
  {
    key: 'skills',
    label: 'Skills',
    creatable: true,
    files: [
      {
        path: '.vibeboard/skills/implement.md',
        name: 'implement.md',
        category: 'skills',
        managed: false,
        deletable: true,
        renameable: true,
      },
    ],
  },
  // Empty on purpose: a creatable group with no files still has to say what it is and offer the ＋.
  { key: 'docs', label: 'Docs', creatable: true, files: [] },
  { key: 'resources', label: 'Resources', creatable: false, files: [] },
];

const meta = {
  title: 'Organisms/Control file list',
  component: ControlFileList,
  args: {
    groups,
    selected: '.vibeboard/foundation/product.md',
    renaming: null,
    renameDraft: '',
    onSelect: () => {},
    onNew: () => {},
    onStartRename: () => {},
    onRenameDraft: () => {},
    onCommitRename: () => {},
    onCancelRename: () => {},
  },
} satisfies Meta<typeof ControlFileList>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// A ROW IN RENAME MODE, which is where a freshly created file arrives — the inline field, not a browser
// prompt, because a prompt can be suppressed.
export const Renaming: Story = {
  args: {
    renaming: '.vibeboard/skills/implement.md',
    renameDraft: 'implement',
    selected: '.vibeboard/skills/implement.md',
  },
};

// RESOURCES IS A SELECTION AND NOT A FILE — it is a sentinel, and the row has to light like any other.
export const ResourcesSelected: Story = { args: { selected: RESOURCES_SENTINEL } };

// A PROJECT WITH NOTHING IN IT. Every group renders its own empty line rather than the pane rendering one.
export const Empty: Story = {
  args: { groups: groups.map((group) => ({ ...group, files: [] })), selected: null },
};
