import type { Meta, StoryObj } from '@storybook/react-vite';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { SigninDevice, SigninPending } from '../../lib/api';
import { SignInPanel } from './SignInPanel';

// WHICH BROWSERS ARE SIGNED IN, and the requests waiting to be let in. Hook-driven: it reads `/api/signin`
// on mount, so it exists only through the route stub.
//
// BOTH LISTS ARE SEPARATE STORIES BECAUSE THEY ARE DIFFERENT DECISIONS. A pending request is a question
// somebody has to answer now; a signed-in device is a thing to revoke later. Rendering one fixture with
// both populated hides that the panel has to read correctly with either one empty.
//
// `.signin-row` LIVES IN `organisms/shared/` and it is the odd one there: its declarations are
// display/align/gap/padding/border — that is a `Row`, not a type face — and its own comment admits it
// re-declares three of `.vb-row`'s at equal specificity and wins only on sheet order. Named here because
// this is the surface a reader would come to look at it on.

// ANNOTATED, and it is load-bearing: a `RouteTable` value is `object`, so an un-annotated literal handed to
// the stub is checked by nothing. Written un-annotated first, and both of these carried a `current` and an
// `at` that `SigninDevice` does not have while every typecheck passed.
const devices: SigninDevice[] = [
  {
    id: 'd-1',
    label: 'Chromium on Linux',
    address: '192.168.1.24',
    created: '2026-08-20T11:00:00.000Z',
    lastSeen: '2026-08-23T09:19:00.000Z',
  },
  {
    id: 'd-2',
    label: 'Safari on iOS',
    address: '192.168.1.31',
    created: '2026-08-22T19:44:00.000Z',
    lastSeen: '2026-08-22T20:10:00.000Z',
  },
];

const pending: SigninPending[] = [
  { id: 'q-1', label: 'Firefox on Linux', address: '192.168.1.44', at: '2026-08-23T09:18:00.000Z' },
];

const meta = {
  title: 'Organisms/Sign-in panel',
  component: SignInPanel,
  decorators: [withRoutes({ ...EMPTY, '/api/signin': { pending, devices, thisDevice: 'd-1' } })],
  args: { confirm: async () => true },
} satisfies Meta<typeof SignInPanel>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// NOTHING WAITING, which is the ordinary state: one device signed in and no question to answer.
export const NoRequests: Story = {
  decorators: [withRoutes({ ...EMPTY, '/api/signin': { pending: [], devices, thisDevice: 'd-1' } })],
};

// THE FIRST BROWSER EVER, before anything has been signed in at all.
export const Nothing: Story = { decorators: [withRoutes(EMPTY)] };
