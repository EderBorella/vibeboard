import type { Meta, StoryObj } from '@storybook/react-vite';
import { activeRunIds, cards, now, queuedRunIds, runs } from '../../../../.storybook/fixtures';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { Accounting } from '../../lib/api';
import { ExecutionView } from './ExecutionView';

// EVERY RUN IN THE PROJECT, IN THREE COLUMNS: what is happening, what is waiting for a decision, and what
// came back. Failed and interrupted runs sit under "Requires attention" and not under "Done" — burying a
// broken run under successes is how it goes unnoticed for a week, and a fixture of nothing but successes
// renders the one column that carries no decision.
//
// PROPS FOR THE RUNS AND A STUB FOR THE MONEY. The list is handed down from the shell, but `useAccounting`
// fetches `/api/accounting` on mount and `ForgiveAttempts` posts on click, so the page needs the stub even
// though its data does not come from it. `EMPTY` answers accounting with an empty ledger; the spread below
// gives it numbers, because a project that has spent nothing renders no figures at all.

// ANNOTATED, AND THE ANNOTATION CAUGHT A REAL BUG. `RouteTable`'s value type is `object`, so this was first
// written as `{ runs, cost, tokens }` — nothing like `Accounting`, which is `{ project: Spend; cards: [];
// attemptCap: number }` — and all four typechecks passed while the page threw `Cannot read properties of
// undefined (reading 'runs')` on render in all three themes. `EMPTY`'s own row was wrong the same way.
// `costUsd` present here and absent from `EMPTY`'s row is the pair that matters: an absent cost renders
// "usage not reported by this backend", which is a different sentence from zero.
const accounting: Accounting = {
  project: {
    runs: 24,
    withCost: 21,
    withoutCost: 3,
    costUsd: 18.44,
    outputTokens: 3_910_000,
    durationMs: 9_140_000,
  },
  cards: [],
  attemptCap: 3,
};

const meta = {
  title: 'Pages/Execution',
  component: ExecutionView,
  parameters: { layout: 'fullscreen' },
  decorators: [withRoutes({ ...EMPTY, '/api/accounting': accounting })],
  args: {
    runs,
    active: activeRunIds,
    queued: queuedRunIds,
    cards,
    now,
    onOpenCard: () => {},
    onCancel: () => {},
    onResolve: () => {},
    onForgiven: () => {},
  },
} satisfies Meta<typeof ExecutionView>;
export default meta;

type Story = StoryObj<typeof meta>;

export const At900: Story = { globals: { viewport: { value: 'w900' } } };
export const At1200: Story = { globals: { viewport: { value: 'w1200' } } };
export const At1440: Story = { globals: { viewport: { value: 'w1440' } } };

// NOTHING HAS RUN YET, which is every new project and the state the three empty columns have to be legible
// in. Not the same picture as "we could not find out what ran".
export const Empty: Story = {
  args: { runs: [], active: [], queued: [] },
  globals: { viewport: { value: 'w1440' } },
};
