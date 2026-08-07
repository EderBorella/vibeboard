import type { SigninPhase } from '../signin';

interface Props {
  phase: SigninPhase;
  onRetry: () => void;
}

// The screen that exists so a browser without a credential is never shown a working board on which
// every button silently fails. Three states, and no button in the common case: the first browser ever
// to load the page sees `claiming` for a few milliseconds and then the board.
//
// Deliberately built out of the same `.gate` classes as ProjectGate: it is the same visual object,
// standing in the same place, and a second look-alike would drift from it.
export function SignIn({ phase, onRetry }: Props) {
  return (
    <div className="gate">
      <div className="gate-card">
        <h2>{phase.phase === 'waiting' ? 'Waiting for approval' : 'Signing in'}</h2>
        {phase.phase === 'claiming' && <p className="gate-hint">Signing this browser in…</p>}

        {phase.phase === 'waiting' && (
          <>
            <p className="gate-hint">
              A browser is already signed in to this board, so it has to allow this one. Look for the prompt
              on it and choose Allow.
            </p>
            {/* What the other browser is being shown, so the two can be matched. Without it the user
                is asked to recognise a prompt they have never seen. */}
            <p className="gate-preview">
              It will say: <code>{phase.label}</code> at <code>{phase.address}</code>
            </p>
            <p className="gate-hint">
              Nothing to type, and nothing to copy. This page will carry on by itself once it is allowed.
            </p>
          </>
        )}

        {phase.phase === 'stopped' && (
          <>
            {/* The whole reason this screen exists: it says WHY. A single red "unauthorized" is what
                sent the user looking for a token they had no way to know about. */}
            <p className="gate-error">{phase.reason}</p>
            {phase.retry && (
              <p className="gate-field">
                <button type="button" onClick={onRetry}>
                  Try again
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
