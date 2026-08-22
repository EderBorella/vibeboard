import type { Meta, StoryObj } from '@storybook/react-vite';
import { FigureRow } from '../molecules/FigureRow';
import { Readout } from './Readout';

// NO OPTIONS AT ALL, AND THAT IS THE STORY. A readout is a TREATMENT — mono, tabular numerals, one
// tracking exception — and nine classes (four sizes, four tones, `quiet`) became one because a figure sits
// inside an atom that has already declared its step and its ink. `InContext` below is the argument: the
// same component in four surroundings, taking four sizes and four inks without being told any of them.
const meta = {
  title: 'Atoms/Readout',
  component: Readout,
  args: { children: '1 234 ms' },
} satisfies Meta<typeof Readout>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// THE CLAIM IS TABULAR NUMERALS, not the font name: one advance per digit, so a column lines up on the
// digit. Two rows of different digits, stacked, is the only way to see it.
export const TheColumn: Story = {
  render: () => (
    <div style={{ display: 'grid', justifyItems: 'end', width: 'max-content' }}>
      <Readout>111111</Readout>
      <Readout>888888</Readout>
      <Readout>0.0042</Readout>
      <span style={{ fontSize: '0.6875rem', opacity: 0.6 }}>the same three in the body face</span>
      <span>111111</span>
      <span>888888</span>
    </div>
  ),
};

export const InContext: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <span style={{ fontSize: '1.125rem' }}>
        a surface title with <Readout>300.8s</Readout> in it
      </span>
      <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
        a muted 12px line with <Readout>449ms</Readout> in it
      </span>
      <FigureRow>
        <Readout>$0.42</Readout>
        <Readout>12 turns</Readout>
        <Readout>vb-1042</Readout>
      </FigureRow>
    </div>
  ),
};
