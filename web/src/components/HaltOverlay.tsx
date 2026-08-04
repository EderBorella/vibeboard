import { useEffect, useRef, useState } from 'react';
import { type AutopilotState, restartAutopilot } from '../api';

// The project is halted: everything in it was killed, and nothing will start again until someone says
// so. Decision 12 asks for an overlay that STATES THE REASON AND THE TIMESTAMP and carries the way
// back — so it explains itself rather than merely blocking.
//
// Blocking is the easy half. A halted app that only refused would leave the user clicking things that
// silently do nothing: the chat would answer with a refusal, a dispatch would 409, and the board would
// look perfectly healthy over a project whose agents are gone.

// Read as a person reads a clock, not as an ISO string. The date is included because a halt can outlive
// the day it happened on — a project halted on Friday is opened on Monday.
//
// The `unreadable` halt is the exception, and it gets a sentence instead of a time. Nothing recorded when
// that halt began: the state file could not be read, so `at` is re-derived as "now" on every poll and the
// overlay reported the project as halted seconds ago, for ever. A moving clock is worse than no clock —
// it looks like the halt keeps happening. Recording it would mean writing to the file we could not read,
// which is the one thing that must not happen while the damaged copy is the only evidence.
function readable(state: AutopilotState): string {
  if (state.reason === 'unreadable') return 'at a time nothing recorded';
  if (!state.at) return 'at an unrecorded time';
  const when = new Date(state.at);
  return Number.isNaN(when.getTime()) ? `at ${state.at}` : `at ${when.toLocaleString()}`;
}

export function HaltOverlay({ state, onRestarted }: { state: AutopilotState; onRestarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restartRef = useRef<HTMLButtonElement>(null);

  // Focus moves in and stays in. The backdrop blocks the pointer, but Tab reached the TopBar behind it
  // and Enter on "Switch project" set the gate — which renders the overlay away, silently dismissing the
  // only thing on screen explaining why the project is dead. Switching away from a halted project is
  // legitimate; doing it by accident, with no way to read the reason again, is not.
  useEffect(() => {
    restartRef.current?.focus();
    const trap = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') {
        e.preventDefault();
        restartRef.current?.focus();
      }
    };
    document.addEventListener('keydown', trap, true);
    return () => document.removeEventListener('keydown', trap, true);
  }, []);

  async function restart(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await restartAutopilot();
      onRestarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="halt-backdrop" role="alertdialog" aria-label="This project is halted">
      <div className="halt">
        <h2 className="halt-title">This project is halted</h2>
        <p className="halt-why">
          {state.detail ?? 'Everything in this project was stopped.'} Halted {readable(state)}.
        </p>
        <p className="halt-hint">
          Nothing will be dispatched, and no agent or backend will be started for this project — not even by
          the chat. Restarting brings the project back to idle; auto-pilot stays off until you start it
          yourself.
        </p>
        {error && <p className="halt-error">{error}</p>}
        <button
          ref={restartRef}
          type="button"
          className="btn-primary"
          onClick={() => void restart()}
          disabled={busy}
        >
          {busy ? 'Restarting…' : 'Restart project'}
        </button>
      </div>
    </div>
  );
}
