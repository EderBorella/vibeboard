// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CardSkills } from '../web/src/components/CardSkills.js';
import { SKILL_ACTIONS } from '../web/src/dock/skills.js';
import type { Card } from '../web/src/shared.js';

afterEach(cleanup);

const card: Card = {
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
} as Card;

describe('CardSkills', () => {
  const actions = (): HTMLButtonElement[] =>
    [...document.querySelectorAll<HTMLButtonElement>('.cs-action')];

  it('offers one action per skill in the catalogue, in its order', () => {
    render(<CardSkills card={card} />);
    expect(actions().map((b) => b.textContent)).toEqual(SKILL_ACTIONS.map((a) => a.label));
  });

  it('disables every action, so none of them can pretend to run', () => {
    // The point of the rail today is the space and the wiring point. A live-looking button that
    // does nothing reads as a broken feature.
    render(<CardSkills card={card} />);
    const buttons = actions();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(screen.getByText('Not wired up yet.')).toBeTruthy();
  });

  it('says on hover what each action will do, and that it does not yet', () => {
    render(<CardSkills card={card} />);
    expect(actions().map((b) => b.getAttribute('title'))).toEqual(
      SKILL_ACTIONS.map((a) => `${a.hint} — not wired up yet`),
    );
  });

  it('names the card it would act on', () => {
    // The actions are per-card, so the rail has to say which one — it is the only thing on screen
    // that distinguishes acting on this card from acting on the project.
    render(<CardSkills card={card} />);
    expect(screen.getByLabelText('Skills for E-001')).toBeTruthy();
    expect(screen.getByText('Skills').className).toBe('cs-head');
  });
});

describe('SKILL_ACTIONS', () => {
  it('gives every action a distinct id, label and hint', () => {
    // Duplicate ids would collide as React keys; a blank label or hint would render an unlabelled
    // button. Cheap to assert now, and it is the list a future contributor will extend.
    const ids = SKILL_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SKILL_ACTIONS.every((a) => a.label !== '' && a.hint !== '')).toBe(true);
  });
});
