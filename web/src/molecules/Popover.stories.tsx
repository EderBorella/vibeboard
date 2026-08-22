import type { Meta, StoryObj } from '@storybook/react-vite';
import { Popover } from './Popover';

// THE SHELL ONLY: opening, dismissing, anchoring and the accessibility wiring. What goes inside is the
// caller's, because the useful thing to share is the BEHAVIOUR — every popover gets Escape and
// click-outside wrong in the same three ways, and none of them share a layout. Five consumers.
const meta = { title: 'Molecules/Popover', component: Popover } satisfies Meta<typeof Popover>;
export default meta;

export const Playground: StoryObj = {
  render: () => (
    <div style={{ padding: '1rem 1rem 12rem' }}>
      <Popover label="What this explains" trigger="? How it works" triggerTitle="Open the explanation">
        <p style={{ margin: 0 }}>
          Escape closes it, and so does a click outside — in the CAPTURE phase, so a selection that
          overshoots the panel cannot close the thing being read from.
        </p>
      </Popover>
    </div>
  ),
};
