import type { Meta, StoryObj } from '@storybook/react-vite';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { ProjectRef } from '../../lib/api';
import { ProjectGate } from './ProjectGate';

// OPEN A PROJECT VIBEBOARD ALREADY KNOWS, OR START ONE — and starting one is two doors into the wizard,
// where the form that used to stand here now lives. The list is VibeBoard's own record of projects and NOT
// a query for containers — a box removed by a prune must not make a project vanish from this screen.
// Hook-driven: `listProjects` reads `/api/projects` on mount.
//
// IT WEARS THE SAME `.gate` CLASSES AS `Pages/SignIn` ON PURPOSE, which is why both are stories: it is the
// same visual object standing in the same place, and a second look-alike would drift from it. `.gate` and
// `.gate-card` live in `templates/app-shell.css` and are specialised by each page inside the frame — two of
// the twenty-two splits the layer gate exempts, and the two easiest to see.

// ANNOTATED for the reason `Pages/Log` records: a `RouteTable` value is `object`, so an un-annotated
// literal handed to the stub is checked by nothing at all.
const projects: ProjectRef[] = [
  { path: '/work/demo', name: 'demo' },
  { path: '/work/vibeboard', name: 'vibeboard' },
  { path: '/work/a-project-with-a-deliberately-long-name', name: 'a-project-with-a-deliberately-long-name' },
];

const meta = {
  title: 'Pages/Gate',
  component: ProjectGate,
  parameters: { layout: 'fullscreen' },
  // A BARE ARRAY, because `listProjects` returns the body AS the list. `{ projects }` made every story
  // below render "no projects yet" over the three rows written above them — the empty state, under a
  // title that promises a list, in the workbench built to show the list.
  decorators: [withRoutes({ ...EMPTY, '/api/projects': projects })],
  args: { onOpened: () => {}, onNewProject: () => {}, onMapProject: () => {} },
} satisfies Meta<typeof ProjectGate>;
export default meta;

type Story = StoryObj<typeof meta>;

export const At900: Story = { globals: { viewport: { value: 'w900' } } };
export const At1200: Story = { globals: { viewport: { value: 'w1200' } } };
export const At1440: Story = { globals: { viewport: { value: 'w1440' } } };

// THE FIRST EVER LAUNCH, which is the only screen a new user sees and the one with no list to fall back on.
export const NoProjectsYet: Story = {
  decorators: [withRoutes(EMPTY)],
  globals: { viewport: { value: 'w1440' } },
};
