import type { Meta, StoryObj } from '@storybook/react-vite';
import { cards, runs } from '../../../../.storybook/fixtures';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { CardLedgerData } from '../../lib/api';
import { CardReports } from './CardReports';

// ONE CARD'S RUN LEDGER: every attempt against it, what they cost, and how many tries each skill has spent
// against the cap. Prop-driven for the list, and it needs the stub because `ForgiveAttempts` posts.
//
// THE ATTEMPT COUNT AT THE CAP IS THE ROW THAT MATTERS. A card at its cap is one auto-pilot will not pick
// up, and "Clear failed tries" is the only way back — which is why the fixture puts `implement` at 3 of 3
// rather than at 1. `ForgiveAttempts`'s error line is the surface the contrast regression this phase fixed
// was on: `Text error` wearing `.reports-forgiven` took its `opacity: 0.85` and went to 4.09–4.46:1.

const account: CardLedgerData = {
  spend: { runs: 4, withCost: 3, withoutCost: 1, costUsd: 1.94, outputTokens: 12_400, durationMs: 1_811_000 },
  attempts: { implement: 3, review: 1 },
  attemptCap: 3,
};

const card = cards.find((c) => c.id === 'E-011') ?? cards[0];
const mine = runs.filter((record) => record.card === card.id);

const meta = {
  title: 'Organisms/Card reports',
  component: CardReports,
  decorators: [withRoutes(EMPTY)],
  args: { card, runs: mine, account, onOpen: () => {}, onCancel: () => {}, onForgiven: () => {} },
} satisfies Meta<typeof CardReports>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// EVERY STATUS AT ONCE, which is the only way to read the four state inks against each other.
export const EveryStatus: Story = { args: { runs } };

// THE LEDGER HAS NOT ARRIVED. `account` is null until the fetch lands, and the panel must not render a cap
// of `undefined` — an absent count and a count of zero are different facts.
export const NoLedgerYet: Story = { args: { account: null } };

// THERE IS NO "NO RUNS" STORY, and that is a fact about the component rather than an omission: with an empty
// list and no ledger `CardReports` renders NOTHING — zero bytes of DOM — because a card that has never been
// dispatched has no report section at all. A story that renders nothing is not a story.
