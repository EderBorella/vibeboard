import { useEffect, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Pulse } from '../../atoms/Pulse';
import { Stack } from '../../atoms/Stack';
import { Text } from '../../atoms/Text';

// WHAT THE COPILOT IS DOING WHILE IT IS DOING NOTHING VISIBLE.
//
// Carded 2026-08-10 from real use — *Show that the copilot is thinking*: a message
// took about three minutes to come back with nothing on screen changing, and the honest reading was
// that the copilot had died. It had not. The card's argument, which this implements: **a healthy slow
// turn and a dead one look identical**, and the instinct for both is to reload or resend — the one
// thing you must not do to a turn that is still running.
//
// So this is not decoration and not a spinner. A spinner that never stops proves nothing at all; it
// spins just as happily over a wedged process. What proves liveness is a clock that keeps moving and
// a sentence that CHANGES when the answer is late.

// Time since dispatch with no answer begun. Reassurance, not alarm.
export const SLOW_MS = 15_000;
// Time since ANY event, hidden ones included. Suspicion.
export const STALL_MS = 90_000;
// How often the clock is re-read. One second is the resolution the copy needs — it says "45s", not
// "45.2s" — and it is the whole cost of this component when nothing is happening.
const TICK_MS = 1_000;

export type ThinkingPhase = 'waiting' | 'slow' | 'stalled';

// PURE, AND LIFTED OUT OF THE COMPONENT SO IT CAN BE TESTED WITHOUT A DOM OR A CLOCK. The two timers
// are the whole of this feature's logic and they are exactly the part worth pinning; asserting on
// markup to reach them would be testing React.
//
// TWO CLOCKS, AND THAT IS THE POINT. `sinceSent` never resets, so a turn that has genuinely been
// working for four minutes stays `slow` and is never called stalled. `sinceEvent` resets on every
// event including the hidden reasoning deltas, so a turn that stops emitting anything reaches
// `stalled` even if it looked busy a minute ago. One timer cannot express that difference: it would
// either accuse every long reasoning turn of being dead, or never notice a wedged one.
//
// STALL OUTRANKS SLOW when both are true, because it is the one that changes what you should DO.
export function phaseOf(sinceSent: number, sinceEvent: number): ThinkingPhase {
  if (sinceEvent >= STALL_MS) return 'stalled';
  if (sinceSent >= SLOW_MS) return 'slow';
  return 'waiting';
}

export function captionOf(phase: ThinkingPhase, sinceEvent: number): string {
  if (phase === 'stalled') return `No response for ${Math.floor(sinceEvent / 1000)}s`;
  // The sentence the owner asked for, and it says two things at once: the model is late, AND we are
  // still here watching it. That second half is what a spinner cannot say.
  if (phase === 'slow') return 'The model is taking longer than usual';
  return 'Thinking';
}

interface Props {
  // Refs rather than values — see their declaration in useCopilot.ts. Reading them on this
  // component's own tick is what keeps a hidden delta from re-rendering the whole transcript.
  sentAt: { current: number | null };
  lastEventAt: { current: number | null };
  onCancel: () => void;
}

export function ThinkingIndicator({ sentAt, lastEventAt, onCancel }: Props) {
  // The tick exists to make the clock move; the value is deliberately unused. `now` is read fresh in
  // the render below rather than stored, so a slow render cannot show a stale second.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const sinceSent = sentAt.current === null ? 0 : now - sentAt.current;
  const sinceEvent = lastEventAt.current === null ? 0 : now - lastEventAt.current;
  const phase = phaseOf(sinceSent, sinceEvent);

  // `testId`, NOT `data-testid`. `Stack` names the prop in camelCase and renders the attribute
  // itself; an unknown `data-testid` is silently dropped, so the handle never reached the DOM at all
  // and the first render test could not find the component it was looking straight at.
  return (
    <Stack gap={3} pad={[4, 5]} testId="thinking">
      <Pulse />
      {/* THE LIVE REGION IS THE SENTENCE, not the dots — it is the part that changes, and putting it
          on both would announce the same words twice. A bare `<span>` because `Text`'s own `role` prop
          is a VISUAL role ('label' | 'hint' | 'error') and has nothing to do with ARIA; the two would
          collide on one attribute name meaning two different things.
          `hint` while it is merely slow, `error` once it is suspicious: the tone is the state, and it
          comes from the atom rather than from a colour this surface picks. */}
      <span role="status">
        <Text role={phase === 'stalled' ? 'error' : 'hint'}>{captionOf(phase, sinceEvent)}</Text>
      </span>
      {/* THE ELAPSED CLOCK IS THE LIVENESS PROOF, and it is shown from the moment it is interesting
          rather than always: a counter at 0s is noise, and one at 40s is the difference between "it
          is working" and "nothing has happened". Hidden at `waiting` for that reason. */}
      {phase !== 'waiting' && (
        <Text role="hint" size="micro">
          {Math.floor(sinceSent / 1000)}s
        </Text>
      )}
      {/* OFFERED ONLY WHEN STALLED. Cancel exists throughout the turn on the composer; putting it
          here early would invite abandoning a turn that is merely thinking, which is the behaviour
          the card says to prevent rather than encourage. */}
      {phase === 'stalled' && (
        <Button size="sm" className="push" onClick={onCancel}>
          Stop
        </Button>
      )}
    </Stack>
  );
}
