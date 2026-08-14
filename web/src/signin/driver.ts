import { ApiError, type SigninCollected, type SigninRequestOpened } from '../api';

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
  // A credential this browser already holds — a `?token=` launch URL, or localStorage from before the
  // cookie transport. Handed to the server so it can set the cookie; see `adoptCredential`.
  legacyToken: () => string;
  adopt: (token: string) => Promise<void>;
  forgetLegacy: () => void;
  claim: () => Promise<{ token: string }>;
  request: () => Promise<SigninRequestOpened>;
  collect: (id: string) => Promise<SigninCollected>;
  // Called once a credential exists. There is nothing to STORE — the server set an HttpOnly cookie as
  // it answered — so this only tells the app, which is what wakes the socket out of its dead end.
  onCredential: () => void;
  sleep: (ms: number) => Promise<void>;
  onPhase: (phase: SigninPhase) => void;
}

// Polled rather than pushed: this browser has no credential, so it cannot hold the socket the pushes
// go over. Two seconds is fast enough to feel immediate and slow enough that the request's own
// two-minute TTL is 60 polls, not thousands.
const POLL_MS = 2_000;
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
  // BEFORE CLAIMING, because a browser that already holds a credential must not ask to be let in: the
  // claim would be refused (a device exists — its own), and it would then wait for an approval that
  // only it could give. That is the upgrade path from the pre-cookie release, and the `?token=`
  // recovery route lands here too.
  if (await adopt(deps)) return true;
  try {
    await deps.claim();
    return arrived(deps);
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

// Announced before the phase, and the order is deliberate: the announcement is what wakes the socket,
// and it must find the cookie already set rather than waiting on a React render to tell it.
function arrived(deps: SigninDeps): boolean {
  deps.onCredential();
  deps.onPhase({ phase: 'in' });
  return true;
}

// The old credential is FORGOTTEN either way. If it worked, the cookie has replaced it; if it did not,
// keeping it means retrying a dead token on every load for ever, and the flow below is the real answer.
async function adopt(deps: SigninDeps): Promise<boolean> {
  const token = deps.legacyToken();
  if (!token) return false;
  try {
    await deps.adopt(token);
  } catch {
    deps.forgetLegacy();
    return false;
  }
  deps.forgetLegacy();
  return arrived(deps);
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
    if (answer.state === 'approved') return arrived(deps);
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
