import type { Meta, StoryObj } from '@storybook/react-vite';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { Suggestion } from '../../lib/shared';
import { SuggestionsPane } from './SuggestionsPane';

// WHAT AGENTS FILED, and this is the story that exercises the route stub — the nine remaining hook-driven
// organisms will use the same decorator. It renders from props, like the three prop-driven organisms, and
// then its two ACTIONS write through `lib/api` on click: Dismiss is a `PATCH /api/suggestions/:id` and
// Make a card is a `POST /api/suggestions/:id/card`. Without the stub both throw on the first click and
// the pane shows its error state, which is a story about the error state rather than about the pane.
//
// A STUB WITH NO CONSUMER IS A SENTENCE AND NOT A TOOL, which is this repository's recurring finding about
// its own gates. This story exists so the stub is exercised by something rather than merely shipped.

const filed: Suggestion[] = [
  {
    id: 'S-014',
    state: 'active',
    created: '2026-08-20T14:31:00.000Z',
    title: 'The archive drawer loads every card on open',
    run: 'r-2026-08-20-1431',
    card: 'C-031',
    body: 'It reads the whole archive folder to render a drawer that shows twenty rows.',
  },
  {
    id: 'S-015',
    state: 'active',
    created: '2026-08-21T09:04:00.000Z',
    title: 'Two settings panels disagree about what "enforced" means',
    body: 'One says the sandbox is enforced when Docker answers; the other when a container exists.',
  },
];

// A DECORATOR AND NOT A GLOBAL. `preview.tsx` installs nothing, so a story that does not opt in runs
// against the absent network and fails loudly if it ever starts fetching — see `.storybook/route-stub.ts`
// for why an unkeyed route is a 501 rather than `{}`, and for why the install is now torn down on unmount
// (it was not, and the stub outlived the story).
const routes = withRoutes({
  ...EMPTY,
  // The two writes answer with the record as the SERVER saved it, which is what `onApply` re-renders
  // from. Echoing the request back would hide the one bug this pane has had: a row going on showing the
  // state it held before the click.
  '/api/suggestions': ({ init }) =>
    init.method === 'PATCH'
      ? { suggestion: { ...filed[0], state: 'dismissed', reason: 'not this release' } }
      : { suggestions: filed },
});

const meta = {
  title: 'Organisms/Suggestions pane',
  component: SuggestionsPane,
  decorators: [routes],
  args: { suggestions: filed, failed: false, onRefresh: () => {}, onApply: () => {} },
} satisfies Meta<typeof SuggestionsPane>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// EMPTY AND FAILED ARE TWO DIFFERENT FACTS, and only the second is a cue to ask again. "Nothing has been
// filed" is the ordinary state of a healthy project; "we could not find out what was filed" is a fault.
// One empty list rendered for both is the bug `useSuggestions` records in its own comment.
export const Empty: Story = { args: { suggestions: [] } };
export const Failed: Story = { args: { suggestions: [], failed: true } };

// A ROW THAT HAS BEEN ANSWERED, both ways. `dismissed` keeps its reason — that is what stops a later
// checkup re-raising the same thing — and `actioned` names the card it became, which is a different fact
// from the card it was filed FROM.
export const Answered: Story = {
  args: {
    suggestions: [
      { ...filed[0], state: 'dismissed', reason: 'the drawer is capped at twenty on the server' },
      { ...filed[1], state: 'actioned', became: 'C-058' },
    ],
  },
};
