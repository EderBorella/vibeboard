import { describe, expect, it } from 'vitest';
import { type AutopilotConfig, DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { ARCHIVE_SLUG } from '../src/core/layout.js';
import { rollupOutcomes } from '../src/core/rollup.js';
import type { BoardName, Card } from '../src/core/types.js';

function card(id: string, board: BoardName, columnSlug: string, links: string[]): Card {
  return {
    id,
    title: id,
    order: 10,
    tags: [],
    links,
    created: '2026-08-05',
    board,
    columnSlug,
    body: '',
    filePath: `/tmp/${id}.md`,
  };
}

// Two trees, so "in the rule's column" can be told apart from "on the board at all". F-001's subtree
// is complete down to engineering; F-002's has not started.
//
//   F-001 features/in-progress → P-001 product/in-progress → E-001 done, E-002 done
//   F-002 features/in-progress → P-002 product/backlog
const cards = (): Card[] => [
  card('F-001', 'features', 'in-progress', ['P-001']),
  card('P-001', 'product', 'in-progress', ['F-001', 'E-001', 'E-002']),
  card('E-001', 'engineering', 'done', ['P-001']),
  card('E-002', 'engineering', 'done', ['P-001']),
  card('F-002', 'features', 'in-progress', ['P-002']),
  card('P-002', 'product', 'backlog', ['F-002']),
];

const ap = DEFAULT_AUTOPILOT;

// The two default rules, named here so a test can say which one it is about:
//   product/in-progress   → advance to done
//   features/in-progress  → eligible
const change = (cards: Card[], id: string, patch: Partial<Card>): Card[] =>
  cards.map((c) => (c.id === id ? { ...c, ...patch } : c));

const archive = (cards: Card[], id: string): Card[] =>
  change(cards, id, { columnSlug: ARCHIVE_SLUG, archived: '2026-08-05T10:00:00Z' });

describe('what a rollup does', () => {
  it('advances a product card whose engineering children are all terminal', () => {
    const { advance, eligible } = rollupOutcomes(ap, cards());
    expect(advance.map((a) => [a.card.id, a.to])).toEqual([['P-001', 'done']]);
    // F-001's child P-001 is still in progress, so the features rule has nothing to say yet.
    expect(eligible).toEqual([]);
  });

  it('does nothing while one child is not terminal', () => {
    const { advance } = rollupOutcomes(ap, change(cards(), 'E-002', { columnSlug: 'backlog' }));
    expect(advance).toEqual([]);
  });

  // S2: a rollup over an empty set is vacuously true, so a card nobody has broken down would have
  // completed itself — the exact shape of "success reported over work that does not exist".
  it('does nothing for a childless card', () => {
    const childless = [card('P-009', 'product', 'in-progress', [])];
    expect(rollupOutcomes(ap, childless)).toEqual({ advance: [], eligible: [] });
  });

  // S3: an archived child is excluded from the check entirely, which makes this the childless case
  // rather than a satisfied one.
  //
  // This case does NOT constrain the exclusion on its own, verified by planting: archiving also moves
  // the card to `archive/`, which is not a terminal column, so it fails the terminal check even when
  // the exclusion is deleted. The test below it is the one that holds the exclusion in place.
  it('does nothing for a card whose only children are archived', () => {
    let board = archive(cards(), 'E-001');
    board = archive(board, 'E-002');
    expect(rollupOutcomes(ap, board).advance).toEqual([]);
  });

  it('advances when the only live child is terminal and the other is archived', () => {
    const board = archive(cards(), 'E-001');
    expect(rollupOutcomes(ap, board).advance.map((a) => a.card.id)).toEqual(['P-001']);
  });

  it('makes a features card eligible and never advances it — a feature earns its close-out', () => {
    // P-001 in done: the product rule no longer matches its column, and F-001's only child is terminal.
    const { advance, eligible } = rollupOutcomes(ap, change(cards(), 'P-001', { columnSlug: 'done' }));
    expect(eligible).toEqual(['F-001']);
    expect(advance).toEqual([]);
  });

  it('ignores a card outside the rule’s column, however terminal its children', () => {
    const { advance } = rollupOutcomes(ap, change(cards(), 'P-001', { columnSlug: 'todo' }));
    expect(advance).toEqual([]);
  });

  it('ignores an archived parent', () => {
    // `archived` set while the path still says in-progress is a half-written file, not a state the UI
    // produces — but rolling one up would advance a card out of the archive.
    const board = change(cards(), 'P-001', { archived: '2026-08-05T10:00:00Z' });
    expect(rollupOutcomes(ap, board).advance).toEqual([]);
  });

  // Fail closed (Principle 1): the cover check refuses this config on the way in, but a rule that
  // reached here without its destination must move nothing rather than move a card to `undefined`.
  it('does nothing for an advance rule with no next column', () => {
    const broken: AutopilotConfig = {
      ...ap,
      rollup: [{ board: 'product', column: 'in-progress', when: 'all-children-terminal', action: 'advance' }],
    };
    expect(rollupOutcomes(broken, cards()).advance).toEqual([]);
  });

  it('reads the terminal columns from config rather than assuming done', () => {
    const shipped: AutopilotConfig = { ...ap, terminal: { ...ap.terminal, engineering: ['shipped'] } };
    expect(rollupOutcomes(shipped, cards()).advance).toEqual([]);
    const board = change(change(cards(), 'E-001', { columnSlug: 'shipped' }), 'E-002', {
      columnSlug: 'shipped',
    });
    expect(rollupOutcomes(shipped, board).advance.map((a) => a.card.id)).toEqual(['P-001']);
  });

  it('treats a link to a card that does not exist as no child at all', () => {
    const dangling = [card('P-009', 'product', 'in-progress', ['E-404'])];
    expect(rollupOutcomes(ap, dangling).advance).toEqual([]);
  });

  // Direction comes from the board, not from the link: links are symmetric, so P-001 lists its parent
  // F-001 alongside its children. A rule that counted every link would find F-001 non-terminal and
  // refuse the advance the first test asserts.
  it('does not mistake a parent link for a child', () => {
    const board = change(cards(), 'F-001', { columnSlug: 'backlog' });
    expect(rollupOutcomes(ap, board).advance.map((a) => a.card.id)).toEqual(['P-001']);
  });
});
