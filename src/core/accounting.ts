import type { AutopilotConfig } from './autopilot.js';
import { isProjectRun, type RunRecord, type RunStatus } from './runs.js';

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

export function burnsAttempt(status: RunStatus): boolean {
  return BURNS[status];
}

// Attempts are DERIVED, never stored: no new frontmatter field, and a card's state stays in its path.
// Filtered to one skill, so a critic or checkup run on the same card does not inflate the tally.
//
// Card id alone identifies the card (ids are board-prefixed). A hand-written duplicate id would merge
// two cards' tallies and reach the cap sooner, which is the harmless direction to be wrong in.
export function attemptsUsed(runs: RunRecord[], card: string, skill: string): number {
  return runs.filter((r) => r.card === card && r.skill === skill && burnsAttempt(r.status)).length;
}

export type CapName = 'budget' | 'iterations';

// Which cap is actually bounding this project — S10. A settings tab showing a dollar dial that can
// never trip is worse than showing no dial: it tells the user the opposite of the truth about what
// will stop the run.
export function governingCap(ap: AutopilotConfig, spend: Spend): { cap: CapName; why: string } {
  if (ap.budgetUsd > 0 && spend.costUsd !== undefined) {
    return {
      cap: 'budget',
      why: `Auto-pilot stops when this project's runs have cost $${ap.budgetUsd}.`,
    };
  }
  const why =
    ap.budgetUsd > 0
      ? `No run has reported a cost yet, so the dollar budget cannot bind. Auto-pilot stops after ${ap.maxIterations} iterations.`
      : `This project has no dollar budget, so auto-pilot stops after ${ap.maxIterations} iterations.`;
  return { cap: 'iterations', why };
}
