import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Readout } from '../../atoms/Readout';
import { Text } from '../../atoms/Text';
import { TONES } from '../../molecules/state-tones';
import { List } from './List';
import { Row } from './Row';

// THE FIVE CLASSES, ONE OPTION AT A TIME. `Row` is `rail`, `interactive`, `lead`, `trail`, and the two
// axes it hands to `Surface` (`variant`) and to `.vb-list` (`stack`).
const meta = {
  title: 'Organisms/List',
  component: Row,
  argTypes: {
    variant: { control: 'inline-radio', options: ['plain', 'flat', 'inset'] },
    rail: { control: 'inline-radio', options: [false, true, ...TONES] },
    interactive: { control: 'boolean' },
    active: { control: 'boolean' },
    stack: { control: 'boolean' },
  },
  args: { children: 'A row of a list' },
} satisfies Meta<typeof Row>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { variant: 'flat', interactive: true, lead: <span className="vb-twist">▾</span> },
  render: (args) => (
    <List>
      <Row {...args} />
      <Row {...args} />
      <Row {...args} />
    </List>
  ),
};

// THE RAIL IS WHERE `--rule` AND `--tone` MEET, and this is the whole of what eleven surfaces were each
// writing by hand. Six rows: the quiet default, then the five tones the table defines.
export const Rails: Story = {
  render: () => (
    <List>
      <Row variant="flat" rail>
        <Text caps>no tone</Text>
        <Readout>var(--border)</Readout>
      </Row>
      {TONES.map((tone) => (
        <Row key={tone} variant="flat" rail={tone}>
          <Text caps>{tone}</Text>
          <Readout>var(--tone)</Readout>
        </Row>
      ))}
    </List>
  ),
};

// SELECTION, and it is one hover and one selected state for every row in the app. Four surfaces wrote
// four of them: `.control-item`, `.mp-item`/`.mp-sel`, `.gate-list button` and `.exec-card`.
export const Interactive: Story = {
  render: () => {
    const [picked, setPicked] = useState('b');
    return (
      <List>
        {['a', 'b', 'c'].map((id) => (
          <Row
            key={id}
            as="button"
            variant="flat"
            interactive
            active={picked === id}
            onClick={() => setPicked(id)}
            trail={<Chip pill>{id}</Chip>}
          >
            <span className="vb-clip">config/{id}.yaml</span>
          </Row>
        ))}
      </List>
    );
  },
};

// `stack`, which is `.vb-list` doing its second job: a row of two LINES rather than a line of cells. Five
// families were this — the diary entry, the filed entry, a run record, a model pick, a filed suggestion.
export const Stacked: Story = {
  render: () => (
    <List as="ol">
      {['checkup', 'run', 'note'].map((kind) => (
        <Row key={kind} as="li" stack variant="flat" rail data-kind={kind}>
          <Text caps>{kind}</Text>
          <p>What the agent did, in one line, at the step the surface reads at.</p>
        </Row>
      ))}
    </List>
  ),
};

// `lead` and `trail`, and the cell between them is `.vb-row-main` — the one name for "this takes the
// slack" that five families spelled five ways.
export const LeadAndTrail: Story = {
  render: () => (
    <List>
      <Row
        variant="inset"
        lead={
          <Button variant="bare" size="sm">
            ★
          </Button>
        }
        trail={<Readout>$0.42</Readout>}
      >
        <span className="vb-clip">
          a name long enough that the cell in the middle is the one that has to give way
        </span>
      </Row>
    </List>
  ),
};
