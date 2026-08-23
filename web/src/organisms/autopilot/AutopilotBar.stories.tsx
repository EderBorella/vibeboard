import type { Meta, StoryObj } from '@storybook/react-vite';
import { activeRunIds, config, queuedRunIds, runs } from '../../../../.storybook/fixtures';
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
    sandbox,
    onChanged: () => {},
    onBackendChanged: () => {},
    onSettings: () => {},
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
