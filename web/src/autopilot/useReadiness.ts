import { getReadiness, type Readiness } from '../api';
import { useFetched } from '../useFetched';

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
  // A failed refetch leaves the last good answer where it was — and while disabled, likewise: not
  // asking is not the same as being told nothing is there.
  const { value: readiness, failed } = useFetched<Readiness | null>(getReadiness, [trigger], null, {
    enabled,
  });
  return { readiness, failed };
}
