import type { Meta, StoryObj } from '@storybook/react-vite';
import { TopBar } from './TopBar';

// THE APP'S CHROME, WHICH IS THE ONE ORGANISM EVERY OTHER SURFACE IS SEEN UNDERNEATH. It is also the row
// where the two hardest claims in this design system are made at once: it is `align-items: baseline`
// (four type steps on one line, and centring line boxes of different sizes puts their baselines at three
// different heights), and it WRAPS rather than pushing its controls off the edge — at 820px the whole
// right-hand group, including the copilot toggle that would give the board its width back, used to be
// simply off-screen. Both are visible here by narrowing the frame.
//
// PROP-DRIVEN AND FETCHING NOTHING, which is why it is one of the three organisms with a story and no
// stub: `light` and `lightTitle` arrive already DECIDED by `lightFor`, because the precedence between a
// dead socket and a project that cannot run is a rule, and a rule living in JSX is a rule nothing can
// test on its own.
const meta = {
  title: 'Organisms/Top bar',
  component: TopBar,
  args: {
    showProject: true,
    projectName: 'vibeboard',
    tab: 'boards',
    onTab: () => {},
    attentionCount: 0,
    theme: 'cyberpunk',
    onTheme: () => {},
    copilotOpen: false,
    onToggleCopilot: () => {},
    onSettings: () => {},
    onSwitchProject: () => {},
    light: 'online',
    lightTitle: 'Connected; agents can run',
    agentRefusal: null,
  },
  argTypes: {
    tab: {
      control: 'inline-radio',
      options: ['boards', 'execution', 'diary', 'control', 'explorer'],
    },
    light: {
      control: 'inline-radio',
      options: ['online', 'offline', 'failing', 'connecting', 'closed', 'unauthorized'],
    },
    attentionCount: { control: { type: 'range', min: 0, max: 99, step: 1 } },
  },
} satisfies Meta<typeof TopBar>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// THE BADGE, which is the only thing in this row that is not a word. `Menu`'s `badge` option renders it —
// `Chip pill fill` with the mono face — and it must not change the tab's height, which is what
// `--mark-h` inside `--ctl-h` is for.
export const NeedsYou: Story = { args: { tab: 'execution', attentionCount: 7 } };

// THE THREE WAYS THE LIGHT IS NOT GREEN, and they are three different remedies. `closed` and
// `unauthorized` share `--danger` because a colour cannot say which of five remedies applies; the WORD
// and the balloon are what tell them apart, which is why the label has its own element.
export const Refusing: Story = {
  args: {
    light: 'offline',
    lightTitle: 'Agents cannot run: Docker is not ready',
    agentRefusal: 'Cannot reach the Docker daemon at /var/run/docker.sock.',
    refusalKind: 'docker',
    recentFailure: { runs: 3, note: 'the model was never reached', at: '2026-08-22T11:02:00.000Z' },
  },
};

// BEFORE A PROJECT IS OPEN: everything except the brand, the theme picker and the light is behind
// `showProject`. This is what the gate and the sign-in page are seen under.
export const NoProject: Story = {
  args: { showProject: false, projectName: undefined, light: 'connecting', lightTitle: 'Connecting…' },
};

// THE LONGEST THING IN THE ROW, capped at `22ch`. Measured with a 240-character name at 1100px: the name
// truncated AND the bar still grew from 85px to 105px, because nothing stopped it claiming 1068 of the
// 1100 first — `flex-wrap` resolves before shrinking, so the cap is what makes the truncation mean
// anything.
export const LongProjectName: Story = {
  args: { projectName: 'a-project-whose-directory-name-nobody-would-choose-on-purpose' },
};
