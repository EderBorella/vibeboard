import type { Meta, StoryObj } from '@storybook/react-vite';
import { Text } from '../../atoms/Text';

import { UtilityDock } from './UtilityDock';

// THE DOCK'S OWN FRAME: a tab strip, a body, and a collapse. Entirely prop-driven — the panes are handed in
// as `render()` closures by the shell — so no route stub, and it is the one organism whose whole subject is
// the three classes `dock.css` owns rather than anything it contains.
//
// A BADGE OF 0 IS NOT THE ABSENCE OF A BADGE, which is why two of the four panes below carry a count and
// one of those counts is zero: a pane can be worth showing with nothing counted, and `badge?: number`
// records that distinction. One pane with no badge cannot show it.

const pane = (id: string, label: string, badge?: number) => ({
  id,
  label,
  badge,
  render: () => <Text>The {label} pane goes here.</Text>,
});

const panes = [
  pane('cards', 'Cards', 3),
  pane('copilot', 'Copilot'),
  pane('runs', 'Runs', 0),
  pane('log', 'Log'),
];

const meta = {
  title: 'Organisms/Utility dock',
  component: UtilityDock,
  args: { panes, activeId: 'cards', onPane: () => {}, collapsed: false, onCollapse: () => {} },
} satisfies Meta<typeof UtilityDock>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// COLLAPSED, which is the state the tab strip has to stay legible in with no body under it.
export const Collapsed: Story = { args: { collapsed: true } };

// NOTHING SELECTED. `activeId` is nullable and the strip has to render with no tab lit, which is what the
// dock looks like for the first frame after a project opens.
export const NoneActive: Story = { args: { activeId: null } };
