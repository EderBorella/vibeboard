import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ComponentProps, useState } from 'react';
import { Button } from '../atoms/Button';
import { Chip } from '../atoms/Chip';
import { Readout } from '../atoms/Readout';
import { Menu } from './Menu';

// TWO FAMILIES, ONE COMPONENT, AND THE LINE FROM `Tabs` IS THE POINT: a `Menu` takes you SOMEWHERE ELSE.
// Its selected item is a LOCATION and its badge counts work waiting on somewhere you are NOT.
const meta = {
  title: 'Molecules/Menu',
  component: Menu,
  argTypes: { orientation: { control: 'inline-radio', options: ['row', 'list'] } },
  args: {
    label: 'View',
    items: [
      { value: 'boards', label: 'Boards' },
      { value: 'execution', label: 'Execution', badge: 3 },
      { value: 'diary', label: 'Project Log' },
      { value: 'control', label: 'Project Control' },
      { value: 'explorer', label: 'Explorer' },
    ],
    // Required props, so `Playground` typechecks with `render` and no `args` of its own — and the
    // Controls panel is complete. `Live` overrides both with real state.
    value: null,
    onChange: () => {},
  },
} satisfies Meta<typeof Menu>;
export default meta;

function Live(props: Omit<ComponentProps<typeof Menu>, 'value' | 'onChange'>) {
  const [value, setValue] = useState(props.items[0]?.value ?? '');
  return <Menu {...props} value={value} onChange={setValue} />;
}

export const Playground: StoryObj<typeof meta> = {
  render: (args) => <Live {...args} />,
};

export const EveryOption: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: '2rem', justifyItems: 'start' }}>
      <Live
        label="View"
        items={[
          { value: 'boards', label: 'Boards' },
          { value: 'execution', label: 'Execution', badge: 3 },
          { value: 'diary', label: 'Project Log' },
        ]}
      />
      {/* A LIST FLOATS, so it needs something to be positioned against — the switcher it hangs off. The
          second line and the delete glyph are the two things the chat session list had that no other menu
          does: `meta` is content, and `trailing` is a control BESIDE the item rather than inside it. */}
      <div style={{ position: 'relative', width: '22rem', height: '12rem' }}>
        <Live
          orientation="list"
          label="Chat history"
          onDismiss={() => {}}
          items={[
            {
              value: 'a',
              label: (
                <>
                  <Chip pill tone="neutral" className="chat-backend">
                    cc
                  </Chip>
                  a chat whose title is long enough to be cut off at the edge
                </>
              ),
              meta: <Readout>2h ago · 14 msg</Readout>,
              trailing: (
                <Button variant="bare" size="sm" title="Delete chat">
                  ✕
                </Button>
              ),
            },
            {
              value: 'b',
              label: (
                <>
                  <Chip pill tone="neutral" className="chat-backend">
                    oc
                  </Chip>
                  another session
                </>
              ),
              meta: <Readout>yesterday · 3 msg</Readout>,
              trailing: (
                <Button variant="bare" size="sm" title="Delete chat">
                  ✕
                </Button>
              ),
            },
          ]}
        />
      </div>
    </div>
  ),
};
