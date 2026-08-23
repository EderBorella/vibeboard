import type { ConnState } from '../lib/ws';
import {
  type LightState,
  lightFor,
  lightTitle,
  type RecentFailure,
  type RefusalKind,
} from '../organisms/topbar/connection-light';

// What the shell puts in its main area, as a decision rather than a chain of ternaries in JSX.
//
// It is here, in one pure function, because THE ORDER IS A BUG THAT ALREADY HAPPENED. A browser with
// no credential was shown the project gate: `listProjects` 401'd and was rendered as an empty list,
// every button on the gate failed, and the only clue anywhere was one red "unauthorized". Sign-in has
// to be answered before the question "which project?", because without a credential that question
// cannot be answered at all.
//
// Testing this by mounting the shell would mean mocking a dozen hooks to assert on markup; testing it
// here costs four booleans.

type ShellContent = 'signin' | 'loading' | 'gate' | 'empty' | 'work';

interface ShellState {
  signedIn: boolean;
  // Whether the first `getState` has answered. Meaningless before signing in, which is why the order
  // below never consults it first.
  ready: boolean;
  showGate: boolean;
  hasSnapshot: boolean;
}

// Whether signing in has just happened, and everything keyed on the project counter therefore has to
// be re-run: the socket re-opened and every mount-time fetch repeated.
//
// It matters because those fetches and that socket are NOT retried by anything else. Five hooks fetch
// on mount and are keyed on nothing that changes afterwards, and the socket declines to open at all
// without a credential — so a browser that signed itself in silently sat on an empty board with a
// dead socket until someone reloaded it by hand.
//
// The `previous` half is what keeps it to the TRANSITION: a browser that arrives already holding a
// credential is signed in on its first render, and rebinding then would throw away the socket it had
// just opened.
export function rebindOnSignIn(signedIn: boolean, previous: boolean): boolean {
  return signedIn && !previous;
}

export function chooseContent(state: ShellState): ShellContent {
  if (!state.signedIn) return 'signin';
  if (!state.ready) return 'loading';
  if (state.showGate) return 'gate';
  if (!state.hasSnapshot) return 'empty';
  return 'work';
}

// EVERY LIGHT PROP THE TOP BAR TAKES, DERIVED IN ONE PLACE — and it exists because the hop it replaces
// could not be tested and was silently broken by a planted defect.
//
// `App.tsx` reached into the sandbox state four separate times to feed the light: two arguments to
// `lightFor`, three to `lightTitle`, and three props on `<TopBar>`. Nothing in the repo mounts `App` —
// the established answer to that is this very file, whose header says testing the shell by mounting it
// "would mean mocking a dozen hooks to assert on markup". So all four reaches were unverifiable, and
// deleting one of them — measured — left the light unable to ever report a failure in the real product
// with all 114 tests of the feature still green.
//
// SPREAD AT THE CALL SITE, which is the half that actually closes the hole. The keys here are exactly
// TopBar's prop names, so `<TopBar {...lightProps(conn, sandbox)} />` cannot drop one of them: a missing
// key is a type error rather than a light that quietly never changes colour. Testing this function then
// costs one object instead of a mounted shell.
export function lightProps(
  conn: ConnState,
  // STRUCTURAL, not `SandboxState` imported from the API layer. This file is the shell's own reasoning
  // and `connection-light.ts` keeps itself clear of the wire types for the same reason — see the note on
  // `RefusalKind` there. `undefined` is the sandbox not having answered yet, which every function below
  // already distinguishes from "nothing is wrong".
  sandbox:
    | {
        agentRefusal: string | null;
        refusalKind?: RefusalKind | null;
        recentFailure?: RecentFailure | null;
      }
    | null
    | undefined,
): {
  light: LightState;
  lightTitle: string;
  agentRefusal: string | null | undefined;
  refusalKind: RefusalKind | null | undefined;
  recentFailure: RecentFailure | null | undefined;
} {
  const light = lightFor(conn, sandbox?.agentRefusal, sandbox?.recentFailure);
  return {
    light,
    lightTitle: lightTitle(light, sandbox?.agentRefusal, sandbox?.recentFailure),
    agentRefusal: sandbox?.agentRefusal,
    refusalKind: sandbox?.refusalKind,
    recentFailure: sandbox?.recentFailure,
  };
}
