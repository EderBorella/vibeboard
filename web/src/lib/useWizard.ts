import { useEffect, useState } from 'react';
import { getWizard } from './api';
import type { ScaffoldMode, WizardStep } from './shared';

// WHERE A WIZARD OPENS. `identity` is the browser's own step — it runs before there is a project, so
// there is nothing on disk to name it — and the rest are the steps the state file names.
export type WizardStart = 'identity' | WizardStep;

export interface WizardEntry {
  mode: ScaffoldMode;
  // A DOOR STARTS AT `identity` WHATEVER IS OPEN, and an offer to finish resumes at the saved step.
  // Deriving this from "is a project open" instead is wrong on a real path and was: Switch project
  // from an open board, then New project, and a person asking for a new one was handed the step after
  // the one that makes it.
  step: WizardStart;
}

// WHICH KIND OF SETUP IS ON SCREEN, and the one thing that puts it there without a press: a project
// whose wizard file is still on disk is setup half-done, so opening it offers to finish. Skipping KEEPS
// that file — only `Stop offering this` deletes it — which is what makes the offer come back and is the
// whole of what "resumable later" means here. decision 76.
//
// KEYED ON THE OPEN PROJECT'S ROOT AND NOT ON THE SHELL'S `bump`. Four other things pull that counter —
// signing in, a backend change, a forgiven run, a cleared attempt count — so an offer hung off it would
// walk a person straight back into the wizard they had just skipped. The root changes exactly when a
// different project is opened, which is the question this asks.
//
// A HOOK RATHER THAN AN EFFECT IN `App.tsx`, for the reason templates/shell.ts gives about the content
// order: nothing in this repository mounts the shell, so a rule written inside it is a rule nothing can
// test. This one is two lines of policy and both of them are worth a test.
export function useWizard(
  // The open project's root, `undefined` while none is. Taken as the snapshot HAS it rather than as a
  // normalised null: the shell is at its cognitive-complexity ceiling, and a `?? null` at the call site
  // is a logical operator the metric charges for saying nothing.
  signedIn: boolean,
  openRoot: string | undefined,
): [WizardEntry | null, (entry: WizardEntry | null) => void] {
  const [entry, setEntry] = useState<WizardEntry | null>(null);

  useEffect(() => {
    if (!signedIn || !openRoot) return;
    // An answer that lands after the project moved on is DROPPED — the same flag `useFetched` carries
    // and for the same reason: the previous project's setup must not open over the one now on screen.
    let live = true;
    getWizard()
      .then(({ state }) => {
        if (live && state) setEntry({ mode: state.mode, step: state.step });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn, openRoot]);

  return [entry, setEntry];
}
