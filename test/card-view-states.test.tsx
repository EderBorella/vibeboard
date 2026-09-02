// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, ProjectConfig } from '../web/src/lib/shared.js';
import { CardView } from '../web/src/organisms/cards/CardView.js';

// THE THREE STATE BADGES, WHICH LIVE ON THE CARD AND NOT ON ITS MINIATURE — moved here from
// test/card-tile.test.tsx on 2026-09-02 when they moved out of the board tile. The tile's head had no
// slack left once the glyphs became icons, and a fixed-height miniature has no room for five signals.
//
// The claims are unchanged, which is the point of moving the tests rather than rewriting them: a count
// says whether to look NOW, the singular reads correctly at one, an absent field is not a zero, and every
// blocked id is named in the title because the ids are what a person goes and looks at.

const CONFIG = {
  boards: {
    features: { columns: ['Backlog', 'Done'] },
    product: { columns: ['Backlog', 'Done'] },
    engineering: { columns: ['Todo', 'Done'] },
  },
} as unknown as ProjectConfig;

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'E-001',
    title: 'A card',
    board: 'engineering',
    columnSlug: 'done',
    order: 10,
    tags: [],
    links: [],
    created: '2026-07-25',
    body: '',
    filePath: '/tmp/E-001.md',
    ...over,
  }) as Card;

afterEach(cleanup);

describe('CardView open suggestions', () => {
  it('marks a card that has work left behind', () => {
    render(<CardView card={card()} config={CONFIG} allCards={[]} openSuggestions={2} />);
    // Plural, and a count — "has suggestions" would not tell you whether to look now.
    expect(screen.getByTitle('2 open suggestions')).toBeTruthy();
  });

  it('says suggestion, singular, when there is one', () => {
    render(<CardView card={card()} config={CONFIG} allCards={[]} openSuggestions={1} />);
    expect(screen.getByTitle('1 open suggestion')).toBeTruthy();
  });

  it('marks nothing when there are none, and nothing when it is absent', () => {
    render(<CardView card={card()} config={CONFIG} allCards={[]} openSuggestions={0} />);
    expect(screen.queryByTitle(/open suggestion/)).toBeNull();
    cleanup();
    // Absent, not zero: a snapshot from an older server carries no field at all.
    render(<CardView card={card()} config={CONFIG} allCards={[]} />);
    expect(screen.queryByTitle(/open suggestion/)).toBeNull();
  });
});

// Decision 46: "a story in Done carrying a blocked task must not look identical to one that finished
// clean." The card's own state is its column, which the board already shows; what needs saying is what
// is UNDER it, which is on no tile a person can see from the board.
describe('CardView carrying a problem', () => {
  // ONE CASE FOR THE BADGE, not three. There were two more — a card in DONE, and "for a story and for a
  // feature" — and the card view reads neither `card.board` nor `card.columnSlug` for this, so all three rendered
  // the same thing and only one of them could ever fail. The board-and-column claim is real and belongs to
  // test/snapshot.test.ts, which names the blocked task against the story AND the feature and can fail on it.
  it('marks a card carrying a blocked task, from the prop and nothing else', () => {
    render(
      <CardView
        card={card({ id: 'P-001', board: 'product', columnSlug: 'done' })}
        config={CONFIG}
        allCards={[]}
        carryingAProblem={['E-001']}
      />,
    );
    // The id is in the title, because "carrying a problem" with no name is a badge you cannot act on.
    expect(screen.getByTitle(/E-001/)).toBeTruthy();
  });

  it('does not mark a clean card', () => {
    // The ordinary case is an EMPTY array — the snapshot omits a clean card, but a caller reading a
    // missing key with `?? []` hands one over, and an empty array is truthy.
    render(<CardView card={card()} config={CONFIG} allCards={[]} carryingAProblem={[]} />);
    expect(screen.queryByTitle(/blocked/i)).toBeNull();
    cleanup();
    render(<CardView card={card()} config={CONFIG} allCards={[]} />);
    expect(screen.queryByTitle(/blocked/i)).toBeNull();
  });

  it('names every blocked card in the title, not just the first', () => {
    render(<CardView card={card()} config={CONFIG} allCards={[]} carryingAProblem={['E-001', 'E-007']} />);
    const title = screen.getByTitle(/E-001/).getAttribute('title') ?? '';
    expect(title).toContain('E-007');
  });

  // "CARD" AND NOT "TASK", because what a feature carries can be a story nobody could break down since
  // decision 45's 2026-08-13 correction. The tile reads neither board nor column, so this is a claim about
  // the WORD it puts on screen rather than about the kind of card — which is exactly why it needs saying:
  // a tooltip naming the wrong kind of thing is a false claim a person reads.
  it('does not call what it is carrying a task', () => {
    render(
      <CardView
        card={card({ id: 'F-001', board: 'features' })}
        config={CONFIG}
        allCards={[]}
        carryingAProblem={['P-002']}
      />,
    );
    const title = screen.getByTitle(/P-002/).getAttribute('title') ?? '';
    expect(title).toContain('a blocked card');
    expect(title).not.toContain('task');
  });
});

// The barrier's effect is invisible from the card it sits on: nothing outside this feature's subtree
// runs until it is finished, so a board that looks stuck is explained by a tile somewhere else.
describe('CardView setup badge', () => {
  it('marks the setup feature', () => {
    render(
      <CardView card={card({ id: 'F-001', board: 'features', setup: true })} config={CONFIG} allCards={[]} />,
    );
    expect(screen.getByText('setup')).toBeTruthy();
    expect(screen.getByTitle(/nothing outside it runs until it is done/i)).toBeTruthy();
  });

  it('says nothing on an ordinary card', () => {
    render(<CardView card={card()} config={CONFIG} allCards={[]} />);
    expect(screen.queryByText('setup')).toBeNull();
  });
});
