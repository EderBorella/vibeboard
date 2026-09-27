// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { skillRel } from '../src/core/layout.js';
import type { InvalidSkill, Skill } from '../web/src/lib/api.js';
import type { Card } from '../web/src/lib/shared.js';
import { CardSkills } from '../web/src/organisms/skills/CardSkills.js';

afterEach(cleanup);

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'E-001',
    title: 'a card',
    board: 'engineering',
    columnSlug: 'todo',
    order: 0,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: '',
    filePath: '/tmp/E-001.md',
    ...over,
  }) as Card;

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: 'execute',
  path: skillRel('execute', 'SKILL.md'),
  name: 'Execute',
  description: 'Implement the card',
  boards: [],
  columns: [],
  prompt: 'p',
  autopilotOnly: false,
  moveOnSuccess: true,
  ...over,
});

// `[data-testid]`, not `.cs-action`: the class is `text-align: left` now; Button owns the box.
const actions = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('[data-testid="cs-action"]'),
];

describe('CardSkills', () => {
  it('offers one action per skill, labelled and hinted by the file', () => {
    render(
      <CardSkills
        card={card()}
        skills={[skill(), skill({ slug: 'review', name: 'Review', description: 'Critique it' })]}
        invalid={[]}
        onRun={vi.fn()}
      />,
    );
    expect(actions().map((b) => b.textContent)).toEqual(['Execute', 'Review']);
    expect(actions()[1].getAttribute('title')).toBe('Critique it');
  });

  it('shows only the skills scoped to this card', () => {
    const skills = [
      skill({ slug: 'anywhere', name: 'Anywhere' }),
      skill({ slug: 'prod', name: 'Prod', boards: ['product'] }),
      skill({ slug: 'done', name: 'Done only', columns: ['done'] }),
    ];
    render(
      <CardSkills card={card({ board: 'engineering', columnSlug: 'todo' })} skills={skills} invalid={[]} />,
    );
    expect(actions().map((b) => b.textContent)).toEqual(['Anywhere']);
  });

  it('runs the skill it was clicked on', () => {
    const onRun = vi.fn();
    const review = skill({ slug: 'review', name: 'Review' });
    render(<CardSkills card={card()} skills={[skill(), review]} invalid={[]} onRun={onRun} />);
    fireEvent.click(actions()[1]);
    expect(onRun.mock.calls).toEqual([[review]]);
  });

  it('disables every action for an archived card, and says why', () => {
    // A run edits the project and reports against a card that is not on the board, so there would
    // be nowhere for the result to show.
    render(<CardSkills card={card()} skills={[skill()]} invalid={[]} />);
    expect(actions().every((b) => b.disabled)).toBe(true);
    expect(actions()[0].getAttribute('title')).toBe('Implement the card — archived cards cannot be run');
  });

  it('enables the actions when a run handler is given', () => {
    render(<CardSkills card={card()} skills={[skill()]} invalid={[]} onRun={vi.fn()} />);
    expect(actions().every((b) => b.disabled)).toBe(false);
  });

  it('says so when no skill fits this column, and where to add one', () => {
    render(<CardSkills card={card()} skills={[skill({ boards: ['product'] })]} invalid={[]} />);
    expect(actions()).toHaveLength(0);
    expect(screen.getByText('No skills for this column. Add one in Project Control → Skills.')).toBeTruthy();
    // The POSITIVE half of the negative below: a `toBeNull()` on a hook nothing ever renders passes for
    // the wrong reason, which is the fixture-too-thin failure this repository has recorded twice.
    expect(document.querySelector('[data-testid="cs-empty"]')).not.toBeNull();
  });

  it('shows no empty state when the card does have skills', () => {
    render(<CardSkills card={card()} skills={[skill()]} invalid={[]} />);
    // A `data-testid` and not `.cs-empty`: the class held one `margin-top`, the rail's `gap` says it now,
    // and a test that selects on a class the sweep deletes turns a visual fix into a red suite.
    expect(document.querySelector('[data-testid="cs-empty"]')).toBeNull();
  });

  it('counts invalid skill files and names each reason on hover', () => {
    const invalid: InvalidSkill[] = [
      { slug: 'a', path: skillRel('a', 'SKILL.md'), reason: 'needs a description' },
      { slug: 'b', path: skillRel('b', 'SKILL.md'), reason: 'unknown board "backlog"' },
    ];
    render(<CardSkills card={card()} skills={[skill()]} invalid={invalid} />);
    const warn = screen.getByText(/2 skill files invalid/);
    expect(warn.getAttribute('title')).toBe(
      `${skillRel('a', 'SKILL.md')}: needs a description\n${skillRel('b', 'SKILL.md')}: unknown board "backlog"`,
    );
  });

  it('says "file" not "files" for one', () => {
    render(<CardSkills card={card()} skills={[skill()]} invalid={[{ slug: 'a', path: 'p', reason: 'r' }]} />);
    expect(screen.getByText(/1 skill file invalid/)).toBeTruthy();
  });

  it('shows no warning when every file is valid', () => {
    render(<CardSkills card={card()} skills={[skill()]} invalid={[]} />);
    expect(document.querySelector('.cs-invalid')).toBeNull();
  });

  it('names the card it would act on', () => {
    render(<CardSkills card={card({ id: 'E-042' })} skills={[skill()]} invalid={[]} />);
    expect(screen.getByLabelText('Skills for E-042')).toBeTruthy();
    // A `Text as="h3" caps` AND NOTHING ELSE: the display face, the step, the muted ink and the
    // `margin: 0` are the atom's, and `.cs-head`'s 2px under this one line is the rail's `gap` now — one
    // child asking for its own room is what a uniform column replaces. Asserted as the whole class list
    // rather than with a substring, because a dropped `caps` is exactly what a substring would miss, and
    // an exact list is also what says the class did not quietly come back.
    expect(screen.getByText('Skills').className).toBe('vb-text vb-text-caps');
  });
});
