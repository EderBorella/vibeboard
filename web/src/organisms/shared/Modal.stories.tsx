import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import { Field } from '../../molecules/Field';
import { Modal } from './Modal';

// FOUR HAND-BUILT DIALOGS AND 21 CLASSES IN FIVE. The four stories below are the four families, rendered
// from the one component: the settings form, the model picker, the confirm question and the halt overlay.
// What they disagreed about is `size`, `tone` and `blocking`, and every one of those is an ATTRIBUTE here
// rather than a class — see organisms/shared/modal.css for why the class budget is the reason.
//
// A modal fills its viewport, so each story is framed by the workbench rather than by a decorator: the
// backdrop is `position: fixed`, which means the story canvas IS the frame.
const meta = {
  title: 'Organisms/Modal',
  component: Modal,
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    tone: { control: 'inline-radio', options: ['plain', 'accent', 'danger'] },
    blocking: { control: 'boolean' },
    alert: { control: 'boolean' },
  },
  args: { onClose: () => {} },
} satisfies Meta<typeof Modal>;
export default meta;

type Story = StoryObj<typeof meta>;

// `lg`, and it is the widest of the three because it is the one you FILL IN. Was `.modal` + `.modal-head`
// + `.modal-title` + `.modal-body` + `.modal-foot` + `.modal-backdrop`.
export const Form: Story = {
  args: {
    size: 'lg',
    title: 'Settings',
    label: 'Settings',
    head: (
      <Button variant="bare" size="sm">
        ✕
      </Button>
    ),
    actions: (
      <>
        <Button size="md">Cancel</Button>
        <Button variant="primary" size="md">
          Save
        </Button>
      </>
    ),
    children: (
      <>
        <Field label="Keep last N chats">
          <Control type="number" defaultValue={12} />
        </Field>
        <Field label="Context window (tokens)">
          <Control type="number" defaultValue={200000} />
        </Field>
        <Text role="hint">What the context bar treats as full.</Text>
      </>
    ),
  },
};

// `md` and `accent`. The accent edge and the glow say this modal is the one thing on screen; `overflow:
// hidden` with it, because a scrolling list would otherwise draw over the corner it sits inside.
export const Picker: Story = {
  args: {
    size: 'md',
    tone: 'accent',
    title: 'Choose a model',
    label: 'Choose a model',
    head: (
      <Button variant="bare" size="sm">
        ✕
      </Button>
    ),
    children: <Text role="hint">The picker's own list is Organisms/List.</Text>,
  },
};

// `sm` and `alert`: a question, and it can be asked from INSIDE another modal, which is why the layer is
// a property of the ask rather than of the shape. The foot has no rule above it — a dialog whose question
// and answer are one paragraph does not want one.
export const Question: Story = {
  args: {
    size: 'sm',
    alert: true,
    title: 'Delete this chat?',
    label: 'Delete this chat?',
    actions: (
      <>
        <Button>Cancel</Button>
        <Button className="confirm-go danger">Delete chat</Button>
      </>
    ),
    children: <Text lead>The transcript goes from disk. Nothing else changes.</Text>,
  },
};

// `blocking` and `danger`: no dismiss, and the page behind is WASHED rather than dimmed. This is the halt
// overlay and the sign-in prompt, which borrowed it by hand for two phases.
export const Blocking: Story = {
  args: {
    blocking: true,
    size: 'md',
    tone: 'danger',
    role: 'alertdialog',
    title: 'This project is halted',
    label: 'This project is halted',
    children: (
      <>
        <p>Everything in this project was stopped. Halted at 14:02 on 21 August.</p>
        <Text lead>
          Nothing will be dispatched, and no agent or backend will be started for this project — not even by
          the chat.
        </Text>
        <Surface variant="inset" className="signin-label">
          Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36
        </Surface>
        <Button variant="primary" size="md">
          Restart project
        </Button>
      </>
    ),
  },
};
