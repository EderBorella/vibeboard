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

export function chooseContent(state: ShellState): ShellContent {
  if (!state.signedIn) return 'signin';
  if (!state.ready) return 'loading';
  if (state.showGate) return 'gate';
  if (!state.hasSnapshot) return 'empty';
  return 'work';
}
