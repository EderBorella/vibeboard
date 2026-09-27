import type { TickAction } from '../actions.js';
import type { AutopilotState } from '../autopilot-state.js';
import { MINI_BUILD, MINI_REVIEW } from '../phases.js';
import { isProjectRun, type RunRecord } from '../runs.js';

// THE MINI LIFECYCLE (decision 100): one run builds the whole project, then a review fixes what is wrong, for
// at most two rounds. After each round the loop runs the gates and the smoke command itself, and that result —
// not the review's word about its own fixes — decides whether the project is finished.
export const MINI_ROUNDS = 2;

// What the loop measured after the last review, carried to the next tick like a send-back it had nowhere to
// record: a project run has no card for a verdict to be written beside.
export interface MiniChecks {
  passed: boolean;
  detail: string;
}

export interface MiniInput {
  runs: RunRecord[];
  state: AutopilotState;
  miniChecks: MiniChecks | undefined;
}

const latest = (runs: RunRecord[]): RunRecord | undefined =>
  runs.reduce<RunRecord | undefined>(
    (last, r) => (last === undefined || r.started >= last.started ? r : last),
    undefined,
  );

// The run's own sentence about why it stopped — the build and the review are told to give one — or the note the
// server wrote for a run that gave none.
const reasonOf = (run: RunRecord): string =>
  run.summary?.trim() || run.report.trim().split('\n')[0]?.trim() || 'it said nothing about why';

const dispatch = (phase: 'mini-build' | 'mini-review', skill: string, previous?: string): TickAction => ({
  kind: 'dispatch',
  phase,
  skill,
  ...(previous === undefined ? {} : { previous }),
});

// Every Start begins at the build: an interrupted one is picked up from the board and the repository by a fresh
// build, which is why only this session's runs count.
export function miniAction({ runs, state, miniChecks }: MiniInput): TickAction {
  const session = runs.filter((r) => isProjectRun(r) && (state.at === undefined || r.started >= state.at));
  const build = latest(session.filter((r) => r.skill === MINI_BUILD));
  if (!build) return dispatch('mini-build', MINI_BUILD);
  if (build.status !== 'success') {
    return { kind: 'stop', reason: 'stalled', detail: `The build ended ${build.status}: ${reasonOf(build)}` };
  }
  const reviews = session.filter((r) => r.skill === MINI_REVIEW);
  const review = latest(reviews);
  if (!review) return dispatch('mini-review', MINI_REVIEW);
  if (review.status === 'success' && miniChecks?.passed === true) {
    return {
      kind: 'stop',
      reason: 'complete',
      detail:
        'Auto-pilot finished: the project is built and reviewed, and the gates and the smoke command pass when auto-pilot runs them. The cards are waiting for your approval.',
    };
  }
  if (reviews.length < MINI_ROUNDS) return dispatch('mini-review', MINI_REVIEW, review.run);
  const checks = miniChecks?.detail ?? 'Auto-pilot could not check the project after the last review.';
  const finished =
    review.status === 'success' ? '' : ` The review ended ${review.status}: ${reasonOf(review)}`;
  return {
    kind: 'stop',
    reason: 'stalled',
    detail: `The review did not get the project working in ${MINI_ROUNDS} rounds. ${checks}${finished}`,
  };
}
