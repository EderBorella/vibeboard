import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Tone } from '../molecules/state-tones';
import { Chip } from './Chip';

// ONE MARKER WITH OPTIONS. A chip is a box you READ — a tag, a count, a state word — and the whole of what
// it can be is `tone`/`state`, `pill`, `fill` and `as`.
//
// THE HEIGHT IS THE STORY. `--mark-h` is 16px and `line-height: 1` is what makes it true: the withdrawn
// `line-height: inherit` meant a chip's height was its CONTEXT's, so the same chip measured 25.25px in the
// Project Log's prose against 15px on the board. `InProse` below is that defect, reproduced beside the same
// chip outside prose — if the two ever disagree again, this is where it shows.
const meta = {
  title: 'Atoms/Chip',
  component: Chip,
  args: { children: 'tag' },
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'accent', 'ok', 'warn', 'bad'] },
    pill: { control: 'boolean' },
    fill: { control: 'boolean' },
    as: { control: 'inline-radio', options: ['span', 'button'] },
  },
} satisfies Meta<typeof Chip>;
export default meta;

type Story = StoryObj<typeof meta>;

const TONES: Tone[] = ['neutral', 'accent', 'ok', 'warn', 'bad'];

export const Playground: Story = {};

// THE FIVE TONES ON ONE LINE, square and pill, outline and fill. One story rather than twenty, because the
// question worth asking of a tone is whether it is distinguishable from the other four at 11px.
export const EveryOption: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      {[false, true].map((pill) => (
        <div key={String(pill)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <code style={{ minWidth: '5ch', opacity: 0.6 }}>{pill ? 'pill' : 'square'}</code>
          {TONES.map((tone) => (
            <Chip key={tone} tone={tone} pill={pill}>
              {tone}
            </Chip>
          ))}
          <Chip pill={pill} fill>
            7
          </Chip>
          <Chip pill={pill} as="button" tone="accent">
            clickable
          </Chip>
        </div>
      ))}
    </div>
  ),
};

// THE DEFECT `--mark-h` CLOSES, shown rather than described: the same chip inside a 1.5 line-height
// paragraph and outside one. Before the atom layer these were two different heights.
export const InProse: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <div>
        <Chip pill tone="neutral">
          outside prose
        </Chip>
      </div>
      <p style={{ lineHeight: 1.5, margin: 0, fontSize: '0.8125rem' }}>
        A filed finding names its run in the middle of a sentence, like{' '}
        <Chip pill tone="neutral">
          in prose
        </Chip>{' '}
        — and it is the same 16px box.
      </p>
    </div>
  ),
};
