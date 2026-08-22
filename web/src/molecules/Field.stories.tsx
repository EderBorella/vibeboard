import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Control } from '../atoms/Control';
import { Field } from './Field';

// A LABEL, A CONTROL, A HINT AND AN ERROR, IN THAT ORDER — and `inline`, which is the absorbed
// `InlineField`. The objection to that merge was GEOMETRIC (one control in two states sharing one box, and
// no primitive owned it); `--ctl-h` and the `Control` atom answered it, and what was left is behaviour.
const meta = {
  title: 'Molecules/Field',
  component: Field,
} satisfies Meta<typeof Field>;
export default meta;

export const EveryOption: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '28rem' }}>
      <Field label="Cap on parallel runs" hint="Nothing above four is worth the tokens.">
        <Control defaultValue="2" />
      </Field>
      <Field label="Board" layout="rail">
        <Control as="select" defaultValue="engineering">
          <option value="engineering">engineering</option>
        </Control>
      </Field>
      <Field label="Refuse a dispatch while the tree is dirty" layout="check">
        <Control type="checkbox" defaultChecked />
      </Field>
      <Field caps label="Anything to add?">
        <Control as="textarea" rows={3} />
      </Field>
      <Field label="Terminal column" error="No column of that name on this board.">
        <Control defaultValue="dnoe" />
      </Field>
    </div>
  ),
};

// `inline` — click to edit, commit on blur, Enter commits, Escape reverts. Live because the whole of it is
// the transition between the two states, which a screenshot cannot show.
export const Inline: StoryObj = {
  render: () => {
    const [title, setTitle] = useState('a card title you can click');
    const [body, setBody] = useState('a multiline value.\n\nEnter belongs to the text here.');
    return (
      <div style={{ display: 'grid', gap: '1rem', maxWidth: '28rem' }}>
        <Field inline required label="title" value={title} onCommit={setTitle} />
        <Field inline multiline rows={4} label="body" value={body} onCommit={setBody} />
        <Field inline label="description" value="" placeholder="Add a description" onCommit={() => {}} />
      </div>
    );
  },
};
