import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { ARCHIVE_SLUG } from '../src/core/layout.js';
import { setupFeature, setupIsFinished, setupSubtreeIds } from '../src/core/setup-feature.js';
import type { BoardName, Card } from '../src/core/types.js';

function card(id: string, board: BoardName, columnSlug: string, links: string[], setup?: boolean): Card {
  return {
    id,
    title: id,
    order: 10,
    tags: [],
    links,
    created: '2026-08-02',
    board,
    columnSlug,
    body: '',
    filePath: `/tmp/${id}.md`,
    ...(setup ? { setup: true } : {}),
  };
}

// F-001 (setup) -> P-001 -> E-001, E-002.   F-002 -> P-002 -> E-003.
// Two features, so "inside the subtree" can be distinguished from "on the board at all" — a fixture
// with one feature would pass against a function that returned every card.
const cards = (): Card[] => [
  card('F-001', 'features', 'in-progress', ['P-001'], true),
  card('F-002', 'features', 'backlog', ['P-002']),
  card('P-001', 'product', 'in-progress', ['F-001', 'E-001', 'E-002']),
  card('P-002', 'product', 'backlog', ['F-002']),
  card('E-001', 'engineering', 'done', ['P-001']),
  card('E-002', 'engineering', 'backlog', ['P-001']),
  card('E-003', 'engineering', 'backlog', ['P-002']),
];

const TERMINAL = DEFAULT_AUTOPILOT.terminal;

describe('the setup feature barrier', () => {
  it('finds the flagged feature, and only on the features board', () => {
    expect(setupFeature(cards())?.id).toBe('F-001');
    // A flag on a product card is not a barrier: the hierarchy starts at features.
    const misplaced = cards().map((c) =>
      c.id === 'P-002' ? { ...c, setup: true } : { ...c, setup: undefined },
    );
    expect(setupFeature(misplaced)).toBeUndefined();
  });

  it('walks the hierarchy down two boards to name every card inside the barrier', () => {
    expect([...setupSubtreeIds(cards())].sort()).toEqual(['E-001', 'E-002', 'F-001', 'P-001']);
  });

  // Links are symmetric, so P-001 links back to F-001 and forward to its engineering children. The
  // walk has to use the BOARD to tell a parent from a child, or it would climb back up and drag the
  // whole graph in.
  it('does not follow a link back up the hierarchy', () => {
    const ids = setupSubtreeIds(cards());
    expect(ids.has('F-002')).toBe(false);
    expect(ids.has('E-003')).toBe(false);
  });

  it('is unfinished while any card in the subtree is outside a terminal column', () => {
    expect(setupIsFinished(cards(), TERMINAL)).toBe(false);

    const engineeringDone = cards().map((c) =>
      c.board === 'engineering' ? { ...c, columnSlug: 'done' } : c,
    );
    // The parents are still in progress, so the barrier is not lifted by its children alone.
    expect(setupIsFinished(engineeringDone, TERMINAL)).toBe(false);

    const allDone = engineeringDone.map((c) =>
      ['F-001', 'P-001'].includes(c.id) ? { ...c, columnSlug: 'done' } : c,
    );
    expect(setupIsFinished(allDone, TERMINAL)).toBe(true);
  });

  // Terminal is per board, so a subtree spanning three boards has to ask each card's own board.
  it('asks each board for its own terminal columns', () => {
    const allDone = cards().map((c) =>
      setupSubtreeIds(cards()).has(c.id) ? { ...c, columnSlug: 'done' } : c,
    );
    expect(setupIsFinished(allDone, TERMINAL)).toBe(true);
    // Engineering finishes somewhere else now, and the engineering children are no longer terminal.
    expect(setupIsFinished(allDone, { ...TERMINAL, engineering: ['shipped'] })).toBe(false);
  });

  it('excludes an archived child from the subtree entirely — it neither blocks nor satisfies', () => {
    const archived = cards().map((c) =>
      c.id === 'E-002' ? { ...c, columnSlug: ARCHIVE_SLUG, archived: '2026-08-02T10:00:00Z' } : c,
    );
    expect(setupSubtreeIds(archived).has('E-002')).toBe(false);
    // E-002 was the only unfinished engineering card, so archiving it must not be what completes the
    // barrier — its parents are still in progress.
    expect(setupIsFinished(archived, TERMINAL)).toBe(false);
  });

  it('ignores an archived feature that still carries the flag', () => {
    const archived = cards().map((c) =>
      c.id === 'F-001' ? { ...c, columnSlug: ARCHIVE_SLUG, archived: '2026-08-02T10:00:00Z' } : c,
    );
    expect(setupFeature(archived)).toBeUndefined();
    expect(setupSubtreeIds(archived).size).toBe(0);
  });

  it('treats a link to a card that does not exist as no child at all', () => {
    const dangling = [card('F-001', 'features', 'backlog', ['P-404'], true)];
    expect([...setupSubtreeIds(dangling)]).toEqual(['F-001']);
    expect(setupIsFinished(dangling, TERMINAL)).toBe(false); // the feature itself is not terminal
  });

  // The one place absence is deliberately NOT a blocker: an adopted repo, or a board someone built by
  // hand, must not be frozen out of its own lifecycle by a card nobody wrote.
  it('has no barrier, and no barrier is not an unfinished barrier', () => {
    expect(setupFeature([])).toBeUndefined();
    expect(setupIsFinished([], TERMINAL)).toBe(true);
    const unflagged = cards().map((c) => ({ ...c, setup: undefined }));
    expect(setupIsFinished(unflagged, TERMINAL)).toBe(true);
  });
});
