import type { Meta, StoryObj } from '@storybook/react-vite';
import { STATE_NAMES } from '../design/state-tones';
import { StatusChip } from './StatusChip';

// FOUR STATE INDICATORS AS ONE, AND THE PIP IS ABSORBED. They agreed on the colour and on nothing else:
// three sizes, two shapes, and three different answers to "where does the explanation live". All four are
// clickable whatever the state — the owner's ruling — because a control that is only sometimes a control
// cannot be learned.
//
// ONE PIP SIZE WHERE THERE WERE THREE. `Dot` had a `7 | 8 | 12` union and exactly one consumer, which is
// this component, so it was a component that decided nothing.
const meta = { title: 'Molecules/StatusChip', component: StatusChip } satisfies Meta<typeof StatusChip>;
export default meta;

// EVERY STATE IN THE TABLE, which is what makes this the acceptance surface for the tone vocabulary: a
// state with no row would render with no tone at all, and here that is visible rather than latent.
export const EveryState: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.25rem', paddingBottom: '10rem' }}>
      {STATE_NAMES.map((state) => (
        <StatusChip
          key={state}
          state={state}
          word={state}
          advice={{ heading: state, detail: `What ${state} means, in the sentence the surface already had.` }}
        />
      ))}
    </div>
  ),
};

export const TheTwoEmphases: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: '1.25rem', paddingBottom: '10rem' }}>
      <StatusChip
        state="online"
        word="online"
        glow
        advice={{ heading: 'Online', detail: 'The halo is emphasis and not a tone.' }}
      />
      <StatusChip
        state="running"
        word="running"
        pulse
        advice={{ heading: 'Running', detail: 'The pip pulses while the loop runs.' }}
      />
    </div>
  ),
};
