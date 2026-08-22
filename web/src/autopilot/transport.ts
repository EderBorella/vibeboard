import { type AutopilotState, isSuccessReason, type Readiness, type RunList, type RunRecord } from '../api';
import type { StatusAdvice } from '../ui/StatusChip';

// What the transport strip shows, as data rather than as JSX.
//
// It is a separate module because the interesting part is the DECISIONS — which control to offer, what
// to say when nothing is running, whether there is anything worth expanding — and those are worth
// asserting directly. Reaching them through a rendered component means mocking four hooks to check a
// sentence, and the last few defects in this feature all hid behind exactly that.

// THE STATE THE STRIP IS IN, and it was called `Tone` until Phase 13. These are state names — a tone
// is one of the five colours in ui/state-tones.ts, and calling the state a tone is what let three
// surfaces each hold their own translation of it. `AutopilotBar` had a `DOT_TONE` table doing exactly
// that and disagreeing with the top bar's chip about `complete`.
export type TransportState = 'idle' | 'running' | 'stopped' | 'complete' | 'halted';

// One thing an agent is doing right now, named the way a person would name it.
interface ActiveWork {
  run: string;
  label: string;
  skill: string;
  // Queued rather than started: a dispatch already decided, waiting for a slot. Shown distinctly
  // because "waiting" and "working" are different answers to "what is it doing".
  waiting: boolean;
}

export interface TransportModel {
  // The one big button. `kind` is what it does, not what it looks like.
  control: { kind: 'play' | 'stop'; disabled: boolean; label: string; title: string };
  // WHAT THE CHIP OPENS ONTO. In the model rather than computed at the call site so the sentences are
  // asserted directly, which is the reason this whole module exists.
  advice: StatusAdvice;
  // THE STATE IN ONE WORD, for the chip. It was `chipFor` in app/TopBar.tsx until the owner ruled that
  // the top bar does not need a second auto-pilot indicator — see `wordFor`.
  word: string;
  // WHAT THE WORD CANNOT SAY, and it MAY now be empty. It used to be "always a sentence, never blank: a
  // strip that says nothing is a strip nobody trusts" — which was right while the row's only statement
  // of the state was this string. With the chip beside it, `Stopped.` and `Not started.` were the chip's
  // word again in a full stop, so those two states say nothing here and the chip says it once.
  status: string;
  state: TransportState;
  doing: ActiveWork[];
  missing: string[];
  // Whether opening the drawer would show anything. A disclosure arrow that reveals emptiness is worse
  // than no arrow.
  expandable: boolean;
  // An agent rewrote a document whose commands auto-pilot will run OUTSIDE the sandbox, as the user.
  // The only blocker a person clears rather than fixes, so it is named rather than left to be matched
  // out of the blocker prose.
  reviewGates: boolean;
  // The emergency stop. On the bar rather than only in Settings — a control that kills work is no use
  // behind a modal you cannot reach while the thing you want to stop is running, and it was: the
  // acknowledge button had the same problem and that is how a user got stuck with no way out.
  //
  // Disabled while halted, because there is nothing left to kill and the way back is the overlay.
  emergency: { disabled: boolean; title: string };
  // WHY it stopped, in full, when there is more to say than fits on a line.
  //
  // Separate from `status` because `status` is a row: one line, ellipsised, and these sentences are
  // deliberately long — they name the branch that could not be created, the git output underneath, the
  // cards that are stuck. Truncated, the useful half is always the half that is cut. Reported twice by
  // the same user before it was fixed, the second time by reading it out of the DOM by hand.
  detail: string | null;
}

const HALTED_TITLE = 'This project is halted. Restart it from the overlay before starting auto-pilot.';
const NOT_READY = (n: number): string => `${n} thing${n === 1 ? '' : 's'} to fix before it can start`;

function stateOf(state: AutopilotState | null): TransportState {
  if (!state || state.state === 'idle') return 'idle';
  if (state.state === 'running') return 'running';
  if (state.state === 'halted') return 'halted';
  // `complete` is the only stop that reads as success. An exhausted budget and a reached cap both end
  // tidily and neither means the work is done.
  const reason = state.reason ?? 'stopped';
  return isSuccessReason(reason) ? 'complete' : 'stopped';
}

// THE STATE AS A CHIP'S WORD. This is `app/TopBar.tsx`'s `chipFor` moved here, minus its
// `auto-pilot running` — the prefix existed because that chip sat beside a project name with no other
// context, and on the bar that runs the loop it is the only thing the row could be about.
//
// A STOP IS NAMED BY ITS REASON. `stalled`, `exhausted`, `capped` and `killed` are four different things
// to do next, and `stopped` is the fallback for a stop that arrived without one — not a fifth reason.
function wordFor(state: AutopilotState | null): string {
  if (!state || state.state === 'idle') return 'not started';
  if (state.state === 'running') return 'running';
  if (state.state === 'halted') return 'halted';
  return state.reason ?? 'stopped';
}

function workFrom(runs: RunList): ActiveWork[] {
  const byId = new Map(runs.runs.map((r) => [r.run, r]));
  const name = (id: string, waiting: boolean): ActiveWork => {
    const record: RunRecord | undefined = byId.get(id);
    return {
      run: id,
      // The CARD is what a person is watching, so it leads. A project-level run — a checkup or a
      // pre-flight — has no card, and saying so beats showing a bare run id.
      label: record?.card ?? 'this project',
      skill: record?.skill ?? 'a skill',
      waiting,
    };
  };
  return [...runs.active.map((id) => name(id, false)), ...runs.queued.map((id) => name(id, true))];
}

// The full explanation, wherever there is one. `detail` is what the loop wrote — which cards are stuck,
// what git said, which branch it could not make — and it is the part a person actually needs.
function detailFor(state: AutopilotState | null): string | null {
  if (!state) return null;
  if (state.state === 'stopped' || state.state === 'halted') return state.detail ?? null;
  return null;
}

// WHAT THE TOP BAR'S CHIP SAYS WHEN YOU CLICK IT, and until now the answer was "nothing you can read
// on a phone": the chip put its whole explanation in a `title`, so the one indicator that follows you
// across all five tabs was the only one of the four with no way to open it.
//
// HERE RATHER THAN IN `TopBar`, for the reason the rest of this module is here: it is a decision about
// what to SAY, it is worth asserting directly, and reaching it through a rendered component means
// mocking four hooks to check a sentence. It is `lightAdvice`'s counterpart — same shape, same split
// between our heading and the server's detail.
//
// THE DETAIL IS THE SERVER'S OWN SENTENCE WHEREVER THERE IS ONE. `state.detail` holds
// `stopSentence(reason, detail)` — the canned explanation and the specifics, composed on the server by
// the code that stopped the loop. Rewording it here would be a second description of a rule this chip
// does not enforce, and two descriptions of one rule in this codebase have already drifted apart.
//
// `next` IS ABSENT ON A SUCCESS, deliberately, and it is the same contract `LightAdvice` states: an
// instruction implies something is wrong, so a finished run gets no instruction.
// NOT STARTED, and it splits on whether anything is stopping it — which is the one thing a person opening
// this chip on an idle project wants to know, and it was two clicks into the drawer.
//
// ITS OWN FUNCTION because `autopilotAdvice` went past the cognitive-complexity ceiling with this branch
// inline, and the fix for that rule is FLATTENING rather than a longer function: a ternary inside an early
// return is two levels of nesting the four branches below it do not have.
function notStartedAdvice(missing: string[]): StatusAdvice {
  const heading = 'Auto-pilot has not started';
  if (missing.length === 0) {
    return {
      heading,
      detail: 'Nothing has been dispatched on this project yet.',
      next: 'Press play to start the loop.',
    };
  }
  return {
    heading,
    detail: `There ${missing.length === 1 ? 'is' : 'are'} ${NOT_READY(missing.length)}.`,
    next: 'Open Details on this bar to see what they are.',
  };
}

export function autopilotAdvice(state: AutopilotState | null, missing: string[] = []): StatusAdvice {
  if (!state || state.state === 'idle') return notStartedAdvice(missing);
  if (state.state === 'running') {
    const n = state.iteration;
    return {
      heading: 'Auto-pilot is running',
      detail: `${n} dispatch${n === 1 ? '' : 'es'} so far.`,
      next: 'The auto-pilot bar on the Boards tab names the card it is working on, and stops it.',
    };
  }
  if (state.state === 'halted') {
    return {
      heading: 'Auto-pilot is halted',
      detail: state.detail ?? 'Everything in this project was stopped.',
      // The overlay and not the play button: a halt takes the chat and manual runs down with it, and
      // `emergency.title` below says the same thing to anyone who tries to halt it twice.
      next: 'Restart the project from the overlay before anything here can run again.',
    };
  }
  const reason = state.reason ?? 'stopped';
  if (isSuccessReason(reason)) {
    return {
      heading: 'Auto-pilot finished',
      detail: state.detail ?? 'The board has no unfinished work left.',
    };
  }
  return {
    heading: `Auto-pilot stopped: ${reason}`,
    detail: state.detail ?? 'The loop stopped and the server recorded no further detail.',
    next: 'Press play on the auto-pilot bar to start it again.',
  };
}

// The ROW. Short by construction: anything that needs room goes to `detailFor` instead.
function statusFor(state: AutopilotState | null, doing: ActiveWork[], missing: string[]): string {
  if (state?.state === 'halted') {
    // The word `Halted` came off the front of this when the chip beside it started carrying it. What is
    // left is the part the chip cannot fit and a person does not expect: a halt stops the chat and the
    // manual runs too, not only the loop.
    return 'Everything in this project was stopped.';
  }
  if (state?.state === 'running') {
    const n = state.iteration;
    const counted = `${n} dispatch${n === 1 ? '' : 'es'}`;
    // Naming the work beats a spinner. Between dispatches there genuinely is none, and the loop is
    // deciding what comes next — which is worth saying rather than leaving the line to look stalled.
    const work =
      doing.length === 0 ? 'choosing the next card' : doing.map((w) => `${w.label} · ${w.skill}`).join(', ');
    return `${counted} · ${work}`;
  }
  if (missing.length > 0) return NOT_READY(missing.length);
  // NOTHING, for the two states whose whole row was the chip's own word. This returned `Finished.` or
  // `Stopped.` — and before that the loop's entire explanation, which is why `detail` exists — and the
  // chip now says `complete` or `stalled` two elements to the left. `Not started.` went the same way.
  // The full sentence is still rendered, in `ap-bar-detail`, wrapping.
  return '';
}

export function transportModel(input: {
  state: AutopilotState | null;
  runs: RunList;
  readiness: Readiness | null;
  // True between the click and the server's answer, so the button cannot be pressed twice.
  starting: boolean;
}): TransportModel {
  const { state, runs, readiness, starting } = input;
  const running = state?.state === 'running';
  const halted = state?.state === 'halted';
  const doing = workFrom(runs);
  // Absent readiness means "not asked yet", which is not the same as "nothing missing" — so it shows
  // no blockers rather than inventing reassurance.
  const missing = readiness && !readiness.ok ? readiness.blockers : [];

  const control = running
    ? {
        kind: 'stop' as const,
        disabled: false,
        label: 'Stop',
        title: 'Stop dispatching. Runs already in flight finish; nothing is killed.',
      }
    : {
        kind: 'play' as const,
        // NOT disabled merely because the project is unready: pressing it is how you find out what is
        // missing, and the refusal is a sentence. Halted is different — that needs a person's decision
        // on the overlay first, and the button would refuse every time.
        disabled: halted || starting,
        label: starting ? 'Starting…' : 'Start',
        title: halted ? HALTED_TITLE : 'Start auto-pilot on this project.',
      };

  return {
    control,
    word: wordFor(state),
    advice: autopilotAdvice(state, missing),
    status: statusFor(state, doing, missing),
    detail: detailFor(state),
    state: stateOf(state),
    doing,
    missing,
    expandable: doing.length > 0 || missing.length > 0,
    reviewGates: (readiness?.unreviewedGates?.length ?? 0) > 0,
    emergency: {
      disabled: halted,
      title: halted
        ? 'Already halted. Restart it from the overlay.'
        : 'Kill every agent in this project and halt it. Asks first.',
    },
  };
}
