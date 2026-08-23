import type { Meta, StoryObj } from '@storybook/react-vite';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { DiaryEntry } from '../../lib/api';
import type { Suggestion } from '../../lib/shared';
import { DiaryView } from './DiaryView';

// THE PROJECT LOG AND WHAT AGENTS FILED, SIDE BY SIDE (decision 48). Both are the record of what happened
// while nobody was watching, and the suggestions sit in the space the diary list never uses.
//
// FULLY HOOK-DRIVEN, so it exists only through the route stub: `useDiary` reads `/api/log` and
// `useSuggestions` reads `/api/suggestions`, and the compose box posts. `bump` is the snapshot counter the
// shell increments; a story holds it at 0 because nothing on disk changes here.
//
// THE SECOND `@media (max-width: 1100px)` IN THE APP IS THIS PAGE'S — `diary.css:73` unstacks the split —
// so the 900 story is a different layout and not a narrower one. That is the whole reason the three widths
// are real viewports.

// ANNOTATED, and the annotation is the point: a `RouteTable` value is `object`, so a literal handed
// straight to the stub is checked by NOTHING. Written un-annotated first, and three of these four `kind`s
// were invented — `DIARY_KINDS` is `run | checkup | lifecycle | note` — and every typecheck passed.
const entries: DiaryEntry[] = [
  {
    at: '2026-08-23T09:12:00.000Z',
    kind: 'run' as const,
    text: 'Dispatched E-011 to implement.',
    iteration: 4,
    card: 'E-011',
    board: 'engineering' as const,
    skill: 'implement',
  },
  {
    at: '2026-08-23T08:51:00.000Z',
    kind: 'run' as const,
    text: 'E-012 came back needing a decision about which panel is the truth.',
    card: 'E-012',
    board: 'engineering' as const,
    outcome: 'attention',
  },
  {
    at: '2026-08-23T07:44:00.000Z',
    kind: 'lifecycle' as const,
    text: 'Stopped: the backend never answered.',
  },
  {
    at: '2026-08-22T17:02:00.000Z',
    kind: 'note' as const,
    text: 'Renamed the archive drawer card by hand — the old title said "loads slowly", which is not what it does.',
  },
];

const suggestions: Suggestion[] = [
  {
    id: 'S-014',
    state: 'active' as const,
    created: '2026-08-22T14:31:00.000Z',
    title: 'The archive drawer loads every card on open',
    run: 'r-2026-08-23-0803',
    card: 'E-011',
    body: 'It reads the whole archive folder to render a drawer that shows twenty rows.',
  },
  {
    id: 'S-015',
    state: 'dismissed' as const,
    created: '2026-08-21T09:04:00.000Z',
    title: 'Two settings panels disagree about what "enforced" means',
    reason: 'the two are about different things and both are honest',
    body: 'One says the sandbox is enforced when Docker answers; the other when a container exists.',
  },
];

const meta = {
  title: 'Pages/Log',
  component: DiaryView,
  parameters: { layout: 'fullscreen' },
  decorators: [withRoutes({ ...EMPTY, '/api/log': { entries }, '/api/suggestions': { suggestions } })],
  args: { bump: 0 },
} satisfies Meta<typeof DiaryView>;
export default meta;

type Story = StoryObj<typeof meta>;

export const At900: Story = { globals: { viewport: { value: 'w900' } } };
export const At1200: Story = { globals: { viewport: { value: 'w1200' } } };
export const At1440: Story = { globals: { viewport: { value: 'w1440' } } };

// A PROJECT WITH NO HISTORY, which is the ordinary state of a new one and NOT a fault. Both columns are
// empty at once here, which is the only place `.diary-empty` — the shared empty column with an action under
// it — can be looked at.
export const Empty: Story = {
  decorators: [withRoutes(EMPTY)],
  globals: { viewport: { value: 'w1440' } },
};
