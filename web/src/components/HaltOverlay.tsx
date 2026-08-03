import { useState } from 'react';
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
function readable(at: string | undefined): string {
  if (!at) return 'at an unrecorded time';
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? `at ${at}` : `at ${when.toLocaleString()}`;
}

export function HaltOverlay({ state, onRestarted }: { state: AutopilotState; onRestarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          {state.detail ?? 'Everything in this project was stopped.'} Halted {readable(state.at)}.
        </p>
        <p className="halt-hint">
          Nothing will be dispatched, and no agent or backend will be started for this project — not even by
          the chat. Restarting brings the project back to idle; auto-pilot stays off until you start it
          yourself.
        </p>
        {error && <p className="halt-error">{error}</p>}
        <button type="button" className="btn-primary" onClick={() => void restart()} disabled={busy}>
          {busy ? 'Restarting…' : 'Restart project'}
        </button>
      </div>
    </div>
  );
}
