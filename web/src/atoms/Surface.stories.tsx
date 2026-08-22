import type { Meta, StoryObj } from '@storybook/react-vite';
import { Surface } from './Surface';

// ONE CONTAINER WITH OPTIONS, and its variant axis is exactly one question wide: is the box DRAWN?
// `raised` for a surface above the wash, `inset` for a box inside one, `flat` for a row whose edge appears
// only when the surface lights it. It was called `Panel`, which meant six things in this tree.
//
// NO HEIGHT, deliberately: the two height tokens are for a box you operate and a box you read, and a
// container's height is its content's.
const meta = {
  title: 'Atoms/Surface',
  component: Surface,
  args: { children: 'a region of the page' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['flat', 'inset', 'raised'] },
    as: { control: 'inline-radio', options: ['div', 'section', 'button'] },
  },
} satisfies Meta<typeof Surface>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const EveryVariant: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '32rem' }}>
      <Surface variant="raised" header={<strong>Ready</strong>}>
        <div style={{ padding: '0.75rem' }}>
          <Surface variant="inset">a card inside the column</Surface>
          <Surface variant="flat">a list row, whose edge appears on hover</Surface>
          <Surface variant="flat" as="button">
            the same row, taking a click — a region of the page has no VOICE
          </Surface>
        </div>
      </Surface>
    </div>
  ),
};

// THE TRANSPARENT BORDER ON `flat` IS THE SAME ARGUMENT THE DASHED GHOST RESTS ON: a box that gains an edge
// on hover must already occupy those 2px, or every row in the list shifts under the pointer.
export const FlatDoesNotShift: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.25rem', maxWidth: '24rem' }}>
      <Surface variant="flat">hover me</Surface>
      <Surface variant="inset">and me</Surface>
      <Surface variant="flat">and me</Surface>
    </div>
  ),
};
