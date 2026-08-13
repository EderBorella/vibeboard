// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardTile } from '../web/src/components/CardTile.js';
import type { Card } from '../web/src/shared.js';

afterEach(cleanup);

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'E-001',
    title: 'A card',
    board: 'engineering',
    columnSlug: 'todo',
    order: 10,
    tags: ['bug', 'ui'],
    links: [],
    created: '2026-07-25',
    body: '',
    filePath: '/tmp/E-001.md',
    ...over,
  }) as Card;

describe('CardTile tags', () => {
  it('makes each tag a button when the board can be filtered', () => {
    render(<CardTile card={card()} miniatureChars={40} onTag={vi.fn()} />);
    expect(screen.getByTitle('Filter by bug').tagName).toBe('BUTTON');
    expect(screen.getByTitle('Filter by ui').tagName).toBe('BUTTON');
  });

  it('reports the clicked tag WITHOUT also opening the card', () => {
    // The tile's own onClick opens the editor. Filtering by a tag and having the editor spring
    // open over the result is the failure this guards: it needs stopPropagation on the tag.
    const onTag = vi.fn();
    const onOpen = vi.fn();
    render(<CardTile card={card()} miniatureChars={40} onTag={onTag} onOpen={onOpen} />);
    screen.getByTitle('Filter by bug').click();
    expect(onTag.mock.calls).toEqual([['bug']]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('still opens the card when the click is anywhere else on the tile', () => {
    const onOpen = vi.fn();
    render(<CardTile card={card()} miniatureChars={40} onTag={vi.fn()} onOpen={onOpen} />);
    screen.getByText('A card').click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders plain labels where there is nothing to filter', () => {
    // The archive drawer passes no onTag: filtering the board by a tag on an archived card would
    // do nothing visible, so a button there would be a dead control.
    render(<CardTile card={card()} miniatureChars={40} />);
    expect(screen.queryByTitle('Filter by bug')).toBeNull();
    expect(screen.getByText('bug').tagName).toBe('SPAN');
  });

  it('renders no tag row at all for an untagged card', () => {
    const { container } = render(<CardTile card={card({ tags: [] })} miniatureChars={40} onTag={vi.fn()} />);
    expect(container.querySelector('.tile-tags')).toBeNull();
  });
});

describe('CardTile open suggestions', () => {
  it('marks a card that has work left behind', () => {
    render(<CardTile card={card()} miniatureChars={40} openSuggestions={2} />);
    // Plural, and a count — "has suggestions" would not tell you whether to look now.
    expect(screen.getByTitle('2 open suggestions')).toBeTruthy();
  });

  it('says suggestion, singular, when there is one', () => {
    render(<CardTile card={card()} miniatureChars={40} openSuggestions={1} />);
    expect(screen.getByTitle('1 open suggestion')).toBeTruthy();
  });

  it('marks nothing when there are none, and nothing when it is absent', () => {
    render(<CardTile card={card()} miniatureChars={40} openSuggestions={0} />);
    expect(screen.queryByTitle(/open suggestion/)).toBeNull();
    cleanup();
    // Absent, not zero: a snapshot from an older server carries no field at all.
    render(<CardTile card={card()} miniatureChars={40} />);
    expect(screen.queryByTitle(/open suggestion/)).toBeNull();
  });
});

// Decision 46: "a story in Done carrying a blocked task must not look identical to one that finished
// clean." The card's own state is its column, which the board already shows; what needs saying is what
// is UNDER it, which is on no tile a person can see from here.
describe('CardTile carrying a problem', () => {
  // ONE CASE FOR THE BADGE, not three. There were two more — a card in DONE, and "for a story and for a
  // feature" — and the tile reads neither `card.board` nor `card.columnSlug` for this, so all three rendered
  // the same thing and only one of them could ever fail. The board-and-column claim is real and belongs to
  // test/snapshot.test.ts, which names the blocked task against the story AND the feature and can fail on it.
  it('marks a card carrying a blocked task, from the prop and nothing else', () => {
    render(
      <CardTile
        card={card({ id: 'P-001', board: 'product', columnSlug: 'done' })}
        miniatureChars={80}
        carryingAProblem={['E-001']}
      />,
    );
    // The id is in the title, because "carrying a problem" with no name is a badge you cannot act on.
    expect(screen.getByTitle(/E-001/)).toBeTruthy();
  });

  it('does not mark a clean card', () => {
    // The ordinary case is an EMPTY array — the snapshot omits a clean card, but a caller reading a
    // missing key with `?? []` hands one over, and an empty array is truthy.
    render(<CardTile card={card()} miniatureChars={80} carryingAProblem={[]} />);
    expect(screen.queryByTitle(/blocked/i)).toBeNull();
    cleanup();
    render(<CardTile card={card()} miniatureChars={80} />);
    expect(screen.queryByTitle(/blocked/i)).toBeNull();
  });

  it('names every blocked task in the title, not just the first', () => {
    render(<CardTile card={card()} miniatureChars={80} carryingAProblem={['E-001', 'E-007']} />);
    const title = screen.getByTitle(/E-001/).getAttribute('title') ?? '';
    expect(title).toContain('E-007');
  });

});

// The barrier's effect is invisible from the card it sits on: nothing outside this feature's subtree
// runs until it is finished, so a board that looks stuck is explained by a tile somewhere else.
describe('CardTile setup badge', () => {
  it('marks the setup feature', () => {
    render(<CardTile card={card({ id: 'F-001', board: 'features', setup: true })} miniatureChars={40} />);
    expect(screen.getByText('setup')).toBeTruthy();
    expect(screen.getByTitle(/nothing outside it runs until it is done/i)).toBeTruthy();
  });

  it('says nothing on an ordinary card', () => {
    render(<CardTile card={card()} miniatureChars={40} />);
    expect(screen.queryByText('setup')).toBeNull();
  });
});
