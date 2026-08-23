import type { Meta, StoryObj } from '@storybook/react-vite';
import { SignIn } from './SignIn';

// THE SCREEN A BROWSER WITH NO CREDENTIAL GETS, and it exists so that browser is never shown a working
// board on which every button silently fails. Prop-driven, so no route stub: the polling lives in
// `organisms/signin/driver.ts` and this page renders only the phase it is handed.
//
// ALL THREE PHASES ARE STORIES, because the states are the page. `claiming` is over in milliseconds and is
// therefore the one nobody has ever looked at; `stopped` is the only one with a button, and only when
// trying again could plausibly work.

const meta = {
  title: 'Pages/SignIn',
  component: SignIn,
  parameters: { layout: 'fullscreen' },
  args: { phase: { phase: 'claiming' }, onRetry: () => {} },
} satisfies Meta<typeof SignIn>;
export default meta;

type Story = StoryObj<typeof meta>;

const waiting = {
  phase: 'waiting',
  label: 'Chromium on Linux',
  address: '192.168.1.24',
} as const;

export const At900: Story = { args: { phase: waiting }, globals: { viewport: { value: 'w900' } } };
export const At1200: Story = { args: { phase: waiting }, globals: { viewport: { value: 'w1200' } } };
export const At1440: Story = { args: { phase: waiting }, globals: { viewport: { value: 'w1440' } } };

export const Claiming: Story = { globals: { viewport: { value: 'w1440' } } };

// THE WHOLE REASON THIS SCREEN EXISTS: it says WHY. A single red "unauthorized" is what sent people looking
// for a token they had no way to know about.
export const Stopped: Story = {
  args: {
    phase: {
      phase: 'stopped',
      reason: 'That was refused on the browser you asked. Nothing was signed in.',
      retry: false,
    },
  },
  globals: { viewport: { value: 'w1440' } },
};

// RETRYABLE IS A DIFFERENT SCREEN FROM REFUSED — a refusal is a decision and offers no button; a rate limit
// or a busy project will pass.
export const StoppedRetryable: Story = {
  args: {
    phase: { phase: 'stopped', reason: 'The project was busy. Nothing was signed in.', retry: true },
  },
  globals: { viewport: { value: 'w1440' } },
};
