import { describe, expect, it } from 'vitest';
import type { AutopilotConfig } from '../src/core/autopilot.js';
import { isLastOpenFeature } from '../src/core/last-feature.js';
import { derivePosition } from '../src/core/position.js';
import type { Card } from '../src/core/types.js';

// ONE FEATURE, END TO END. `autopilot.focus` names a feature card and the loop confines itself to it.
//
// A FILTER RATHER THAN A NEW MECHANISM: `derivePosition` already chooses the feature — open one first, else
// first queued by (order, id) — and focus narrows the list it chooses from. Everything below that choice
// (the stories, the open-story invariant, the tasks) runs exactly as it does unfocused.
//
// Decision 39 is not bent. It refuses auto-pilot STORING where it is, so a restart needs no memory and a
// person dragging a card cannot be contradicted. This is a person's instruction going the other way, and the
// derivation still does all the deciding.

const C = (id: string, board: string, columnSlug: string, over: Partial<Card> = {}): Card =>
  ({ id, board, columnSlug, title: id, links: [], tags: [], order: 10, ...over }) as unknown as Card;

// Two features and a story under each, so a test can tell "picked the right one" from "picked the only one"
// — a fixture too thin to distinguish two outcomes tests neither.
const F1 = C('F-001', 'features', 'backlog', { links: ['P-001'] });
const F2 = C('F-002', 'features', 'backlog', { links: ['P-002'], order: 20 });
const P1 = C('P-001', 'product', 'backlog');
const P2 = C('P-002', 'product', 'backlog');
const board = [F1, F2, P1, P2];

const featureOf = (r: ReturnType<typeof derivePosition>): string | undefined =>
  'position' in r ? r.position.feature.id : undefined;

describe('a focused feature', () => {
  it('is the one the loop works, and not the one the queue would have picked', () => {
    // Unfocused, (order, id) picks F-001. So naming F-002 proves the focus decided it.
    expect(featureOf(derivePosition(board))).toBe('F-001');
    expect(featureOf(derivePosition(board, 'F-002'))).toBe('F-002');
  });

  it('still derives the stories and tasks under it, exactly as an unfocused run does', () => {
    const r = derivePosition(board, 'F-002');
    expect('position' in r && r.position.stories.map((c) => c.id)).toEqual(['P-002']);
    expect('position' in r && r.position.story?.id).toBe('P-002');
  });

  // A REFUSAL RATHER THAN A FALLBACK, and it is the whole care of the feature: silently picking the next
  // feature is how you focus F-002, walk away, and find the loop three cards deep in F-005.
  it('stops, naming the card, when the focused feature is gone from the board', () => {
    const r = derivePosition(board, 'F-404');
    expect('problem' in r && r.problem).toMatch(/focused on F-404/);
    expect('problem' in r && r.problem).toMatch(/no such feature on the board/i);
    // And it does NOT quietly become a run on something else.
    expect(featureOf(r)).toBeUndefined();
  });

  it('stops the same way when the focused feature was archived', () => {
    // Archiving is how a card leaves the board, so it must read as gone rather than as a card to work.
    const archived = [...board, C('F-003', 'features', 'archive')];
    expect('problem' in derivePosition(archived, 'F-003')).toBe(true);
  });

  // WITHOUT THIS, FOCUS IS THE ONE WAY TO RE-ENTER A CLOSED FEATURE, and the loop would work it for ever:
  // `openIn` and `firstQueued` never pick a card out of `done`, so returning one on the strength of its id
  // alone would be a hole nothing else in this file has.
  it('is finished, not eligible, once the focused feature reaches done', () => {
    const closed = [C('F-001', 'features', 'done'), F2, P1, P2];
    const r = derivePosition(closed, 'F-001');
    expect(r).toEqual({ empty: true });
  });

  // THE TWO-OPEN-FEATURE REFUSAL DOES NOT APPLY UNDER FOCUS, and that is the point rather than an omission.
  // It exists because the loop cannot tell which of two open features it was in the middle of — and a person
  // naming one has answered exactly that question.
  it('answers the two-open-features refusal instead of meeting it', () => {
    const both = [
      C('F-001', 'features', 'in-progress'),
      C('F-002', 'features', 'in-progress', { order: 20 }),
    ];
    expect('problem' in derivePosition(both)).toBe(true);
    expect(featureOf(derivePosition(both, 'F-002'))).toBe('F-002');
  });

  it('leaves an unfocused board deciding exactly as it did', () => {
    expect(derivePosition(board, undefined)).toEqual(derivePosition(board));
  });
});

// DECISION 70 SCOPED TO THE FOCUS. The smoke command proves the ASSEMBLED product runs, so decision 69's
// refusal is asked only of the LAST open feature — otherwise a feature whose own work is done is held open
// over a command that fails on work a later feature owns.
//
// Under focus the focused feature IS the whole of what this run will build, so the question has to be asked
// within the focus. Without this, one untouched feature in the backlog makes the gate false for ever and a
// failing smoke command refuses nothing — in the mode where it is the only thing that closes a feature.
describe('the smoke gate under focus', () => {
  const ap = {
    terminal: { features: ['done'], product: ['done'], engineering: ['done'] },
    blockedColumn: 'blocked',
  } as unknown as AutopilotConfig;

  it('treats the focused feature as the last one, whatever else is on the board', () => {
    expect(isLastOpenFeature({ ...ap, focus: 'F-002' }, board, F2)).toBe(true);
    // F-001 is still in backlog, so unfocused this is false — which is what makes the line above a change.
    expect(isLastOpenFeature(ap, board, F2)).toBe(false);
  });

  it('is false for a feature that is not the focused one', () => {
    // The loop should never reach this, but the answer must not be "yes" if it does: a run on an unfocused
    // feature is already a bug, and closing it over a smoke command would compound it.
    expect(isLastOpenFeature({ ...ap, focus: 'F-002' }, board, F1)).toBe(false);
  });

  it('asks the board when nothing is focused', () => {
    const alone = [F1, P1];
    expect(isLastOpenFeature(ap, alone, F1)).toBe(true);
  });
});
