import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ComponentProps, useState } from 'react';
import { Button } from '../atoms/Button';
import { Tabs } from './Tabs';

// FOUR FAMILIES, ONE COMPONENT, AND THE OPTIONS ARE THE WHOLE STORY: `grouped`, `closable`, `badge`.
// `.dock-tab`, `.cards-tab`, `.control-tabs button` and `.vb-seg-cell` were four faces, four selected
// states and four heights (22.4px, 25.8px badged, 17.75px and 24px) for one shape.
const meta = {
  title: 'Molecules/Tabs',
  component: Tabs,
  argTypes: {
    grouped: { control: 'boolean' },
    closable: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: {
    label: 'View',
    items: [
      { value: 'fields', label: 'Fields' },
      { value: 'edit', label: 'Edit' },
      { value: 'preview', label: 'Preview' },
    ],
    // Required props, so `Playground` typechecks with `render` and no `args` of its own — and the
    // Controls panel is complete. `Live` overrides both with real state.
    value: null,
    onChange: () => {},
  },
} satisfies Meta<typeof Tabs>;
export default meta;

// Live, because a selected state nobody can move is a screenshot. Every story below drives its own value.
function Live(props: Omit<ComponentProps<typeof Tabs>, 'value' | 'onChange'>) {
  const [value, setValue] = useState(props.items[0]?.value ?? '');
  return <Tabs {...props} value={value} onChange={setValue} />;
}

export const Playground: StoryObj<typeof meta> = {
  render: (args) => <Live {...args} />,
};

export const EveryOption: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: '1.5rem', justifyItems: 'start' }}>
      <Live
        label="View"
        items={[
          { value: 'fields', label: 'Fields' },
          { value: 'edit', label: 'Edit' },
          { value: 'preview', label: 'Preview' },
        ]}
      />
      {/* A badge counts what is IN FRONT OF YOU, which is the half of the definition that separates this
          from a `Menu`: the dock's pane says how many cards are open in it. */}
      <Live
        label="Utilities"
        items={[
          { value: 'cards', label: 'CARDS', badge: 3 },
          { value: 'terminal', label: 'TERMINAL', badge: 0 },
          { value: 'logs', label: 'LOGS' },
        ]}
      />
      {/* `closable`, and the `✕` is a sibling rather than a child — a button inside a button is invalid
          and unclickable. The long label is the row that matters: it clamps at 220px and ellipsises. */}
      <Live
        label="Open cards"
        closable
        onClose={() => {}}
        items={[
          { value: 'E-001', label: 'a card title short enough to read' },
          { value: 'E-002', label: 'a card title long enough that it has to be cut off somewhere' },
        ]}
      />
      {/* `grouped`: one border on the group, the cells clipped inside it, and the chosen cell filled. It
          was `SegmentedControl`, whose four classes were two names for one shape. */}
      <Live
        label="Mode"
        grouped
        items={[
          { value: 'claude-code', label: 'Claude Code' },
          { value: 'opencode', label: 'OpenCode' },
        ]}
      />
      <Live
        label="Mode"
        grouped
        disabled
        items={[
          { value: 'a', label: 'disabled while a run is in flight' },
          { value: 'b', label: 'the other one' },
        ]}
      />
      {/* `children` are members of the STRIP and not of any tab — the dock's collapse toggle, the cards
          pane's Raw switch. Both were already siblings of the cells. */}
      <Live
        label="With a trailing control"
        items={[
          { value: 'a', label: 'One' },
          { value: 'b', label: 'Two' },
        ]}
      >
        <Button className="push" size="sm">
          Raw
        </Button>
      </Live>
    </div>
  ),
};
