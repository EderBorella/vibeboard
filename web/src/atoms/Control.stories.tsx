import type { Meta, StoryObj } from '@storybook/react-vite';
import { Control } from './Control';

// ONE CONTROL WITH OPTIONS: `as` says which element it is and `mono` says the content is machine text.
// Nothing else, because nothing else is the atom's — a width, a `resize` and a floor are the surface's.
//
// THE THREE ELEMENTS DRAW ONE BOX, and the textarea is the only one that does NOT take `--ctl-h`: a card's
// whole file is not one line, so the height is withdrawn for `textarea` and the surface says how much room
// the box starts with. That exception is written into `npm run check:box-scale` by name.
const meta = {
  title: 'Atoms/Control',
  component: Control,
  args: { defaultValue: 'a rename' },
  argTypes: {
    as: { control: 'inline-radio', options: ['input', 'select', 'textarea'] },
    mono: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Control>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const EveryOption: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '28rem' }}>
      <Control defaultValue="a rename" />
      <Control mono defaultValue="vb-1042-tidy-the-dock" />
      <Control as="select" defaultValue="cyberpunk">
        <option value="cyberpunk">Cyberpunk</option>
        <option value="marshmallow">Marshmallow</option>
      </Control>
      <Control disabled defaultValue="not while it is running" />
      <Control as="textarea" rows={3} defaultValue={'a card body\nover two lines'} />
      <Control as="textarea" mono rows={3} defaultValue={'---\nid: vb-1042\n---'} />
    </div>
  ),
};

// A CHECKBOX IS NOT ONE OF THESE, and saying so here is the point: it paints no border, so it could use
// none of the box — and the descendant selector that used to hand it one had to cut it out of the focus
// rule with two `:not()`s. It falls through to the app's own focus ring instead.
export const NotAControl: Story = {
  render: () => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
      <input type="checkbox" defaultChecked />
      a decision, not a value
    </label>
  ),
};
