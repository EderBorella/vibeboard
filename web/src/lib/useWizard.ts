import { useCallback, useEffect, useRef, useState } from 'react';
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

// SETUP AS THE SHELL SEES IT: what is on screen, and what the project still has waiting. They are two
// different questions and they part company the moment somebody skips — skipping KEEPS the file, and
// only ENDING setup deletes it, whether that ending is finishing it or pressing `Stop offering this`.
// That difference is the whole of what "resumable later" means. decision 76.
export interface Setup {
  // Which kind of setup is on screen, `null` for none. A content state rather than a flag on something
  // else, so it is an answer to "what is the shell showing".
  entry: WizardEntry | null;
  // Whether this project has an unfinished setup at all, on screen or not. What the readiness wall asks
  // before it offers a way back in — the person standing in front of those blockers is usually the
  // person who skipped the assistant that would have cleared them.
  pending: boolean;
  // Put setup on screen. A door, which always starts at `identity`.
  show: (entry: WizardEntry) => void;
  // Off the screen, and re-read the file. The wizard reports NONE of its three exits — skip, abandon
  // and finish all arrive here as one call — so re-reading is the only way to learn which just
  // happened, and the answer is exactly what the wall may then offer.
  leave: () => void;
  // Back on the screen, at the step the file names.
  resume: () => void;
}

// The one thing that puts setup on screen without a press: a project whose wizard file is still on disk
// is setup half-done, so opening it offers to finish.
//
// OFFERED ON A CHANGED ROOT AND ON NOTHING ELSE. "A different project has been opened" is the question,
// and the shell's `bump` is not it: four other things pull that counter — signing in, a backend change,
// a forgiven run, a cleared attempt count — so an offer hung off it would walk a person straight back
// into the wizard they had just skipped.
//
// THE ROOT ALONE IS NOT THE EFFECT'S KEY, THOUGH, AND THAT WAS THE HOLE. `signedIn` has to be a
// dependency — with no credential the read 401s — and it flips false→true on the re-bind the shell
// performs, which put the skipped wizard back on screen for an event that says nothing about the
// project. So the last root OFFERED FOR is held, and only a genuinely different one may open the
// screen. Recorded when the answer lands rather than when the read starts, because StrictMode mounts
// twice and the first mount's answer is dropped — recording it on the way out would spend the one
// offer on a read nobody sees.
//
// A HOOK RATHER THAN AN EFFECT IN `App.tsx`, for the reason templates/shell.ts gives about the content
// order: nothing in this repository mounts the shell, so a rule written inside it is a rule nothing can
// test. Every line of policy here has a test, and the wall's offer is the third of them.
export function useWizard(
  // The open project's root, `undefined` while none is. Taken as the snapshot HAS it rather than as a
  // normalised null: the shell is at its cognitive-complexity ceiling, and a `?? null` at the call site
  // is a logical operator the metric charges for saying nothing.
  signedIn: boolean,
  openRoot: string | undefined,
): Setup {
  const [entry, setEntry] = useState<WizardEntry | null>(null);
  // What the FILE last said, which outlives a skip. `entry` is taken off the screen by leaving; this is
  // taken away only by the file going.
  const [saved, setSaved] = useState<WizardEntry | null>(null);
  // The root the offer was last SPENT on. A ref and not state: nothing renders from it, and it must
  // survive the render its own answer causes.
  const offeredFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!signedIn || !openRoot) return;
    // Read on every run, offered only on a new root: `pending` is what the readiness wall asks and it
    // has to be current, even on a run that may not put anything on screen.
    const unoffered = offeredFor.current !== openRoot;
    // An answer that lands after the project moved on is DROPPED — the same flag `useFetched` carries
    // and for the same reason: the previous project's setup must not open over the one now on screen.
    let live = true;
    getWizard()
      .then(({ state }) => {
        if (!live) return;
        const next = state ? { mode: state.mode, step: state.step } : null;
        setSaved(next);
        offeredFor.current = openRoot;
        // Opening is the READ's doing, and only this read's: the one on the way out must never put back
        // on screen what was just taken off it.
        if (next && unoffered) setEntry(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn, openRoot]);

  // In the handler rather than in an effect, because leaving is an event and not a state to converge
  // on: an effect keyed on a counter would re-run under StrictMode's second mount and on every project
  // change beside the read above.
  const leave = useCallback(() => {
    setEntry(null);
    getWizard()
      .then(({ state }) => setSaved(state ? { mode: state.mode, step: state.step } : null))
      .catch(() => {});
  }, []);

  return {
    entry,
    pending: saved !== null,
    show: setEntry,
    leave,
    resume: () => setEntry(saved),
  };
}
