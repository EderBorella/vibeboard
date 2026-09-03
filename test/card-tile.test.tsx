// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../web/src/lib/shared.js';
import { CardTile } from '../web/src/organisms/board/CardTile.js';

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

// THE BOARD'S PRIMARY CONTROL WAS MOUSE-ONLY: a `<div className="tile">` with an `onClick`, no
// `tabIndex` and no `onKeyDown`, so no tile could be reached or opened from the keyboard and fourteen
// of them were absent from the browser harness's focus population. These are the claims the fix rests
// on, and each one fails without it.
describe('CardTile keyboard operation', () => {
  // The exact selector visual/support/audit.ts's focus walk uses. Asserted rather than paraphrased:
  // the population the harness protects is defined by this string, and a tile that is focusable by
  // some other means would still be invisible to it.
  const FOCUSABLE =
    'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]';
  const tile = (): HTMLElement => screen.getByRole('group', { name: /^Card E-001/ });

  it('puts the tile in the tab order, where the focus gate can see it', () => {
    render(<CardTile card={card()} miniatureChars={40} onOpen={vi.fn()} />);
    expect(tile().matches(FOCUSABLE)).toBe(true);
    tile().focus();
    expect(document.activeElement).toBe(tile());
  });

  it('opens the card on Enter, and on Space', () => {
    const onOpen = vi.fn();
    render(<CardTile card={card()} miniatureChars={40} onOpen={onOpen} />);
    fireEvent.keyDown(tile(), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(tile(), { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen.mock.calls[0][0].id).toBe('E-001');
  });

  it('ignores a key that is not an activation', () => {
    const onOpen = vi.fn();
    render(<CardTile card={card()} miniatureChars={40} onOpen={onOpen} />);
    fireEvent.keyDown(tile(), { key: 'a' });
    fireEvent.keyDown(tile(), { key: 'Tab' });
    expect(onOpen).not.toHaveBeenCalled();
  });

  // THE SAME BOUNDARY THE TAG'S `stopPropagation` DRAWS, on the keyboard side. A click on the archive
  // button does not open the card because that handler stops it; a KEYDOWN on it bubbles to the tile
  // regardless, so a handler that acted on a bubbled key would archive the card and open it at once.
  it('does not also open the card when Enter lands on the archive button', () => {
    const onOpen = vi.fn();
    const onArchive = vi.fn();
    render(<CardTile card={card()} miniatureChars={40} onOpen={onOpen} onArchive={onArchive} />);
    const archive = screen.getByTitle('Archive');
    // Both halves of what a browser does with Enter on a `<button>`: the button's own activation,
    // and the keydown that bubbles past it.
    fireEvent.keyDown(archive, { key: 'Enter', bubbles: true });
    archive.click();
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not also open the card when Enter lands on a tag', () => {
    const onOpen = vi.fn();
    const onTag = vi.fn();
    render(<CardTile card={card()} miniatureChars={40} onOpen={onOpen} onTag={onTag} />);
    const tag = screen.getByTitle('Filter by bug');
    fireEvent.keyDown(tag, { key: 'Enter', bubbles: true });
    tag.click();
    expect(onTag.mock.calls).toEqual([['bug']]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  // A tab stop that does nothing is worse than none: the archive drawer's tiles open nothing.
  it('takes no tab stop where there is nothing to open', () => {
    render(<CardTile card={card()} miniatureChars={40} />);
    expect(tile().matches(FOCUSABLE)).toBe(false);
  });

  // THE DRAG IS THE ONE THING THIS COULD HAVE BROKEN, and the tile is dragged by the pointer while
  // being focusable and activable by the keyboard — the three have to coexist.
  it('still starts a drag', () => {
    const onDragStart = vi.fn();
    render(<CardTile card={card()} miniatureChars={40} onOpen={vi.fn()} onDragStart={onDragStart} />);
    expect(tile().getAttribute('draggable')).toBe('true');
    const setData = vi.fn();
    fireEvent.dragStart(tile(), { dataTransfer: { setData, effectAllowed: '' } });
    expect(setData.mock.calls).toEqual([['text/plain', 'E-001']]);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });
});

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
