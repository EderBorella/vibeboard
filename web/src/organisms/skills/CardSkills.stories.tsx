import type { Meta, StoryObj } from '@storybook/react-vite';
import type { InvalidSkill, Skill } from '../../lib/api';
import type { Card } from '../../lib/shared';
import { CardSkills } from './CardSkills';

// THE CARD'S ACTION RAIL, and it is here as the third prop-driven organism because it is the clearest
// case of a surface whose whole content is DERIVED: `skillsForCard` filters the catalogue by the card's
// board and column, so the story that matters is the one where the filter excludes everything. An empty
// rail and a rail whose skills are all for another column look identical on a screenshot and are two
// different bugs.
const card: Card = {
  id: 'C-042',
  title: 'The auto-pilot bar states why it stopped',
  order: 3,
  tags: ['ui'],
  links: [],
  created: '2026-08-14T09:12:00.000Z',
  board: 'features',
  columnSlug: 'in-progress',
  body: '',
  filePath: 'boards/features/in-progress/C-042.md',
};

const skill = (slug: string, name: string, columns: string[]): Skill => ({
  slug,
  path: `.vibeboard/skills/${slug}.md`,
  name,
  description: 'What this skill does to the project, in one line a person can decide on.',
  boards: ['features'],
  columns,
  prompt: '',
  autopilotOnly: false,
  moveOnSuccess: true,
});

const invalid: InvalidSkill[] = [
  {
    slug: 'reword-the-readme',
    path: '.vibeboard/skills/reword-the-readme.md',
    reason: 'no `boards:` key, so it would apply to everything',
  },
];

const meta = {
  title: 'Organisms/Card skills',
  component: CardSkills,
  args: {
    card,
    skills: [
      skill('derive-features', 'Derive features', ['in-progress']),
      skill('write-the-tests-first', 'Write the tests first', ['in-progress']),
      skill('review-against-the-spec', 'Review against the spec', ['in-progress', 'review']),
    ],
    invalid: [],
    onRun: () => {},
  },
} satisfies Meta<typeof CardSkills>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// NOTHING APPLIES HERE, which is not the same as nothing existing. The catalogue is full and every skill
// in it is scoped to another column — the rail has to say which of the two it is.
export const NoneForThisColumn: Story = { args: { card: { ...card, columnSlug: 'done' } } };

// A SKILL FILE THAT FAILED VALIDATION IS COUNTED RATHER THAN SWALLOWED: a skill that silently never
// appears is indistinguishable from one nobody wrote.
export const WithInvalid: Story = { args: { invalid } };

// NO `onRun`, which is an archived card: a run edits the project and reports against a card that is not
// on the board, so there would be nowhere for the result to show.
export const ReadOnly: Story = { args: { onRun: undefined } };
