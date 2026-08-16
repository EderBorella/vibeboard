import type { BoardName } from '../types.js';
import type { Verification } from '../verify.js';

// A run is a file: `<board>/results/<CARD-ID>/<runId>.md` inside the boards folder (core/layout.ts).
// Its frontmatter is VibeBoard's record of what was dispatched and how it ended; its body is the
// agent's report, verbatim.
//
// `readBoard` only reads folders named by configured columns (store/cards/board.ts), so a `results/` folder
// is invisible to the board with no exclusion logic — which is why the card's run history can live
// next to the card without appearing on it.

// VibeBoard's own view of a run. `queued` and `running` are in-flight; the rest are final.
export const RUN_STATUSES = [
  'queued',
  'running',
  'success',
  'attention',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

// The agent's own verdict, from its report file. Absent when it never wrote one.
export const RUN_OUTCOMES = ['success', 'attention'] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

// WHOSE FAILURE IT WAS — the work's, or the machine's.
//
// `status` says HOW a run ended and cannot say this: a dead credential, a container that cannot be
// exec'd into and an agent that genuinely could not do the job all land in `failed`, and until this
// field existed all three burned the card's attempts identically.
//
// The cost of not distinguishing them, measured 2026-08-15: a box holding a replaced credential
// failed nine runs in 58ms each, auto-pilot spent all three of P-011's attempts on them, and then
// stopped saying the CARD had used its attempts and the user should "move P-011 or change what it
// asks for". The card was never read. The same day, a container pointing at a deleted working
// directory produced "the README may be too thin to derive from" about a README nothing had opened.
//
// ABSENT MEANS THE AGENT'S OWN, which is both the common case and the safe default: a run whose fault
// nothing classified still burns, so a bug in the classifier cannot hand a card unlimited retries.
export const RUN_FAULTS = ['infrastructure'] as const;
export type RunFault = (typeof RUN_FAULTS)[number];

// What a REVIEW run answered about the run it judged. Two values and no third: a report with no `verdict`
// cannot pass anything, so "no answer" is an absence rather than a member here — which is what makes an
// inconclusive review countable (see `inconclusiveReviews` in core/bounds.ts).
//
// Distinct from `RunOutcome`, which is how the review run's OWN turn went: a review that ran perfectly and
// sent the work back is `outcome: success` with `verdict: sent-back`.
export const REVIEW_VERDICTS = ['done', 'sent-back'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

// What the turn cost. Every field is optional and every one may legitimately be zero — a free model
// really does cost nothing — so absence and zero are different facts and are kept apart.
//
// `costUsd` is what the backend reports. For Claude Code that is the API-EQUIVALENT cost: on a Max or
// Pro subscription it is not what you were billed, it is what those tokens would have cost on the
// API. The UI says "usage" rather than "cost" for that reason.
export interface RunUsage {
  costUsd?: number;
  durationMs?: number;
  turns?: number; // model round-trips inside the one agent turn, not runs
  contextTokens?: number; // window occupancy at the end of the turn
  outputTokens?: number;
}

export interface RunRecord {
  run: string; // sortable id, also the filename
  // Absent together for a PROJECT run — the checkup and pre-flight are about the project, not a
  // card, so they have neither. Both or neither, never one: `card` alone cannot say which board's
  // results folder holds it, and `board` alone names a folder with no card in it. A record whose
  // home cannot be computed would be written to the project store while living beside a card, and
  // then counted twice by everything that sums.
  card?: string;
  board?: BoardName;
  skill: string; // skill slug
  status: RunStatus;
  started: string; // ISO timestamp
  backend: string;
  model: string;
  effort: string;
  mode: string;
  outcome?: RunOutcome;
  // Whose failure it was. Absent means the agent's own — see `RunFault`.
  fault?: RunFault;
  // When a person cleared this attempt, so the card can be tried again. ISO, and a TIMESTAMP rather
  // than a boolean because "who let this card go again, and when" is the sort of thing you want to
  // read off the record months later; a `true` answers only half of it.
  //
  // The run itself is never rewritten beyond this field and never deleted. Before it existed the only
  // way to un-block a card was to move its result files out of the folder by hand, which destroys the
  // history that explains why it was blocked in the first place.
  forgiven?: string;
  finished?: string;
  // When the user dealt with it. `status` says how the run ended, which is a fact about the agent
  // and never changes; this says the decision has been taken, which is a fact about the user. A
  // `resolved` status would have overwritten the first with the second and lost it.
  resolved?: string;
  previous?: string; // the run this one continues
  prompt?: string; // the user's additional prompt, verbatim
  attached?: string[]; // paths passed to the agent
  summary?: string; // one line, from the agent
  options?: string[]; // the agent's options — attention only
  created?: string[]; // card ids the run created
  note?: string; // VibeBoard's own explanation when there is no report to speak for the run
  usage?: RunUsage; // what it cost, when the backend said
  // How many suggestions this run filed. A first-class diagnostic, not a footnote: an agent with
  // seventeen findings is telling you its card was scoped wrongly, and the checkup reads this.
  // Counted from the store at settle, never taken from the agent's report — a self-reported number
  // is one the agent can be wrong about.
  //
  // Absent and zero are different facts, as with RunUsage: zero means it filed none, absent means
  // the count could not be taken.
  suggestions?: number;
  // The run's process group, and when its leader started. Persisted so a LATER server can reap what
  // this one left behind: a run still marked in flight at startup had its children die with the server
  // that spawned it — usually. When it did not, this is the only record of what to kill.
  //
  // Both, never one: pids are reused, so a bare pgid read minutes later may belong to something else
  // entirely, and killing a stranger's process group is far worse than the orphan being cleaned up.
  // Absent for OpenCode runs, which are HTTP requests to a managed server rather than processes.
  pgid?: number;
  pgstart?: number;
  // How many files this run changed, measured from git around the dispatch (S11). A diagnostic the
  // checkup reads beside turns, duration and cost: high cost with few turns and no files changed is
  // an agent struggling, and that signature is only computable if the number is here.
  //
  // Absent when there was no answer — no repository, or no git — never 0. A project without git has
  // not changed no files.
  filesChanged?: number;
  // What was decided about this run, and on the strength of what (decision 18). Written after the run
  // settled, by whatever verified it — so it is ABSENT on every record until something has judged it,
  // which is not the same fact as failing.
  verification?: Verification;
  // What a REVIEW run itself answered, on the review run's own record — a deliberate split:
  // the judging run holds what it said, the judged run holds what came of it as `verification`. Absent
  // rather than defaulted when a review reported none, because that absence IS the fact the review bound
  // counts (decision 40: "no answer" is not an answer).
  verdict?: ReviewVerdict;
  report: string; // the body: the agent's report, verbatim
}

// What an agent is asked to write. Everything is optional so a half-written report still tells us
// something — a report with only a body is better than none, and outcome defaults to attention
// because "the agent did not say it succeeded" is not success.
export interface AgentReport {
  outcome: RunOutcome;
  summary?: string;
  options?: string[];
  created?: string[];
  // A REVIEW run's answer. Absent when it wrote none, which is a review that decided nothing rather than
  // one that passed the work — the direction that matters, since the other would invent a pass.
  verdict?: ReviewVerdict;
  body: string;
}
