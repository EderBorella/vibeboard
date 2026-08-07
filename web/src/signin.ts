import { ApiError, type SigninCollected, type SigninRequestOpened } from './api';

// The browser's half of signing in, as a plain driver with its calls and its clock injected — so the
// whole flow is testable without a DOM, and the component below it renders one of three states and
// nothing else.
//
// THE TARGET EXPERIENCE: open the URL and the board is there. The first browser ever to load the page
// claims a credential silently and shows this screen for a few milliseconds; a later one shows
// "waiting for approval" until somebody clicks Allow on a browser that is already in. No button, no
// code, no command, no pasting, at either end.

export type SigninPhase =
  // Trying to be first. The common case, and over before it can be read.
  | { phase: 'claiming' }
  // Somebody else is already signed in, so a person has to allow this browser. `label` and `address`
  // are what that person will be shown, repeated here so the two can be matched.
  | { phase: 'waiting'; label: string; address: string }
  // Nothing more will happen on its own. `retry` says whether trying again could plausibly work — a
  // refusal is a decision and offers none; a rate limit or a busy project will pass.
  | { phase: 'stopped'; reason: string; retry: boolean }
  | { phase: 'in' };

export interface SigninDeps {
  claim: () => Promise<{ token: string }>;
  request: () => Promise<SigninRequestOpened>;
  collect: (id: string) => Promise<SigninCollected>;
  setToken: (token: string) => void;
  sleep: (ms: number) => Promise<void>;
  onPhase: (phase: SigninPhase) => void;
}

// Polled rather than pushed: this browser has no credential, so it cannot hold the socket the pushes
// go over. Two seconds is fast enough to feel immediate and slow enough that the request's own
// two-minute TTL is 60 polls, not thousands.
export const POLL_MS = 2_000;
export const POLL_LIMIT = 70; // a little past the server's 120s TTL, so the timeout is the server's

const REFUSED = 'That was refused on the browser you asked. Nothing was signed in.';
const EXPIRED = 'Nobody answered in time. Ask again when someone can allow it.';
const FAILED = 'VibeBoard could not be reached. Check the server is running, then try again.';

function stopped(reason: string, retry: boolean): SigninPhase {
  return { phase: 'stopped', reason, retry };
}

// The sentence to show when a call was refused, and whether trying again is worth offering. The
// server's own words are used wherever it sent any — it knows what is running and this does not.
function refusal(err: unknown, fallback: string): SigninPhase {
  if (!(err instanceof ApiError)) return stopped(fallback, true);
  // 'busy' (agents running) and the two rate limits all pass on their own, so retry is offered.
  return stopped(err.message, true);
}

// Resolves true once a credential is stored. Every other outcome has already been reported through
// `onPhase` with a sentence explaining it — which is the entire point of the screen: the bug this
// replaces showed a working board on which every button silently failed.
export async function runSignin(deps: SigninDeps): Promise<boolean> {
  deps.onPhase({ phase: 'claiming' });
  try {
    const { token } = await deps.claim();
    deps.setToken(token);
    deps.onPhase({ phase: 'in' });
    return true;
  } catch (err) {
    // 'claimed' is the ordinary case — a browser is already signed in, so ask it. Anything else stops
    // here with the server's explanation, because there is nothing useful to try.
    if (!(err instanceof ApiError) || err.reason !== 'claimed') {
      deps.onPhase(refusal(err, FAILED));
      return false;
    }
  }
  return askToBeApproved(deps);
}

async function askToBeApproved(deps: SigninDeps): Promise<boolean> {
  let opened: SigninRequestOpened;
  try {
    opened = await deps.request();
  } catch (err) {
    deps.onPhase(refusal(err, FAILED));
    return false;
  }
  deps.onPhase({ phase: 'waiting', label: opened.label, address: opened.address });

  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    await deps.sleep(POLL_MS);
    let answer: SigninCollected;
    try {
      answer = await deps.collect(opened.id);
    } catch {
      // A dropped connection mid-wait is not a decision. Keep polling — the server may be restarting,
      // and giving up here would put "refused" on screen for a network blip.
      continue;
    }
    if (answer.state === 'approved') {
      deps.setToken(answer.token);
      deps.onPhase({ phase: 'in' });
      return true;
    }
    if (answer.state === 'refused') {
      deps.onPhase(stopped(REFUSED, false)); // a person decided; offering "try again" argues with them
      return false;
    }
    if (answer.state === 'expired') {
      deps.onPhase(stopped(EXPIRED, true));
      return false;
    }
  }
  deps.onPhase(stopped(EXPIRED, true));
  return false;
}
