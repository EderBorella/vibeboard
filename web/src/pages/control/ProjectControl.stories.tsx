import type { Meta, StoryObj } from '@storybook/react-vite';
import { snapshot } from '../../../../.storybook/fixtures';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { ControlGroup } from '../../lib/api';
import { ProjectControl } from './ProjectControl';

// THE FILES A PERSON EDITS, in two panes: the list on the left and the editor on the right. Hook-driven —
// `listControlFiles` reads `/api/control/files`, `useSkills` reads `/api/skills`, and opening a row fetches
// `/api/control/file?path=…` — so it exists only through the route stub.
//
// FIVE GROUPS, ONE PER CATEGORY, because `creatable` and `managed` are per-row facts that decide what the
// list offers: a managed file has no rename and no delete, and only a creatable group shows "+ new". A
// fixture with one group cannot tell those apart. The empty story below is not decoration either — carry-
// forward 0j records that `.control-editor-head` had never been opened by any browser check, because
// `selected` starts at `null`, so the blank pane is the state everything has always been measured in.

// ANNOTATED for the reason `Pages/Log` records: a `RouteTable` value is `object`, so an un-annotated
// literal handed to the stub is checked by nothing at all.
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
      {
        path: '.vibeboard/skills/checkup.md',
        name: 'checkup.md',
        category: 'skills',
        managed: false,
        deletable: true,
        renameable: true,
      },
    ],
  },
  {
    key: 'docs',
    label: 'Docs',
    creatable: true,
    files: [
      {
        path: '.vibeboard/docs/design-notes.md',
        name: 'design-notes.md',
        category: 'docs',
        managed: false,
        deletable: true,
        renameable: true,
      },
    ],
  },
  { key: 'resources', label: 'Resources', creatable: false, files: [] },
];

const file = {
  path: '.vibeboard/foundation/product.md',
  content:
    '# Product\n\nWhat this is for, and who it is for.\n\n- One board per concern.\n- Cards are files.\n',
};

const meta = {
  title: 'Pages/Control',
  component: ProjectControl,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withRoutes({
      ...EMPTY,
      '/api/control/files': { groups },
      '/api/control/file': file,
      '/api/control/resources': {
        resources: [{ title: 'The lifecycle spec', url: 'https://example.invalid/spec', note: 'part one' }],
      },
    }),
  ],
  args: { snapshot },
} satisfies Meta<typeof ProjectControl>;
export default meta;

type Story = StoryObj<typeof meta>;

export const At900: Story = { globals: { viewport: { value: 'w900' } } };
export const At1200: Story = { globals: { viewport: { value: 'w1200' } } };
export const At1440: Story = { globals: { viewport: { value: 'w1440' } } };

// NO FILES AT ALL, which is a project scaffolded and not yet written in. Every group renders its own empty
// line rather than the page rendering one for all five.
export const Empty: Story = {
  decorators: [withRoutes(EMPTY)],
  globals: { viewport: { value: 'w1440' } },
};
