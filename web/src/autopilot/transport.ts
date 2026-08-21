import { type AutopilotState, isSuccessReason, type Readiness, type RunList, type RunRecord } from '../api';

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

interface TransportModel {
  // The one big button. `kind` is what it does, not what it looks like.
  control: { kind: 'play' | 'stop'; disabled: boolean; label: string; title: string };
  // Always a sentence, never blank: a strip that says nothing is a strip nobody trusts.
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

// The ROW. Short by construction: anything that needs room goes to `detailFor` instead.
function statusFor(state: AutopilotState | null, doing: ActiveWork[], missing: string[]): string {
  if (state?.state === 'halted') {
    return 'Halted. Everything in this project was stopped.';
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
  if (state?.state === 'stopped') {
    // Two words, because `detail` already carries the loop's own full sentence — the server stores
    // `stopSentence(reason, detail)`, canned explanation and specifics together — and that now has a
    // block of its own to wrap in.
    return state.reason && isSuccessReason(state.reason) ? 'Finished.' : 'Stopped.';
  }
  return 'Not started.';
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
