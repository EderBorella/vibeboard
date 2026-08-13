import { describe, expect, it } from 'vitest';
import { ARCHIVE_SLUG } from '../src/core/layout.js';
import {
  followUpCount,
  hasSetupFeature,
  openFollowUp,
  setupFeature,
  setupSubtreeIds,
} from '../src/core/setup-feature.js';
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

  it('excludes an archived child from the subtree entirely — it neither blocks nor satisfies', () => {
    const archived = cards().map((c) =>
      c.id === 'E-002' ? { ...c, columnSlug: ARCHIVE_SLUG, archived: '2026-08-02T10:00:00Z' } : c,
    );
    expect(setupSubtreeIds(archived).has('E-002')).toBe(false);
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
  });

  // The one place absence is deliberately NOT a blocker: an adopted repo, or a board someone built by
  // hand, must not be frozen out of its own lifecycle by a card nobody wrote.
  it('has no barrier, and no barrier is not an unfinished barrier', () => {
    expect(setupFeature([])).toBeUndefined();
    // A populated board with the flag nowhere on it is the same answer, which is what makes this about
    // the FLAG rather than about the board being empty.
    expect(setupFeature(cards().map((c) => ({ ...c, setup: undefined })))).toBeUndefined();
    expect(setupSubtreeIds(cards().map((c) => ({ ...c, setup: undefined }))).size).toBe(0);
  });
});

// "HAS THIS PROJECT EVER HAD A SCAFFOLDING FEATURE" — a different question from "which card is the barrier
// now", and it has to be, because they read different sets. Decision 50: scaffolding happens ONCE, and once is
// a board fact including a feature somebody archived afterwards.
describe('hasSetupFeature', () => {
  it('sees a setup feature that has been archived', () => {
    const archived = {
      ...card('F-001', 'features', ARCHIVE_SLUG, [], true),
      archived: '2026-08-13T00:00:00Z',
    };
    expect(hasSetupFeature([archived])).toBe(true);
  });

  it('is true for a live flagged feature', () => {
    // Two cases, because a function that answered `true` for everything would pass the archived one alone.
    expect(hasSetupFeature([card('F-001', 'features', 'in-progress', [], true)])).toBe(true);
  });

  it('is false for a board with no flagged card', () => {
    expect(hasSetupFeature(cards().map((c) => ({ ...c, setup: undefined })))).toBe(false);
  });

  it('is false for an empty board, which is where the bootstrap starts', () => {
    expect(hasSetupFeature([])).toBe(false);
  });

  it('ignores a flag on a card that is not a feature', () => {
    // The hierarchy starts at features, so a flagged story is not a scaffolding feature — and reading one as
    // one would withhold the stamp from the feature that should have had it.
    expect(hasSetupFeature([card('P-001', 'product', 'backlog', [], true)])).toBe(false);
  });

  it('leaves setupFeature reading LIVE cards only', () => {
    // Two questions, two functions. The subtree root for the reviewer's gate exception is a LIVE card — an
    // archived feature confines nothing — and only the "once" question reads the archive.
    const archived = {
      ...card('F-001', 'features', ARCHIVE_SLUG, [], true),
      archived: '2026-08-13T00:00:00Z',
    };
    expect(setupFeature([archived])).toBeUndefined();
    expect(hasSetupFeature([archived])).toBe(true);
  });
});

// THE ONE OPEN FOLLOW-UP (decision 50). Its only cover was through the endpoint that carded a suggestion,
// which cannot reach the no-block case at all — and the flag is what makes "the open follow-up" a fact
// rather than a guess from a title a user can rename.
describe('the open follow-up', () => {
  const TERMINAL: Record<BoardName, string[]> = {
    features: ['done'],
    product: ['done'],
    engineering: ['done'],
  };
  // No block at all, which is a project written before the lifecycle: `openFollowUp` takes `terminal` rather
  // than the whole block precisely so it still answers here.
  const NO_BLOCK = {} as Record<BoardName, string[]>;

  const follow = (id: string, columnSlug: string): Card => ({
    ...card(id, 'features', columnSlug, []),
    followUp: true,
  });

  it('finds a flagged feature whose column is not terminal', () => {
    expect(openFollowUp([follow('F-001', 'in-progress')], TERMINAL)?.id).toBe('F-001');
  });

  it('is nothing when the only flagged feature is finished', () => {
    // Reopening it would un-do something a feature checkup recorded as finished and contradict the derived
    // status the board shows, so the next story carded starts a new wave instead.
    expect(openFollowUp([follow('F-001', 'done')], TERMINAL)).toBeUndefined();
  });

  it('reads the FLAG, not the title', () => {
    const decoy = card('F-001', 'features', 'backlog', []);
    expect(openFollowUp([{ ...decoy, title: 'Follow-up 1' }], TERMINAL)).toBeUndefined();
  });

  it('ignores an archived follow-up, which is neither open nor a wave', () => {
    const archived = { ...follow('F-001', ARCHIVE_SLUG), archived: '2026-08-13T00:00:00Z' };
    expect(openFollowUp([archived], TERMINAL)).toBeUndefined();
    expect(followUpCount([archived])).toBe(0);
  });

  it('takes the first when a board somehow has two, rather than guessing', () => {
    const two = [follow('F-001', 'backlog'), follow('F-002', 'backlog')];
    expect(openFollowUp(two, TERMINAL)?.id).toBe('F-001');
  });

  // STATED BEHAVIOUR, not an accident: with no block nothing is terminal, so a follow-up somebody moved to
  // Done still reads as open and is reused. It cannot un-do a checkup's ruling, because a project with no
  // block has no lifecycle to run — a missing block is `coverageProblems`' loudest refusal — so no checkup
  // has ever closed anything there. Reading every column as terminal instead would start a new wave for
  // every single suggestion.
  it('reuses a finished follow-up on a project with no autopilot block, where nothing is terminal', () => {
    expect(openFollowUp([follow('F-001', 'done')], NO_BLOCK)?.id).toBe('F-001');
  });

  it('counts the waves from the flag, so a card titled like one is nobody’s wave', () => {
    const board = [
      follow('F-001', 'done'),
      follow('F-002', 'in-progress'),
      { ...card('F-003', 'features', 'backlog', []), title: 'Follow-up 3' },
    ];
    expect(followUpCount(board)).toBe(2);
  });
});
