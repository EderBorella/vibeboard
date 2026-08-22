import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, type ButtonSize, type ButtonVariant } from './Button';

// ONE BUTTON WITH OPTIONS, which is the owner's rule for the whole system: "we don't have 3 or 4 types of
// button, we have a button with options". This file is where that claim is either true or visibly false —
// every variant and every size, drawn together, at the size they actually render.
const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Start' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'default', 'ghost', 'danger', 'bare'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    disabled: { control: 'boolean' },
    // Documented as layout-only and gated as such by `npm run check:radius-scale`. Exposed here so the
    // rule is visible, not so it can be used.
    className: { control: 'text' },
  },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

const VARIANTS: ButtonVariant[] = ['primary', 'default', 'ghost', 'danger', 'bare'];
const SIZES: ButtonSize[] = ['sm', 'md'];

export const Playground: Story = {};

// THE WHOLE SET, and the reason it is one story rather than five: the question worth asking of a variant
// is not "does it render" but "is it distinguishable from the other four and the same shape as them". Five
// separate stories cannot answer either.
export const EveryVariant: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {SIZES.map((size) => (
        <div key={size} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <code style={{ minWidth: '3ch', opacity: 0.6 }}>{size}</code>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant}
            </Button>
          ))}
          {VARIANTS.map((variant) => (
            <Button key={`${variant}-off`} variant={variant} size={size} disabled>
              {variant}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

// THE GHOST'S BORDER IS DASHED, ruled by the owner on 2026-08-20: dashed reads as explanatory rather than
// actionable, and it keeps the box exactly as wide as a solid button where a borderless ghost is 2px
// narrower and shifts the row it sits in. Shown beside a solid one because that is the only way to see it.
export const GhostAgainstSolid: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <Button variant="ghost">? How it works</Button>
      <Button>Settings</Button>
      <Button variant="primary">▶ Start</Button>
    </div>
  ),
};
