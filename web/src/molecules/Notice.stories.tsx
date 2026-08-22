import type { Meta, StoryObj } from '@storybook/react-vite';
import { Notice } from './Notice';

// THREE TONES AND THE INK IS PART OF THE TONE. Five surface classes drew this box; twelve call sites then
// wrote the class PAIR out by hand, which is what this component ends.
const meta = {
  title: 'Molecules/Notice',
  component: Notice,
  argTypes: { tone: { control: 'inline-radio', options: ['bad', 'warn', 'ok'] } },
  args: { tone: 'warn', children: 'Agents are disabled. Docker is not ready.' },
} satisfies Meta<typeof Notice>;
export default meta;

export const Playground: StoryObj<typeof meta> = {};

export const EveryOption: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '46rem' }}>
      <Notice tone="bad">
        <strong>Refused.</strong> A refusal IS the answer to what you just did, which is why this one is
        danger ink and the other two are prose.
      </Notice>
      <Notice tone="warn">
        <strong>Agents are disabled.</strong> The board, the explorer and these settings work normally.
      </Notice>
      <Notice tone="ok">
        <strong>Every agent runs in a container.</strong> It can build your project and cannot write{' '}
        <code>config.yaml</code>.
      </Notice>
      {/* Two stacked notices need separating, which `.sandbox-state + .sandbox-state` already said. */}
      <div>
        <Notice tone="warn">The first of two.</Notice>
        <Notice tone="warn">The second, which must not touch it.</Notice>
      </div>
    </div>
  ),
};
