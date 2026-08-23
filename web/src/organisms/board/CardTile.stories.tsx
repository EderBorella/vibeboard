import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Card } from '../../lib/shared';
import { CardTile } from './CardTile';

// THE BOARD'S PRIMARY OBJECT, ON ITS OWN. A tile is the one surface in this app that is a fixed box
// (`--tile-h`, 112px) with an unbounded amount of user text inside it, so it is where a type step that is
// one size too large stops being an aesthetic question: the summary is clamped by CHARACTER COUNT
// (`miniatureChars`) rather than by a line clamp, because the board measures its own tracks.
//
// A TYPED LITERAL AND NOT A FIXTURE MODULE, and the reason is worth stating because the plan for these
// stories said otherwise: it said to use "the fixture data the browser harness already builds in
// `visual/support/fixtures.ts`", and that file builds NO app data — it is the Playwright theme, baseline
// and credential module, and `visual/run.mjs` scaffolds a real project on disk through the product's own
// writers. There is nothing there to import. A `Card` is fourteen fields; a literal that the compiler
// checks against `web/src/lib/shared.ts` is both cheaper and stricter than a fixture builder.
const card: Card = {
  id: 'C-042',
  title: 'The auto-pilot bar states why it stopped',
  description: 'A stop sentence a person can act on, rather than a status word.',
  order: 3,
  tags: ['ui', 'autopilot'],
  links: ['C-018'],
  group: 'Auto-pilot',
  created: '2026-08-14T09:12:00.000Z',
  board: 'features',
  columnSlug: 'in-progress',
  body: 'The bar says "stalled" and nothing else, so the only way to find out why is to read the runs.',
  filePath: 'boards/features/in-progress/C-042.md',
};

const meta = {
  title: 'Organisms/Board tile',
  component: CardTile,
  args: { card, miniatureChars: 120, onOpen: () => {}, onTag: () => {}, onArchive: () => {} },
  argTypes: { miniatureChars: { control: { type: 'range', min: 40, max: 240, step: 10 } } },
} satisfies Meta<typeof CardTile>;
export default meta;

type Story = StoryObj<typeof meta>;

// The ordinary case, and the one the board is mostly made of.
export const Clean: Story = {};

// THE THREE BADGES, WHICH ARE THE ONLY THINGS ON A TILE THAT ARE NOT THE CARD'S OWN WORDS. Each says
// something a person cannot see from the column the tile is in: work found and not done, a blocked card
// carried underneath, and the project-level barrier. They stack inside a 112px box, which is why every
// marker in this app is `--mark-h` (16px) and not `--ctl-h`.
export const Loaded: Story = {
  args: {
    card: { ...card, setup: true, followUp: true },
    openSuggestions: 3,
    carryingAProblem: ['C-051', 'C-052'],
  },
};

// NO `onOpen` AND NO `onTag`, which is the archive drawer's tile. It is not a disabled tile — it is a
// region with nothing to operate, so it leaves the tab order entirely and its tags stop being buttons.
export const ReadOnly: Story = {
  args: {
    card: { ...card, archived: '2026-08-19T17:40:00.000Z', archivedFrom: 'done' },
    onOpen: undefined,
    onTag: undefined,
    onArchive: undefined,
  },
};

// THE CASE THAT BREAKS BOXES: a title with no spaces in it. A card title is arbitrary user text and
// several real ones are file paths, so a tile that sets its own minimum content width pushes its track
// past its share and takes the whole grid with it.
export const Unbroken: Story = {
  args: {
    card: {
      ...card,
      title: 'docs/superpowers/plans/2026-08-14-refactor-structure-and-layers.md',
      tags: ['a-very-long-tag-nobody-would-write', 'ui'],
    },
  },
};
