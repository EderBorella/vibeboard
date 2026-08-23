import { Text } from '../../atoms/Text';
import { Notice } from '../../molecules/Notice';
import type { SigninPhase } from '../../organisms/signin/driver';

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
        <h2>{phase.phase === 'waiting' ? 'Waiting to be let in' : 'Signing in'}</h2>
        {phase.phase === 'claiming' && <Text role="hint">Signing this browser in…</Text>}

        {phase.phase === 'waiting' && (
          <>
            {/* What to DO, in the first sentence. This screen used to open by telling the user there
                was nothing to copy — an absence, about a mechanism they had never heard of, which only
                raises the question of what they were supposed to have copied. */}
            <Text role="hint">
              This board is already open on another device. Go to that device: it is showing a message asking
              whether to let this one in. Choose <strong>Allow</strong> there.
            </Text>
            {/* The address, so the user can tell their own request apart from somebody else's. The
                User-Agent is deliberately NOT repeated here — it means nothing to the person reading
                this screen, and it is the approving end that needs to recognise the device. */}
            <Text as="p" className="gate-preview">
              That message will show this address: <code>{phase.address}</code>
            </Text>
            <Text role="hint">Leave this page open — it continues on its own once you allow it.</Text>
          </>
        )}

        {phase.phase === 'stopped' && (
          <>
            {/* The whole reason this screen exists: it says WHY. A single red "unauthorized" is what
                sent the user looking for a token they had no way to know about. */}
            <Notice as="p" tone="bad">
              {phase.reason}
            </Notice>
            {phase.retry && (
              <p className="vb-field">
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
