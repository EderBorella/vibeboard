import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { Stack } from './Stack';
import { Text } from './Text';

// THE LAYOUT ATOM, AND THE CENSUS THAT SAYS IT HAD TO EXIST. See `atoms/stack.css`. This page is where
// the claim "one component with options" is either true or visibly false for layout: every direction,
// every alignment, every gap step, drawn at the size it actually renders.
const meta = {
  title: 'Atoms/Stack',
  component: Stack,
  argTypes: {
    direction: { control: 'inline-radio', options: ['row', 'column'] },
    gap: { control: 'inline-radio', options: [0, 1, 2, 3, 4, 5, 6, 7] },
    align: { control: 'select', options: ['center', 'start', 'baseline', 'stretch'] },
    wrap: { control: 'boolean' },
    justify: { control: 'select', options: [undefined, 'end', 'between'] },
  },
  args: { children: 'x' },
} satisfies Meta<typeof Stack>;
export default meta;

type Story = StoryObj<typeof meta>;

const swatch = (label: string) => (
  <span key={label} style={{ background: 'var(--panel-2)', padding: '2px 8px', borderRadius: '4px' }}>
    {label}
  </span>
);

export const Playground: Story = {
  render: (args) => <Stack {...args}>{['one', 'two', 'three'].map(swatch)}</Stack>,
};

// EVERY GAP STEP, one above the other, because the question worth asking of a scale is not "does step 4
// work" but "can you tell step 3 from step 4" — which a single story can answer and eight cannot.
export const EveryGap: Story = {
  render: () => (
    <Stack direction="column" gap={3} align="start">
      {([0, 1, 2, 3, 4, 5, 6, 7] as const).map((g) => (
        <Stack key={g} gap={g}>
          <Text ink="strong" nowrap>{`gap ${g}`}</Text>
          {['a', 'b', 'c'].map(swatch)}
        </Stack>
      ))}
    </Stack>
  ),
};

// THE FOUR ALIGNMENTS AGAINST MIXED HEIGHTS, which is the only way to see them: on children of one height
// every value renders identically, and a fixture too thin to distinguish two outcomes tests neither.
export const EveryAlign: Story = {
  render: () => (
    <Stack direction="column" gap={5} align="start">
      {(['center', 'start', 'baseline', 'stretch'] as const).map((a) => (
        <Stack key={a} align={a} gap={3}>
          <Text ink="strong" nowrap>
            {a}
          </Text>
          {swatch('short')}
          <span style={{ background: 'var(--panel-2)', padding: '14px 8px' }}>tall</span>
          <Text lead>a lead line</Text>
        </Stack>
      ))}
    </Stack>
  ),
};

// WHAT SHRINKS AND WHAT DOES NOT, drawn in a row narrow enough to force the question — on a row with
// spare space every child renders identically and the fixture proves nothing. `.vb-clip` takes the space
// and ellipsises; `.vb-fixed` refuses to shrink; the default is shrink-to-fit.
export const WhatShrinks: Story = {
  render: () => (
    <div style={{ width: '260px', display: 'grid', gap: '1rem' }}>
      <Stack gap={3}>
        <Text className="vb-clip">a title long enough that it has to be cut somewhere</Text>
        <Text ink="strong" className="vb-fixed" nowrap>
          never shrinks
        </Text>
        <Button size="sm" className="vb-fixed">
          go
        </Button>
      </Stack>
      <Stack gap={3} justify="end">
        <Text nowrap>justify=end</Text>
        <Button size="sm">cancel</Button>
        <Button size="sm" variant="primary">
          confirm
        </Button>
      </Stack>
    </div>
  ),
};

// PADDING AND AN EDGE, the two options the first migrated surface proved were missing. Six classes in one
// directory were "a row with a gap, some padding, and a rule under it" — which is this, and which is why
// that surface deleted one class out of fifty-one before these existed.
export const PadAndEdge: Story = {
  render: () => (
    <Stack direction="column" gap={0} align="stretch">
      <Stack pad={[3, 5]} edge="bottom" gap={4}>
        <Text ink="strong">a head</Text>
        <Button size="sm" className="push">
          act
        </Button>
      </Stack>
      <Stack pad={[2, 5]} edge="bottom" gap={3}>
        <Text>a status line under it</Text>
      </Stack>
      <Stack pad={5} gap={3}>
        <Text>and a body with one padding on both axes</Text>
      </Stack>
    </Stack>
  ),
};
