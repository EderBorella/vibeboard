import { useEffect, useRef } from 'react';
import { Button } from '../../atoms/Button';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import { approveSignin, refuseSignin, type SigninPending } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Modal } from '../shared/Modal';

interface Props {
  pending: SigninPending[];
  // Pushed over this browser's socket, so the list refreshes itself. Called only to report a failure
  // the push cannot describe.
  onError?: (message: string) => void;
}

// Another browser wants in, and this one is signed in, so this one decides.
//
// THE ATTACK ON THIS PATH IS NOT GUESSING — request ids are 32 random bytes. It is PROMPT FATIGUE: a
// process that can raise this dialog often enough eventually catches an absent-minded Allow. The
// server caps and rate-limits how often it can appear, and refuses to raise it at all while agents
// are running; this component carries the rest of the mitigation, and every one of these is deliberate:
//
//   - REFUSE IS THE PRIMARY ACTION and holds the focus, so the reflex click and the reflex Enter both
//     land on "no".
//   - Enter never allows. There is no form and no default submit.
//   - The ADDRESS is shown next to the label, because the label is a User-Agent and `curl -H` forges
//     any of those. Where the request came from is the only part that narrows anything down.
//   - No "allow all". One decision per browser.
export function ApprovalPrompt({ pending, onError }: Props) {
  // Keyed to the request being decided, and the failure goes UP: this dialog has no banner of its
  // own, and only a message is ever reported — the list refreshes itself over the socket.
  const { busy, run } = useAction<string>((message) => {
    if (message !== null) onError?.(message);
  });
  const refuseRef = useRef<HTMLButtonElement>(null);
  const first = pending[0];
  const focusId = first?.id;

  // Focus lands on Refuse, and moves there again whenever the prompt changes to a different request —
  // otherwise a second request arriving while the first is on screen inherits a focus aimed at the
  // decision already made.
  useEffect(() => {
    if (focusId) refuseRef.current?.focus();
  }, [focusId]);

  if (!first) return null;

  async function decide(id: string, allow: boolean): Promise<void> {
    await run(async () => {
      await (allow ? approveSignin(id) : refuseSignin(id));
    }, id);
  }

  return (
    // The same object the halt overlay is — the one thing on screen, blocking, explaining itself — and it
    // borrows nothing by hand now: `blocking` and `danger` ARE what `.halt-backdrop` and `.halt` were.
    <Modal
      blocking
      size="md"
      tone="danger"
      role="alertdialog"
      label="A browser is asking to sign in"
      title="Allow this browser in?"
    >
      <p>
        Something at <code>{first.address}</code> is asking to use this board. It says it is:
      </p>
      <Surface variant="inset" className="signin-label">
        {first.label}
      </Surface>
      <Text lead>
        Allow it only if that is you, on a device you are holding. Anything allowed here can read this board,
        start agents and edit files in your projects. What it calls itself can be faked — the address is the
        part that cannot.
        {pending.length > 1 && ` ${pending.length - 1} more waiting after this one.`}
      </Text>
      <Stack gap={4}>
        {/* Refuse first in the DOM as well as visually, so tab order and reading order agree. */}
        <Button
          variant="primary"
          size="md"
          ref={refuseRef}
          onClick={() => void decide(first.id, false)}
          disabled={busy !== null}
        >
          Refuse
        </Button>
        <Button size="md" onClick={() => void decide(first.id, true)} disabled={busy !== null}>
          Allow
        </Button>
      </Stack>
    </Modal>
  );
}
