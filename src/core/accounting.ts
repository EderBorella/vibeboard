import type { AutopilotConfig } from './autopilot.js';
import { formatUsd } from './money.js';
import { isHandRun, isProjectRun, type RunRecord, type RunStatus } from './runs.js';
import type { BoardName } from './types.js';

// What a project has spent, and how many attempts a card has used. Both are QUERIES over the run
// records already on disk — no new state, no counter to drift out of step with the files.
//
// Every function here is pure. The caps this feeds are enforced in dispatch-gate.ts, in backend code
// between dispatches: AutoGPT accumulated real cost, stored a real budget, and only injected the
// balance into the prompt as "BUDGET EXCEEDED! SHUT DOWN!"; AgentGPT shipped a UI dial its backend
// schema never received. Neither number was ever compared with anything.

// A total, and the honesty of that total. `costUsd` is ABSENT when not one run reported a cost —
// which is not the same as zero, and must not render the same way. A subscription-backed Claude
// Code run reports an API-equivalent figure rather than what you were billed; a local model reports
// zero; a backend that died before its result event reports nothing at all.
export interface Spend {
  runs: number; // records in this total
  withCost: number; // how many reported a cost
  withoutCost: number; // how many did not
  costUsd?: number;
  outputTokens?: number;
  durationMs?: number;
}

// Money summed as floats accumulates dust: 0.1 + 0.2 is 0.30000000000000004, and a total displayed
// to four decimals would be wrong in the last place for no reason. Six decimals is finer than any
// backend reports and coarse enough to erase the dust.
const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export function sumSpend(runs: RunRecord[]): Spend {
  let costUsd: number | undefined;
  let outputTokens: number | undefined;
  let durationMs: number | undefined;
  let withCost = 0;
  for (const record of runs) {
    const usage = record.usage;
    if (usage?.costUsd !== undefined) {
      costUsd = (costUsd ?? 0) + usage.costUsd;
      withCost += 1;
    }
    if (usage?.outputTokens !== undefined) outputTokens = (outputTokens ?? 0) + usage.outputTokens;
    if (usage?.durationMs !== undefined) durationMs = (durationMs ?? 0) + usage.durationMs;
  }
  return {
    runs: runs.length,
    withCost,
    withoutCost: runs.length - withCost,
    // Each field independently absent: a backend that reports tokens but no cost is a real case, and
    // inventing a zero for the other would be a number nobody measured.
    ...(costUsd === undefined ? {} : { costUsd: round(costUsd) }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

// Board AND card. Ids are board-prefixed so they are unique within a project, but a record carries
// both and the UI groups by board — deriving one from the other would be a second rule to keep.
export function cardKey(board: string, card: string): string {
  return `${board}/${card}`;
}

// The inverse, and it splits on the FIRST separator only. `key.split('/')` at the call site dropped
// everything after a second slash, so a card id containing one was silently attributed to a truncated
// card that does not exist. Ids are slugs today, which is why this was a low finding rather than a bug
// anyone had seen — but the pair belongs together, so a change to one is a change to both.
export function splitCardKey(key: string): { board: string; card: string } {
  const at = key.indexOf('/');
  return at < 0 ? { board: key, card: '' } : { board: key.slice(0, at), card: key.slice(at + 1) };
}

// Per card, project runs excluded. A checkup is about the project; attributing its cost to a card
// would make one card look expensive for work that was not about it.
export function spendByCard(runs: RunRecord[]): Map<string, Spend> {
  const groups = new Map<string, RunRecord[]>();
  for (const record of runs) {
    if (isProjectRun(record)) continue;
    const key = cardKey(record.board as string, record.card as string);
    const list = groups.get(key);
    if (list) list.push(record);
    else groups.set(key, [record]);
  }
  return new Map([...groups].map(([key, list]) => [key, sumSpend(list)]));
}

// An attempt is a run the AGENT is answerable for. The two endings a person or the machine caused
// are not: "you stopped it" and "it never got to finish".
//
// A timeout is recorded as `failed` (agent-runner.ts) and therefore burns — deliberately, and the
// spec calls this mapping load-bearing: recorded as `interrupted` it would stop burning, and a card
// that hangs every single time would retry until the iteration or budget cap took down the whole run.
//
// `success` burns too. The spec's table is silent on it because a successful run advances the card
// and the question does not arise — but a card dragged back into a routed column has genuinely had a
// run of that skill, and counting it is the reading that cannot overshoot the cap.
const BURNS: Record<RunStatus, boolean> = {
  queued: false, // has not ended
  running: false, // has not ended
  success: true,
  attention: true, // it finished and said it could not complete the work
  failed: true, // the agent had its chance — and this is where a timeout lands
  cancelled: false, // you stopped it
  interrupted: false, // stale after a restart
};

// THE RECORD, NOT THE STATUS, and the widening is the point: `failed` is not one fact but three, and
// only one of them is the card's doing. Every caller was made to reconsider rather than given a
// defaulted parameter, because a call site that silently kept the old meaning is exactly how a card
// goes on being blamed for a dead credential.
//
// Order matters below. A forgiven run is not counted whatever else is true of it — that is a person
// overruling the machine, and it must not be second-guessed by a status test.
export function burnsAttempt(
  run: Pick<RunRecord, 'status' | 'fault' | 'forgiven' | 'dispatchedBy'>,
): boolean {
  if (run.forgiven) return false;
  // A person's run spends the project's money, not the loop's attempts (decision 93).
  if (isHandRun(run)) return false;
  // The machine's failure, not the work's. ANY classified fault, not `infrastructure` by name: the field
  // exists to say the failure was not the card's, and every member of `RUN_FAULTS` means exactly that.
  // Testing for one value made the second one — `unreadable-report`, added 2026-09-01 — silently burn on
  // the day it was introduced, which is the bug this line's own comment is about.
  //
  // Note the asymmetry with the table below: an UNCLASSIFIED failure still burns, so the fail-safe
  // direction here is "count it" — a classifier that misses a case costs a card an attempt it did not
  // deserve, where the reverse would let a genuinely failing card retry for ever and never reach a person.
  if (run.fault !== undefined) return false;
  return BURNS[run.status];
}

// Attempts are DERIVED, never stored: no new frontmatter field, and a card's state stays in its path.
// Filtered to one skill, so a review or checkup run on the same card does not inflate the tally.
//
// Card id alone identifies the card (ids are board-prefixed). A hand-written duplicate id would merge
// two cards' tallies and reach the cap sooner, which is the harmless direction to be wrong in.
export function attemptsUsed(runs: RunRecord[], card: string, skill: string): number {
  return runs.filter((r) => r.card === card && r.skill === skill && burnsAttempt(r)).length;
}

// Consecutive infrastructure failures at the END of the run history — the signal that the MACHINE is
// broken rather than any one card.
//
// THIS IS THE OTHER HALF OF NOT BURNING AN ATTEMPT, and without it the fix is worse than the bug. If
// an infrastructure failure costs a card nothing, a project whose credential has died retries the
// same card for ever: every tick dispatches, fails in 58ms, counts nothing, and the loop runs until
// the iteration cap takes it down having done nothing at all and explained none of it.
//
// So the attempt cap stops being what catches this, and this is. It is a property of the PROJECT, not
// of a card — which is exactly the distinction the user is owed: something is wrong with the machine,
// here is the error it gave, and no card is to blame.
//
// TWO, not one: a single transient failure is worth one retry, and both real cases seen so far
// repeated instantly rather than once. Counted from the end and reset by any run that reached a
// model, so a project that recovers is not held against its history.
//
// `since` IS WHAT STOPS THIS DEADLOCKING, and without it this function bricks a project in a new way.
// The streak is read off the END of the history and is broken only by a run that reached a model — so
// after the loop stops, the user fixes the machine and presses Start, the history STILL ends with those
// failures and the very first tick stops again, with the same sentence, for ever. Nothing auto-pilot
// can do breaks its own streak, because it never gets to dispatch anything. Found by the agent that
// built the stop, in its own fixture: its test needed a fourth streak-breaking run to reach the
// behaviour it was about, which is the same fact wearing a disguise.
//
// The caller passes the moment auto-pilot last STARTED (`state.at`, written by the server on the
// transition and not per tick). Pressing Start is the user saying they have dealt with it; this takes
// them at their word for exactly one run, and if the machine is still broken the streak rebuilds
// immediately and stops it again — which costs two 58ms failures rather than a bricked project.
export function consecutiveInfrastructureFailures(runs: RunRecord[], since?: string): RunRecord[] {
  const ordered = [...runs]
    .filter((r) => since === undefined || r.started >= since)
    .sort((a, b) => a.started.localeCompare(b.started));
  const streak: RunRecord[] = [];
  for (let i = ordered.length - 1; i >= 0; i--) {
    const run = ordered[i];
    if (run === undefined) break;
    // In flight, so it says nothing either way yet — skip rather than break, or a queued run would
    // hide a streak that is genuinely there.
    if (run.status === 'queued' || run.status === 'running') continue;
    // A person has already looked at this one and cleared it, so it is no longer evidence of anything.
    // Belt as well as braces: `since` above is what normally clears a streak, and this covers the user
    // who forgives the runs without restarting.
    if (run.forgiven) break;
    if (run.fault !== 'infrastructure') break;
    streak.push(run);
  }
  return streak;
}

export const INFRASTRUCTURE_STREAK = 2;

export type CapName = 'budget' | 'iterations';

// Which cap is actually bounding this project — S10. A settings tab showing a dollar dial that can
// never trip is worse than showing no dial: it tells the user the opposite of the truth about what
// will stop the run.
//
// `iteration` is what makes the answer honest rather than merely possible. Naming the budget whenever
// one exists said "auto-pilot stops when this project's runs have cost $20" to a project one dispatch
// from its iteration cap with a cent spent — true of the dial, false of the run. Whichever cap is
// PROPORTIONALLY nearer is the one that will actually trip, so that is the one named.
//
// The gate this answers for EXISTS: `mayDispatch` in core/dispatch-gate.ts, called from the lifecycle
// machine before every dispatch. So "will actually trip" above is future tense about a future dispatch,
// not about unwritten code — describe what this does in the present indicative.
export function governingCap(
  ap: AutopilotConfig,
  spend: Spend,
  iteration: number,
): { cap: CapName; why: string } {
  const iterations = {
    cap: 'iterations' as const,
    why: `Auto-pilot will stop after ${ap.maxIterations} dispatches; it has used ${iteration}.`,
  };
  // The other half of S10: a subscription-backed or local backend reports nothing, or nothing yet, so a
  // dollar budget cannot bind however large it is.
  if (!(ap.budgetUsd > 0)) {
    return { ...iterations, why: `This project has no dollar budget, so ${lower(iterations.why)}` };
  }
  if (spend.costUsd === undefined) {
    return {
      ...iterations,
      why: `No run has reported a cost, so the dollar budget cannot bind. ${iterations.why}`,
    };
  }
  const budget = {
    cap: 'budget' as const,
    why: `Auto-pilot will stop when this project's runs have cost ${formatUsd(ap.budgetUsd)}; they have cost ${formatUsd(spend.costUsd)}.`,
  };
  // Both can bind, so the nearer one wins. A guard rather than a bare ratio because `maxIterations` is
  // validated in the gate, not here, and dividing by a zero that reached us anyway would answer NaN —
  // which loses to everything and would silently always name the budget.
  const spentShare = spend.costUsd / ap.budgetUsd;
  const usedShare = ap.maxIterations > 0 ? iteration / ap.maxIterations : Number.POSITIVE_INFINITY;
  return usedShare > spentShare ? iterations : budget;
}

const lower = (sentence: string): string => sentence.charAt(0).toLowerCase() + sentence.slice(1);

// What this project and each of its cards have spent, and which cap is actually bounding the run —
// the shape `GET /api/accounting` answers with.
//
// Computed on the server rather than in the browser, so there is ONE statement of the arithmetic: the
// UI renders it, and the auto-pilot service reads the same numbers over the same endpoint to decide
// whether it may dispatch. Two copies of "what has this cost" would eventually disagree, and the one
// that enforces the budget is the one that must be right.
//
// The SHAPE lives here and the assembly stays in the route, which is the way round it has to be. The
// loop is a separate process that reaches the board over HTTP (decision 20), and it needs this type to
// read the answer — so while it was declared in a route module, `src/service/board-client.ts` had to
// import from `src/server/`, the one import edge left pointing the wrong way up the layers. Nothing
// about the type is a server concern: it is Spend plus a cap name, both of which are already here.
export interface CardAccount {
  board: BoardName;
  card: string;
  spend: Spend;
  // Attempts that BURNED, per skill. Per skill because that is how the cap is counted — a review or
  // checkup run on the same card must not inflate the tally of the skill doing the work.
  attempts: Record<string, number>;
}

export interface Accounting {
  project: Spend; // every run, card and project runs alike: everything a model did counts
  cards: CardAccount[];
  attemptCap: number;
  // Absent for a project with no auto-pilot block: there is no cap, so there is no cap to name. The UI
  // renders nothing rather than a number nobody set.
  cap?: { cap: CapName; why: string };
}
