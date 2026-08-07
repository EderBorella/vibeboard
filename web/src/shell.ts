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

export type ShellContent = 'signin' | 'loading' | 'gate' | 'empty' | 'work';

export interface ShellState {
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
