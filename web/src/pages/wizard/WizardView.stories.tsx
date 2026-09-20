import type { Meta, StoryObj } from '@storybook/react-vite';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { WizardState } from '../../lib/shared';
import { WizardView } from './WizardView';

// SETTING A PROJECT UP, AS A WHOLE SCREEN. Both stories are the identity step, which is the one that runs
// with NO project open — `snapshot: null` — and the only one whose two modes differ in what they ask: a
// new project needs somewhere to go and a name, and a repository already on disk is its own answer to
// both.
//
// IT WEARS ITS OWN CARD AND NOT `Pages/Gate`'s, though the box is the same. The browser harness proves the
// board by counting the picker's frame at zero and this screen renders with a project open, so a borrowed
// name would make that proof answer for two screens. Worth seeing side by side with `Pages/Gate` for
// exactly that reason.

// ANNOTATED for the reason `Pages/Log` records: a `RouteTable` value is `object`, so an un-annotated
// literal handed to the stub is checked by nothing at all. Nothing here fetches on mount — the identity
// step's two calls happen on a press — so the stub is what makes an accidental fetch a loud 501 rather
// than a screen that looks right.
const pending: { state: WizardState | null } = { state: null };

const meta = {
  title: 'Pages/Wizard',
  component: WizardView,
  parameters: { layout: 'fullscreen' },
  decorators: [withRoutes({ ...EMPTY, '/api/wizard': pending })],
  args: {
    mode: 'greenfield',
    start: 'identity',
    snapshot: null,
    bump: 0,
    onOpened: () => {},
    onExit: () => {},
  },
} satisfies Meta<typeof WizardView>;
export default meta;

type Story = StoryObj<typeof meta>;

export const At900: Story = { globals: { viewport: { value: 'w900' } } };
export const At1200: Story = { globals: { viewport: { value: 'w1200' } } };
export const At1440: Story = { globals: { viewport: { value: 'w1440' } } };

// THE DOOR THAT CAME BACK. One field instead of two, because the folder already has a name — and the
// first surface in the product ever to send `mode: 'brownfield'`.
export const MapAnExistingRepository: Story = {
  args: { mode: 'brownfield' },
  globals: { viewport: { value: 'w1440' } },
};
