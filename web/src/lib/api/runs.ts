// --- Runs -----------------------------------------------------------------
// Mirrors src/core/runs.ts. Frontmatter is VibeBoard's record of a dispatch; `report` is the
// agent's own words, verbatim.
//
// The ledger lives here too, with the runs it is a sum of: `Spend`, the per-card account and
// `getAccounting` used to sit some hundred and forty lines from the type they answer with.

import type { BoardName, VerifyMode } from '../shared';
import { post, request } from './http';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'attention'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

// What the turn cost. Mirrors RunUsage in src/core/runs.ts. Every field is optional and zero is a
// real value — a free model costs nothing — so absence and zero must not render the same way.
export interface RunUsage {
  costUsd?: number;
  durationMs?: number;
  turns?: number;
  contextTokens?: number;
  outputTokens?: number;
}

export interface RunRecord {
  run: string;
  // Absent together for a run about the PROJECT rather than a card — a checkup or a pre-flight.
  // Both or neither: the server refuses a record carrying one half of the pair.
  card?: string;
  board?: BoardName;
  skill: string;
  status: RunStatus;
  started: string;
  backend: string;
  model: string;
  effort: string;
  mode: string;
  outcome?: 'success' | 'attention';
  // Whose failure it was — the work's, or the machine's. Absent means the agent's own, which is the
  // common case. Mirrored rather than left server-side because it changes what the UI should SAY: a
  // run that never reached a model is not a card the user should go and read.
  fault?: 'infrastructure';
  // When a person cleared this attempt so the card could be tried again.
  forgiven?: string;
  finished?: string;
  // When the user dealt with it. `status` is how the run ended; this is the decision taken about it.
  resolved?: string;
  previous?: string;
  prompt?: string;
  attached?: string[];
  summary?: string;
  options?: string[];
  created?: string[];
  // Card ids a creating run cited as already doing this card's work, verified against the board before
  // the card advanced. Mirrored for the same reason `created` is: it is what the run produced, and a
  // reader asking why a card closed with nothing new on the board needs the answer on screen.
  covered?: string[];
  // VibeBoard's explanation when there is no report to speak for the run.
  note?: string;
  usage?: RunUsage; // what it cost, when the backend said
  suggestions?: number; // how many findings it filed; absent means the count could not be taken
  filesChanged?: number; // measured from git; absent means there was no answer, never zero
  // What a review run answered about the run it judged: `done` or `sent-back`. Absent means it decided
  // nothing, which is a different fact from sending the work back.
  verdict?: 'done' | 'sent-back';
  verification?: Verification;
  report: string;
}

// Mirrors src/core/verify.ts. A verdict and the evidence behind it: the failing command and its output for
// `gates`/`smoke`, or the run that did the judging for `review`.
export interface Verification {
  mode: VerifyMode;
  passed: boolean;
  at: string;
  command?: string;
  output?: string;
  reason?: string;
  by?: string; // the judging run that decided this one
}

// What the UI carries, as data. Compared against the server's own list in test/mirror.test.ts, because a
// hand-mirrored interface has no runtime keys and drift is otherwise silent — this slice added three
// fields on the server and none here, and nothing noticed.
export const RUN_RECORD_KEYS = [
  'run',
  'card',
  'board',
  'skill',
  'status',
  'fault',
  'forgiven',
  'started',
  'backend',
  'model',
  'effort',
  'mode',
  'outcome',
  'finished',
  'resolved',
  'previous',
  'prompt',
  'attached',
  'summary',
  'options',
  'created',
  'covered',
  'note',
  'usage',
  'suggestions',
  'filesChanged',
  'verdict',
  'verification',
  'report',
] as const;

// Fields the server writes that the UI deliberately does NOT carry, with the reason. Kept as a list so
// the guard can be exact: a new server field then forces a decision — mirror it, or say here why not —
// rather than passing unnoticed because the two sides were only ever compared loosely.
export const RUN_RECORD_NOT_MIRRORED = [
  // The run's process group and its leader's start time. Persisted so a later server can reap what this
  // one left behind; nothing on screen shows either, and a pid in the UI would invite acting on it.
  'pgid',
  'pgstart',
] as const;

// A field on the interface above that `RUN_RECORD_KEYS` does not name. `never` when every one is there;
// otherwise this line fails to compile and names the field the guard would have missed.
type UnlistedRunField = Exclude<keyof RunRecord, (typeof RUN_RECORD_KEYS)[number]>;
const _everyRunFieldIsListed: UnlistedRunField extends never ? true : UnlistedRunField = true;
void _everyRunFieldIsListed;

export interface DispatchRequest {
  board: BoardName;
  card: string;
  skill: string;
  prompt?: string;
  attachments?: string[];
  previous?: string;
  backend?: string;
  model?: string;
  effort?: string;
  mode?: string;
}

export interface RunList {
  runs: RunRecord[];
  // Ids the server currently has processes for, and ids waiting for a slot. The records carry the
  // same information, but only the server knows which of them it is actually holding.
  active: string[];
  queued: string[];
}

export async function listRuns(): Promise<RunList> {
  const res = await request('/api/runs', {}, { fallback: 'Failed to load runs' });
  return res.json() as Promise<RunList>;
}

// What a project or a card has spent. Mirrors Spend in src/core/accounting.ts: `costUsd` is ABSENT
// when not one run reported a cost, which is not the same as zero and must not render the same way.
export interface Spend {
  runs: number;
  withCost: number;
  withoutCost: number;
  costUsd?: number;
  outputTokens?: number;
  durationMs?: number;
}

// One card's line in the ledger: what it cost, and how many attempts each skill has used against the
// cap. Per skill because that is how the cap is counted — a judging run must not inflate the tally of
// the skill doing the work.
export interface CardLedgerData {
  spend: Spend;
  attempts: Record<string, number>;
  attemptCap: number;
}

export interface CardRuns {
  runs: RunRecord[];
  account: CardLedgerData;
}

export async function listCardRuns(board: BoardName, card: string): Promise<CardRuns> {
  const url = `/api/runs/${board}/${encodeURIComponent(card)}`;
  const res = await request(url, {}, { fallback: 'Failed to load this card’s runs' });
  return (await res.json()) as CardRuns;
}

export interface Accounting {
  project: Spend;
  cards: { board: BoardName; card: string; spend: Spend; attempts: Record<string, number> }[];
  attemptCap: number;
  // Which cap is actually bounding this project (S10). A dollar dial that can never trip tells the
  // user the opposite of the truth about what will stop the run.
  // Absent for a project with no auto-pilot block — it has no caps, so there is no cap to name.
  cap?: { cap: 'budget' | 'iterations'; why: string };
}

export async function getAccounting(): Promise<Accounting> {
  const res = await request('/api/accounting', {}, { fallback: 'Failed to load this project’s usage' });
  return (await res.json()) as Accounting;
}

export function dispatchRun(body: DispatchRequest): Promise<{ run: RunRecord }> {
  return post<{ run: RunRecord }>('/api/runs', body);
}

export function cancelRun(run: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/api/runs/${encodeURIComponent(run)}/cancel`, {});
}

// Mark a run dealt with, so it stops asking. Idempotent on the server: two clicks are one decision.
export function resolveRun(board: BoardName, card: string, run: string): Promise<{ run: RunRecord }> {
  return post<{ run: RunRecord }>(
    `/api/runs/${board}/${encodeURIComponent(card)}/${encodeURIComponent(run)}/resolve`,
    {},
  );
}

// Clear a card's spent attempts, so auto-pilot will dispatch it again. Answers HOW MANY records were
// stamped, and the caller has to say so: zero means this card had nothing counting against it, and a
// control that reported success there would send someone away from the real problem.
//
// Nothing is deleted — every run stays in the list, stamped with the time it was cleared.
export function forgiveCardAttempts(board: BoardName, card: string): Promise<{ forgiven: number }> {
  return post<{ forgiven: number }>(`/api/runs/${board}/${encodeURIComponent(card)}/forgive`, {});
}

// THE STRONGER ONE, for a card its own SUCCESSES stopped. `forgiveCardAttempts` spares a run that
// succeeded on purpose — clearing a creating run that worked frees the loop to create children again —
// and a card whose every remaining record is a success is therefore one it cannot move at all. This
// clears those too, which is why it is a separate call with a separate confirmation rather than a flag.
//
// Answers the same count, and the caller has to say so for the same reason: zero means this card had
// nothing counting against it, and reporting success there sends someone away from the real problem.
export function resetCardAttempts(board: BoardName, card: string): Promise<{ forgiven: number }> {
  return post<{ forgiven: number }>(`/api/runs/${board}/${encodeURIComponent(card)}/reset`, {});
}

// THE SAME ACTION FOR THE BOOTSTRAP, which has no card to address. Its attempts are counted over the
// project's own runs, so `forgiveCardAttempts` cannot reach them — measured on 2026-08-16, when an
// unreachable OpenCode server spent all three of a project's derivation attempts and the only remedy was
// deleting files out of `project-runs/` by hand.
export function forgiveProjectAttempts(): Promise<{ forgiven: number }> {
  return post<{ forgiven: number }>('/api/runs/project/forgive', {});
}

// The same decision for either kind of run. A project run has no card in its path, so it has its own
// endpoint — and every caller holds the record rather than the three parts, so the choice belongs
// here instead of at each button.
export function resolveRunRecord(record: RunRecord): Promise<{ run: RunRecord }> {
  return record.board && record.card
    ? resolveRun(record.board, record.card, record.run)
    : post<{ run: RunRecord }>(`/api/project-runs/${encodeURIComponent(record.run)}/resolve`, {});
}
