import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import {
  allSettled,
  blockedUnder,
  derivedStatus,
  hasUnfinishedChildren,
  isSettled,
} from '../src/core/derived-status.js';
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
  // Only engineering has a blocked column, so `blocked` elsewhere is a folder nothing puts a card in.
  it('does not count a product card in a blocked column as settled', () =>
    expect(isSettled(ap, p('P-001', 'blocked'))).toBe(false));

  it('settles a story whose tasks are one done and one blocked', () => {
    expect(allSettled(ap, [t('E-001', 'done'), t('E-002', 'blocked')])).toBe(true);
  });
  // A fixture of ONE cannot distinguish "all settled" from "any settled".
  it('does not settle a story with one done task and one in review', () => {
    expect(allSettled(ap, [t('E-001', 'done'), t('E-002', 'review')])).toBe(false);
  });
  // Vacuous truth is the failure Principle 1 is named for.
  it('does not settle a card with no children at all', () => expect(allSettled(ap, [])).toBe(false));
});

describe('derived status', () => {
  it('says a story is carrying a problem when a task under it is blocked', () => {
    const cards = [p('P-001', 'in-progress', ['E-001']), t('E-001', 'blocked')];
    expect(derivedStatus(ap, cards[0], cards)).toBe('carrying-a-problem');
  });

  it('says a feature is carrying a problem when a story under it is', () => {
    // Two levels: F-001 -> P-001 -> E-001 blocked. A one-level walk calls the feature clean.
    const cards = [
      f('F-001', 'in-progress', ['P-001']),
      p('P-001', 'done', ['E-001']),
      t('E-001', 'blocked'),
    ];
    expect(derivedStatus(ap, cards[0], cards)).toBe('carrying-a-problem');
  });

  it('says a story is clean when every task is done', () => {
    const cards = [p('P-001', 'done', ['E-001', 'E-002']), t('E-001', 'done'), t('E-002', 'done')];
    expect(derivedStatus(ap, cards[0], cards)).toBe('clean');
  });

  it('says a childless card is clean', () => {
    const cards = [p('P-001', 'backlog')];
    expect(derivedStatus(ap, cards[0], cards)).toBe('clean');
  });

  // IT SELF-HEALS, which is the second and more important reason for deriving it (decision 46).
  it('reports clean again once the blocked task is moved to done', () => {
    const blocked = [
      f('F-001', 'in-progress', ['P-001']),
      p('P-001', 'done', ['E-001']),
      t('E-001', 'blocked'),
    ];
    expect(derivedStatus(ap, blocked[0], blocked)).toBe('carrying-a-problem');
    const fixed = [f('F-001', 'in-progress', ['P-001']), p('P-001', 'done', ['E-001']), t('E-001', 'done')];
    expect(derivedStatus(ap, fixed[0], fixed)).toBe('clean');
  });

  it('ignores an archived blocked task', () => {
    const cards = [
      p('P-001', 'done', ['E-001']),
      { ...t('E-001', 'blocked'), archived: '2026-08-13T00:00:00Z' },
    ];
    expect(derivedStatus(ap, cards[0], cards)).toBe('clean');
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

  // The blocked task IS the fact (decision 46): a parent derives its problem from it, and a field on the
  // task saying so about itself would be the copy that can disagree with the board.
  it('does not call a blocked task itself carrying a problem', () => {
    const cards = [t('E-001', 'blocked')];
    expect(derivedStatus(ap, cards[0], cards)).toBe('clean');
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
