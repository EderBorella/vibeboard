import type { Meta, StoryObj } from '@storybook/react-vite';
import { Text } from './Text';

// ONE LINE OF SECONDARY TEXT WITH OPTIONS, against the six classes and 87 hand-applied `className`s it
// replaces. `role` × `caps` × `lead` is the whole of it, and every combination is drawn below — which is
// what says the six names were three decisions rather than six.
const meta = {
  title: 'Atoms/Text',
  component: Text,
  args: { children: 'Nothing ticked means every board.' },
  argTypes: {
    role: { control: 'inline-radio', options: ['label', 'hint', 'error'] },
    caps: { control: 'boolean' },
    lead: { control: 'boolean' },
  },
} satisfies Meta<typeof Text>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const EveryOption: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.5rem', justifyItems: 'start' }}>
      <Text>a field's name</Text>
      <Text caps>a section head</Text>
      <Text role="hint">a hint says how something works</Text>
      <Text role="hint" lead>
        an empty pane, which is the only thing on the surface
      </Text>
      <Text role="error">what was refused</Text>
      <Text role="error" lead>
        what was refused, where the refusal is the whole answer
      </Text>
    </div>
  ),
};

// THE PAIR THAT DIED. `.vb-empty-small` was `.vb-hint` declaration for declaration — `--t-small`, muted,
// italic — under a second name at six call sites, and no call site could tell them apart. Drawn together
// so the claim is checkable by eye rather than only in a diff.
export const TheDuplicate: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.25rem', justifyItems: 'start' }}>
      <Text role="hint">what `.vb-hint` drew</Text>
      <Text role="hint">what `.vb-empty-small` drew</Text>
    </div>
  ),
};
