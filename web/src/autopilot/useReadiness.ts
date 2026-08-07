import { useEffect, useState } from 'react';
import { getReadiness, type Readiness } from '../api';

// "Could auto-pilot start here, and if not, why not?" — asked in one place because two callers now need
// it: the transport strip in the header and the panel in Settings. Two copies of the fetch would be two
// answers that can disagree, and the whole point of the endpoint is that the settings panel and the
// dispatch gate read the same list.
//
// Null means NOT ASKED YET, which is deliberately different from "nothing is missing": a strip that
// showed reassurance before the answer arrived would be lying for the length of a round trip.
// `failed` is separate from `readiness === null` on purpose, and a test caught me collapsing them: the
// panel says "could not read this project's readiness" out loud, because silently showing no blockers
// when the question could not be asked is the same lie as claiming it is ready.
export function useReadiness(
  trigger: unknown,
  enabled = true,
): { readiness: Readiness | null; failed: boolean } {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `trigger` is a deliberate refetch signal
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getReadiness()
      .then((r) => {
        if (!live) return;
        setReadiness(r);
        setFailed(false); // a good answer clears an earlier failure
      })
      .catch(() => {
        // `readiness` is left as it was rather than reset: a failed refetch must not erase a good
        // answer, and null is already "not asked", which renders as no claim either way.
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [trigger, enabled]);

  return { readiness, failed };
}
