// THE TWO TIMERS, TESTED AS THE PURE FUNCTIONS THEY ARE.
//
// `phaseOf` and `captionOf` are the whole of this feature's logic and they need no DOM, no clock and
// no React. They were lifted out of the component for exactly that reason — asserting on rendered
// markup to reach a threshold would be testing React and would need fake timers, which cannot flush
// what a real interval drives.
//
// WHAT THE TWO CLOCKS ARE FOR, because a single one cannot express it: `sinceSent` never resets, so a
// turn genuinely reasoning for four minutes stays `slow` and is never accused of being dead.
// `sinceEvent` resets on every event including the hidden `thinking_delta`s, so a turn that stops
// emitting anything reaches `stalled` even though it looked busy a minute ago. The cases below are
// chosen to fail if either clock is swapped for the other — which is the mistake worth catching, and
// the one a test using a single elapsed time would let through.
import { describe, expect, it } from 'vitest';
import { captionOf, phaseOf, SLOW_MS, STALL_MS } from '../web/src/organisms/copilot/ThinkingIndicator.js';

describe('phaseOf', () => {
  it('is waiting before either threshold', () => {
    expect(phaseOf(0, 0)).toBe('waiting');
    expect(phaseOf(SLOW_MS - 1, SLOW_MS - 1)).toBe('waiting');
  });

  it('is slow the instant the send clock reaches the threshold', () => {
    // ON the boundary, not past it: `>=` is the contract, and a test at +1 would pass for a `>`.
    expect(phaseOf(SLOW_MS, 0)).toBe('slow');
  });

  // THE CASE THAT PROVES THE CLOCKS ARE NOT THE SAME CLOCK. A turn four minutes in — far past the
  // stall threshold on the SEND clock — that emitted something a second ago is working, not wedged.
  // Swap the two arguments in `phaseOf` and this is the assertion that goes red.
  it('stays slow through a long turn that keeps emitting', () => {
    expect(phaseOf(240_000, 1_000)).toBe('slow');
  });

  // AND THE MIRROR OF IT: silence long enough to be suspicious, on a turn that is young by the send
  // clock. Only the event clock can see this.
  it('is stalled on silence even when the turn is otherwise recent', () => {
    expect(phaseOf(STALL_MS + 1, STALL_MS)).toBe('stalled');
  });

  it('lets stalled outrank slow when both are true', () => {
    expect(phaseOf(300_000, 300_000)).toBe('stalled');
  });
});

describe('captionOf', () => {
  it('says nothing alarming while merely thinking', () => {
    expect(captionOf('waiting', 0)).toBe('Thinking');
  });

  // The sentence carries two claims at once — the model is late, AND we are still watching. That
  // second half is what a spinner cannot say, and it is the reason this copy is asserted exactly
  // rather than with a substring match.
  it('reassures rather than alarms when the model is slow', () => {
    expect(captionOf('slow', 20_000)).toBe('The model is taking longer than usual');
  });

  it('reports the silence in whole seconds once stalled', () => {
    expect(captionOf('stalled', 92_400)).toBe('No response for 92s');
  });

  // Floor, not round: 92.9s must not read as 93s while the clock still says 92. A caption that ran
  // ahead of the counter beside it would look like two different measurements of one thing.
  it('floors the seconds rather than rounding them', () => {
    expect(captionOf('stalled', 92_999)).toBe('No response for 92s');
  });
});
