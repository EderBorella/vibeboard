import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { allSettled, blockedUnder, hasUnfinishedChildren, isSettled } from '../src/core/derived-status.js';
import type { BoardName, Card } from '../src/core/types.js';

const ap = DEFAULT_AUTOPILOT;

function card(board: BoardName, id: string, columnSlug: string, links: string[] = []): Card {
  return {
    id,
    title: id,
    order: 10,
    tags: [],
    links,
    created: '2026-08-13',
    board,
    columnSlug,
    body: '',
    filePath: `/tmp/${id}.md`,
  };
}

const f = (id: string, columnSlug = 'in-progress', links: string[] = []): Card =>
  card('features', id, columnSlug, links);
const p = (id: string, columnSlug = 'in-progress', links: string[] = []): Card =>
  card('product', id, columnSlug, links);
const t = (id: string, columnSlug: string, links: string[] = []): Card =>
  card('engineering', id, columnSlug, links);

describe('settled', () => {
  it('counts a blocked task as settled', () => expect(isSettled(ap, t('E-001', 'blocked'))).toBe(true));
  it('counts a done task as settled', () => expect(isSettled(ap, t('E-001', 'done'))).toBe(true));
  it('does not count a task in review as settled', () =>
    expect(isSettled(ap, t('E-001', 'review'))).toBe(false));
  // DECISION 45's 2026-08-13 CORRECTION, at the story's own level: a story nobody can break down has had
  // every attempt it is allowed, so it settles and its feature carries on with the next story.
  it('counts a blocked story as settled', () => expect(isSettled(ap, p('P-001', 'blocked'))).toBe(true));
  // And features has no blocked column at all: a feature has no sibling to carry on with, so a `blocked`
  // folder on that board is one nothing puts a card in.
  it('does not count a feature in a blocked column as settled', () =>
    expect(isSettled(ap, f('F-001', 'blocked'))).toBe(false));

  it('settles a story whose tasks are one done and one blocked', () => {
    expect(allSettled(ap, [t('E-001', 'done'), t('E-002', 'blocked')])).toBe(true);
  });

  // WHAT THE FEATURE CHECKUP'S TRIGGER IS ASKED, one level up: a feature holding a done story and a
  // blocked one is settled, so the checkup runs and the feature can close carrying the problem. Two
  // stories, because a fixture of one cannot tell "all settled" from "any settled".
  it('settles a feature whose stories are one done and one blocked', () => {
    expect(allSettled(ap, [p('P-001', 'done'), p('P-002', 'blocked')])).toBe(true);
  });
  // A fixture of ONE cannot distinguish "all settled" from "any settled".
  it('does not settle a story with one done task and one in review', () => {
    expect(allSettled(ap, [t('E-001', 'done'), t('E-002', 'review')])).toBe(false);
  });
  // Vacuous truth is the failure Principle 1 is named for.
  it('does not settle a card with no children at all', () => expect(allSettled(ap, [])).toBe(false));
});

// THE ONE HOME FOR DECISION 46 (there was a `derivedStatus` beside it answering an enum over the same walk,
// with no caller: the wire needs the IDS, not a status, because a badge nobody can name a card in is one
// nobody can act on). Its six cases went with it; every case here is about the list.
describe('what is blocked under a card', () => {
  it('ignores an archived blocked task', () => {
    const cards = [
      p('P-001', 'done', ['E-001']),
      { ...t('E-001', 'blocked'), archived: '2026-08-13T00:00:00Z' },
    ];
    expect(blockedUnder(ap, cards[0], cards)).toEqual([]);
  });

  it('names every blocked task under a feature, through both levels', () => {
    const cards = [
      f('F-001', 'in-progress', ['P-001', 'P-002']),
      p('P-001', 'done', ['E-001']),
      t('E-001', 'blocked'),
      p('P-002', 'done', ['E-002', 'E-003']),
      t('E-002', 'done'),
      t('E-003', 'blocked'),
    ];
    expect(blockedUnder(ap, cards[0], cards).map((c) => c.id)).toEqual(['E-001', 'E-003']);
  });

  // DECISION 46 OVER A BLOCKED STORY. A feature carrying a story nobody could break down is carrying a
  // problem, exactly as one carrying a blocked task is — and the story has no children at all, which is
  // what a failed break-down leaves behind, so nothing below it could make this list non-empty.
  it('names a blocked story under its feature', () => {
    const cards = [f('F-001', 'in-progress', ['P-001', 'P-002']), p('P-001', 'done'), p('P-002', 'blocked')];
    expect(blockedUnder(ap, cards[0], cards).map((c) => c.id)).toEqual(['P-002']);
  });

  // A blocked story and a blocked task under the SAME feature, so the walk is not answering with the
  // first thing it finds — and the story that is blocked has no task under it to be found instead.
  it('names a blocked story and a blocked task together', () => {
    const cards = [
      f('F-001', 'in-progress', ['P-001', 'P-002']),
      p('P-001', 'done', ['E-001']),
      t('E-001', 'blocked'),
      p('P-002', 'blocked'),
    ];
    expect(blockedUnder(ap, cards[0], cards).map((c) => c.id)).toEqual(['E-001', 'P-002']);
  });
});

// RULING 62: its first tests ever, written against the CURRENT behaviour before it moves.
describe('hasUnfinishedChildren', () => {
  it('is false for a childless card', () => {
    // A UNIVERSAL QUANTIFIER, so it passes vacuously — deliberately, and this test is what says so:
    // a story nobody has broken down yet is exactly what the break-down phase is for.
    expect(hasUnfinishedChildren(ap, p('P-001'), [p('P-001')])).toBe(false);
  });

  it('is true when one of two children is not terminal', () => {
    const cards = [p('P-001', 'in-progress', ['E-001', 'E-002']), t('E-001', 'done'), t('E-002', 'review')];
    expect(hasUnfinishedChildren(ap, cards[0], cards)).toBe(true);
  });

  it('is false when every child is terminal', () => {
    const cards = [p('P-001', 'in-progress', ['E-001', 'E-002']), t('E-001', 'done'), t('E-002', 'done')];
    expect(hasUnfinishedChildren(ap, cards[0], cards)).toBe(false);
  });

  it('counts a blocked child as unfinished, because terminal is not settled', () => {
    // The distinction that makes this function DIFFERENT from allSettled, and the reason both exist:
    // `blocked` is not a terminal column (src/core/autopilot-cover.ts:236-240).
    const cards = [p('P-001', 'in-progress', ['E-001']), t('E-001', 'blocked')];
    expect(hasUnfinishedChildren(ap, cards[0], cards)).toBe(true);
    expect(allSettled(ap, [t('E-001', 'blocked')])).toBe(true);
  });

  it('ignores children on the wrong board', () => {
    // `childrenOf` filters by childBoardOf, so a product card linking a FEATURE has no child there.
    const cards = [p('P-001', 'in-progress', ['F-002']), f('F-002', 'backlog')];
    expect(hasUnfinishedChildren(ap, cards[0], cards)).toBe(false);
  });

  it('ignores an archived child', () => {
    const cards = [
      p('P-001', 'in-progress', ['E-001']),
      { ...t('E-001', 'review'), archived: '2026-08-13T00:00:00Z' },
    ];
    expect(hasUnfinishedChildren(ap, cards[0], cards)).toBe(false);
  });
});
