import type { Meta, StoryObj } from '@storybook/react-vite';
import { activeRunIds, config, queuedRunIds, runs, snapshot } from '../../../../.storybook/fixtures';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { AutopilotState, SandboxState } from '../../lib/api';
import { AutopilotBar } from './AutopilotBar';

// THE BAR THAT DRIVES THE AGENTS. Mostly prop-driven, and it needs the stub because it asks
// `/api/autopilot/readiness` on mount and posts start/stop/kill on click.
//
// FOUR STORIES BECAUSE THE BAR IS FOUR DIFFERENT CONTROLS depending on what it is told, and only one of them
// is ever on screen at a time:
//
//  - running, with an iteration count and a stop;
//  - idle and ready, with a start;
//  - idle and NOT ready, where the blockers are the subject and the start is refused;
//  - agents cannot run at all, which is the sandbox's refusal and not auto-pilot's — `agentStatus()` exists
//    to keep those two apart, because "Docker is not ready" is a lie when the daemon is fine and the box is
//    holding a credential that has been replaced on the host.

const sandbox: SandboxState = {
  ok: true,
  backend: 'managed',
  profile: 'default',
  agentRefusal: null,
  refusalKind: null,
};
const running: AutopilotState = { state: 'running', iteration: 4, at: '2026-08-23T09:12:00.000Z' };
const stopped: AutopilotState = {
  state: 'stopped',
  iteration: 4,
  reason: 'stalled',
  detail: 'A gate document is unreviewed.',
  at: '2026-08-23T08:02:00.000Z',
};

const meta = {
  title: 'Organisms/Auto-pilot bar',
  component: AutopilotBar,
  decorators: [withRoutes(EMPTY)],
  args: {
    state: running,
    runs: { runs, active: activeRunIds, queued: queuedRunIds },
    bump: 0,
    copilot: config.copilot,
    // The lifecycle block, for the mode picker. From the shared fixture rather than written here, so a key
    // added to the block reaches the workbench without a second edit.
    autopilotConfig: config.autopilot ?? null,
    // The feature cards, for the focus picker — which renders only in express, so the Express story below
    // is the one that shows it.
    features: snapshot.boards.features,
    sandbox,
    onChanged: () => {},
    onBackendChanged: () => {},
    onSettings: () => {},
    onRepairing: () => {},
  },
} satisfies Meta<typeof AutopilotBar>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Running: Story = {};

// IDLE AND READY: nothing is dispatching and nothing is stopping it.
export const Idle: Story = {
  args: { state: null, runs: { runs: [], active: [], queued: [] } },
};

// STOPPED WITH A REASON, which is the state the detail line exists for — "it stopped" without why is what
// sends somebody reading the log.
export const Stopped: Story = { args: { state: stopped } };

// BLOCKED, and the blockers come from the readiness endpoint rather than from props: the bar has to say what
// would have to change before a start could do anything.
export const NotReady: Story = {
  args: { state: null },
  decorators: [
    withRoutes({
      ...EMPTY,
      '/api/autopilot/readiness': {
        blockers: ['No skill named `implement`', 'Two cards claim to be the setup feature'],
      },
    }),
  ],
};

// AGENTS CANNOT RUN AT ALL, which is the sandbox refusing and NOT auto-pilot stopping. Different sentence,
// different control, same bar.
export const AgentsRefused: Story = {
  args: {
    state: null,
    sandbox: {
      ok: false,
      backend: 'managed',
      agentRefusal: 'The container is holding a credential that has been replaced on the host.',
      refusalKind: 'credential',
    },
  },
};

// EXPRESS, which is the only mode that shows a focus picker — so without this story the workbench shows a
// bar the app has and one control it does not. The same rule the cascade is held to: a workbench that
// demonstrates less than the product is worse than one that demonstrates nothing.
export const Express: Story = {
  args: {
    autopilotConfig: config.autopilot ? { ...config.autopilot, mode: 'express' } : null,
  },
};

// AND FOCUSED ON ONE FEATURE, because the picker showing "The whole board" and the picker naming a card are
// two different readings of the same control and only one of them says what the loop will do.
export const ExpressFocused: Story = {
  args: {
    autopilotConfig: config.autopilot
      ? { ...config.autopilot, mode: 'express', focus: snapshot.boards.features[0]?.id }
      : null,
  },
};
