import { describe, expect, it } from 'vitest';
import { boardRel, RUNS_DIR, skillRel } from '../src/core/layout.js';
import { phase, phaseForRun } from '../src/core/phases.js';
import type { Skill } from '../src/core/skills.js';
import type { BoardName, Card } from '../src/core/types.js';
import { type BoardColumns, buildRunPrompt, type PromptInputs } from '../src/server/runs/prompt/index.js';

// EXPRESS MODE, AND THE ONE THING IT CHANGES.
//
// `autopilot.mode` selects between two behaviours written in code, never a table a person edits — ruling 52
// holds, and the phase table, the walker and every bound are identical under both. What differs is how coarse
// the cards the CREATING phases are asked for are.
//
// Measured before it was built, on a throwaway project with the same README and the same backend, with these
// paragraphs pasted into the project's own skill files by hand: 24 runs against 80, $14.06 against $41.07,
// 12 cards against 39, and a product that passes its smoke test either way.

const ROOT = '/p';

const boardColumns: BoardColumns[] = [
  { board: 'features', columns: [{ name: 'Backlog', slug: 'backlog' }] },
  { board: 'product', columns: [{ name: 'Backlog', slug: 'backlog' }] },
  { board: 'engineering', columns: [{ name: 'Backlog', slug: 'backlog' }] },
];

// The skill's SLUG is what resolves the phase, so it has to be the real one from the table rather than a
// name invented here — that is the whole mechanism under test.
const skillNamed = (slug: string): Skill => ({
  slug,
  path: skillRel(slug, 'SKILL.md'),
  name: slug,
  description: slug,
  boards: [],
  columns: [],
  // The seeded break-down says "one acceptance criterion per card" in its own words. Express contradicts
  // that on purpose, which is why the ordering assertion below is not cosmetic.
  prompt: 'One acceptance criterion per card.',
});

const card = (board: BoardName): Card =>
  ({
    id: 'X-001',
    title: 'A card',
    description: '',
    board,
    columnSlug: 'backlog',
    order: 10,
    tags: [],
    links: [],
    created: '2026-09-05',
    body: '',
    filePath: `${ROOT}/${boardRel(board, 'backlog', 'X-001.md')}`,
  }) as Card;

const build = (over: Partial<PromptInputs>): string =>
  buildRunPrompt({
    skill: skillNamed('break-down'),
    boardColumns,
    linked: [],
    attachments: [],
    links: [],
    reportPath: `${RUNS_DIR}/r1.report.md`,
    runId: 'r1',
    projectRoot: ROOT,
    // Nothing here is about the box; the web layer is the default image, so this is the ordinary box.
    browser: true,
    ...over,
  });

const HEADING = '## How this project sizes its cards';

describe('the express section', () => {
  it('is absent entirely on a standard project', () => {
    // The rule this prompt already follows: a heading over nothing is worse than no heading, and a standard
    // project must read exactly as it did before this key existed.
    const text = build({ card: card('features') });
    expect(text).not.toContain(HEADING);
    expect(text).not.toMatch(/express/i);
  });

  it('asks a feature break-down for one story per bullet', () => {
    const text = build({ card: card('features'), express: true });
    expect(text).toContain(HEADING);
    expect(text).toMatch(/one story per bullet/i);
    // The sentence that does the work: told only that the project "prefers larger cards", a break-down
    // splits anyway the moment a card looks awkward, and each split is a full implement/gates/review cycle.
    expect(text).toMatch(/not one per acceptance criterion/i);
  });

  it('asks a story break-down for exactly one task', () => {
    const text = build({ card: card('product'), express: true });
    expect(text).toMatch(/exactly one task/i);
  });

  it('asks the bootstrap for one feature card covering the whole product', () => {
    // No card at all: the bootstrap is the one card-less phase, and `phaseForRun` resolves it on the
    // absent board rather than on the skill alone.
    const text = build({ skill: skillNamed('derive-features'), express: true });
    expect(text).toMatch(/one feature card for the whole product/i);
  });

  // THE PHASE IS RESOLVED THE SAME WAY THE CREATE ENDPOINT RESOLVES IT — on skill AND board. `break-down`
  // is two phases with different products, so matching on the skill alone would hand a story's break-down
  // the feature's instruction and ask for stories where tasks belong.
  it('gives a feature and a story break-down different instructions, from the same skill', () => {
    const asFeature = build({ card: card('features'), express: true });
    const asStory = build({ card: card('product'), express: true });
    expect(phaseForRun('break-down', 'features')?.name).toBe('feature-breakdown');
    expect(phaseForRun('break-down', 'product')?.name).toBe('story-breakdown');
    expect(asFeature).not.toEqual(asStory);
    expect(asFeature).not.toMatch(/exactly one task/i);
    expect(asStory).not.toMatch(/one story per bullet/i);
  });

  // A phase express says nothing about gets nothing. An implement run sized by a section about breaking
  // down is a section about the wrong subject, and the reader has no way to know it does not apply.
  it('says nothing to a phase it has no size for', () => {
    const text = build({
      skill: skillNamed(phase('story-implement').skill ?? ''),
      card: card('product'),
      express: true,
    });
    expect(text).not.toContain(HEADING);
  });

  // THE ORDER IS THE BEHAVIOUR, and it is the reason this section is spliced rather than pushed. The skill's
  // own body says "one acceptance criterion per card"; express contradicts it, so it must be read AFTER the
  // sentence it overrides. Placed above the skill body it would be the instruction the agent reasons past.
  it('comes after the skill body it overrides, and before the card', () => {
    const text = build({ card: card('features'), express: true });
    const skillAt = text.indexOf('One acceptance criterion per card.');
    const expressAt = text.indexOf(HEADING);
    const cardAt = text.indexOf('## The card: X-001');
    expect(skillAt).toBeGreaterThanOrEqual(0);
    expect(expressAt).toBeGreaterThan(skillAt);
    expect(cardAt).toBeGreaterThan(expressAt);
  });
});
