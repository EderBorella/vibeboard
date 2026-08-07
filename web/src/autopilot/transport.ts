import { type AutopilotState, isSuccessReason, type Readiness, type RunList, type RunRecord } from '../api';

// What the transport strip shows, as data rather than as JSX.
//
// It is a separate module because the interesting part is the DECISIONS — which control to offer, what
// to say when nothing is running, whether there is anything worth expanding — and those are worth
// asserting directly. Reaching them through a rendered component means mocking four hooks to check a
// sentence, and the last few defects in this feature all hid behind exactly that.

export type Tone = 'idle' | 'running' | 'stopped' | 'complete' | 'halted';

// One thing an agent is doing right now, named the way a person would name it.
export interface ActiveWork {
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
  // Always a sentence, never blank: a strip that says nothing is a strip nobody trusts.
  status: string;
  tone: Tone;
  doing: ActiveWork[];
  missing: string[];
  // Whether opening the drawer would show anything. A disclosure arrow that reveals emptiness is worse
  // than no arrow.
  expandable: boolean;
}

const HALTED_TITLE = 'This project is halted. Restart it from the overlay before starting auto-pilot.';
const NOT_READY = (n: number): string => `${n} thing${n === 1 ? '' : 's'} to fix before it can start`;

function toneOf(state: AutopilotState | null): Tone {
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

function statusFor(state: AutopilotState | null, doing: ActiveWork[], missing: string[]): string {
  if (state?.state === 'halted') {
    return state.detail ?? 'Everything in this project was stopped.';
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
  // Stopped: the loop's own sentence, which names WHICH cards are stuck and why. Far better than the
  // one-word reason, and it used to be reachable only by hovering a chip.
  if (state?.state === 'stopped' && state.detail) return state.detail;
  if (missing.length > 0) return NOT_READY(missing.length);
  return state?.state === 'stopped' ? 'Stopped.' : 'Not started.';
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
    tone: toneOf(state),
    doing,
    missing,
    expandable: doing.length > 0 || missing.length > 0,
  };
}
