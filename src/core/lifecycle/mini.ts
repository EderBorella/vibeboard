import type { DeclaredCommands } from '../../store/project/foundation.js';
import type { TickAction } from '../actions.js';
import type { AutopilotState } from '../autopilot-state.js';
import { MINI_BUILD, MINI_REVIEW } from '../phases.js';
import { isProjectRun, type RunRecord } from '../runs.js';
import { tail, type Verification } from '../verify.js';

// THE MINI LIFECYCLE (decision 100): one run builds the whole project, then a review fixes what is wrong, for
// at most two rounds. After each round the loop runs the gates and the smoke command itself and writes what they
// did onto the review's record — and that, not the review's word about its own fixes, decides.
export const MINI_ROUNDS = 2;

export interface MiniInput {
  runs: RunRecord[];
  state: AutopilotState;
  commands: DeclaredCommands;
}

const latest = (runs: RunRecord[]): RunRecord | undefined =>
  runs.reduce<RunRecord | undefined>(
    (last, r) => (last === undefined || r.started >= last.started ? r : last),
    undefined,
  );

// The run's own sentence about why it stopped — the build and the review are told to give one — or the note the
// server wrote for a run that gave none: a report of a stopped run is its transcript's tail, not a sentence.
const reasonOf = (run: RunRecord): string =>
  run.summary?.trim() || run.note?.trim() || 'it said nothing about why';

// Which command failed and what it printed, because that is where a person starts.
export function checksSentence(v: Verification | undefined): string {
  if (v === undefined) return 'Auto-pilot could not check the project after the last review.';
  if (v.passed) return 'The gates and the smoke command pass.';
  const what = v.command ? `\`${v.command}\` failed` : `The ${v.mode} could not run`;
  if (v.output?.trim()) return `${what}:\n${tail(v.output.trim(), 1500)}`;
  return v.reason ? `${what}: ${v.reason}` : `${what}.`;
}

const dispatch = (phase: 'mini-build' | 'mini-review', skill: string, previous?: string): TickAction => ({
  kind: 'dispatch',
  phase,
  skill,
  ...(previous === undefined ? {} : { previous }),
});

const stalled = (detail: string): TickAction => ({ kind: 'stop', reason: 'stalled', detail });

// Decision 66: a smoke command that is one of the gates proves nothing the gates did not.
function smokeIsAGate(commands: DeclaredCommands): TickAction | undefined {
  if (commands.smoke === undefined || !commands.gates.includes(commands.smoke)) return undefined;
  return stalled(
    `The smoke command \`${commands.smoke}\` is one of the gates, so passing it proves nothing more. Declare a smoke command that uses the product the way the README describes, then start auto-pilot again.`,
  );
}

// Every Start begins at the build: an interrupted one is picked up from the board and the repository by a fresh
// build, which is why only this session's runs count.
export function miniAction({ runs, state, commands }: MiniInput): TickAction {
  const session = runs.filter((r) => isProjectRun(r) && (state.at === undefined || r.started >= state.at));
  const build = latest(session.filter((r) => r.skill === MINI_BUILD));
  if (!build) return dispatch('mini-build', MINI_BUILD);
  if (build.status !== 'success') return stalled(`The build ended ${build.status}: ${reasonOf(build)}`);
  const reviews = session.filter((r) => r.skill === MINI_REVIEW);
  const review = latest(reviews);
  if (!review) return dispatch('mini-review', MINI_REVIEW);
  if (review.status === 'success' && review.verification?.passed === true) {
    return (
      smokeIsAGate(commands) ?? {
        kind: 'stop',
        reason: 'complete',
        detail:
          'Auto-pilot finished: the project is built and reviewed, and the gates and the smoke command pass when auto-pilot runs them. The review closed the cards it verified; any still open are waiting for you.',
      }
    );
  }
  if (reviews.length < MINI_ROUNDS) return dispatch('mini-review', MINI_REVIEW, review.run);
  const finished =
    review.status === 'success' ? '' : ` The review ended ${review.status}: ${reasonOf(review)}`;
  return stalled(
    `The review did not get the project working in ${MINI_ROUNDS} rounds. ${checksSentence(review.verification)}${finished}`,
  );
}
