import { getSandbox, type SandboxState } from './api';
import { useFetched } from './useFetched';

// "Can this project actually run anything?" — the sandbox, its reason when not, and the refusal
// sentence the dispatch gate itself computes.
//
// Refetched on the trigger rather than polled: this changes when an image is built or removed, which is
// an event, not a drift. A poll would ask a Docker question every few seconds for an answer that is the
// same all day.
//
// `null` means NOT ASKED YET, and callers must not read it as "nothing is wrong" — the distinction
// `useReadiness` documents at length, for the same reason: showing reassurance before the answer
// arrives is a lie for the length of a round trip, and showing an alarm is a worse one.
export function useSandbox(
  trigger: unknown,
  enabled = true,
): { sandbox: SandboxState | null; failed: boolean } {
  const { value: sandbox, failed } = useFetched<SandboxState | null>(getSandbox, [trigger], null, {
    enabled,
  });
  return { sandbox, failed };
}
