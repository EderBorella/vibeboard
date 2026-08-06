import matter from 'gray-matter';
import type { BoardName } from './types.js';
import { isVerifyMode, type Verification } from './verify.js';

// A run is a file: `<board>/results/<CARD-ID>/<runId>.md` inside the boards folder (core/layout.ts).
// Its frontmatter is VibeBoard's record of what was dispatched and how it ended; its body is the
// agent's report, verbatim.
//
// `readBoard` only reads folders named by configured columns (core/board.ts), so a `results/` folder
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
  // What a CRITIC run itself answered: its score, and any over-delivery it noticed. Distinct from
  // `verification` above, which is what was decided about the run being judged — the critic's own
  // record holds what it said, the judged run holds what came of it.
  //
  // Absent on every other kind of run, and absent rather than 0 when a critic did not answer: zero is
  // a critic that judged the work worthless, which is a verdict rather than a gap.
  score?: number;
  overshoot?: string;
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
  // A JUDGING run only — the critic. Its score, and any over-delivery it noticed in the work it was
  // judging. Absent from every other report, and absent rather than 0 when the critic did not answer.
  score?: number;
  overshoot?: string;
  body: string;
}

function asStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map((v) => String(v).trim()).filter((v) => v !== '');
  return list.length > 0 ? list : undefined;
}

const USAGE_KEYS = ['costUsd', 'durationMs', 'turns', 'contextTokens', 'outputTokens'] as const;

// A hand-edited or half-written file can put anything here. Zero is kept — a free model costs
// nothing and that is worth recording — but NaN, Infinity, negatives and non-numbers are not facts
// about a run, so they are dropped rather than rendered.
function asUsage(value: unknown): RunUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const usage: RunUsage = {};
  for (const key of USAGE_KEYS) {
    const n = source[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) usage[key] = n;
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

// A score is a fraction of one, and zero is a real answer — a critic that judged the work worthless.
// Anything outside that range is not a judgement at all: a 4 would clear every threshold, which is the
// direction that turns a broken critic into a pass.
function asFraction(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

// Fields of a verdict that are plain sentences. A table rather than five near-identical guards: the
// only thing that differs is the key, and flattening keeps this under the complexity ceiling.
const VERIFICATION_TEXT = ['command', 'reason', 'by', 'overshoot'] as const;

// A verdict read back off disk, or nothing. Field by field, because a run file is something a person
// may edit and one bad key must not cost the record — but `mode`, `passed` and `at` are REQUIRED and a
// verdict missing any of them is dropped whole rather than defaulted. Defaulting `passed` either way
// invents a decision nobody made, and the direction that invents a pass is how work advances on
// nothing at all; a verdict with no timestamp is one nobody can place in the sequence.
// Exported for the endpoint that writes a verdict onto a run. Reused rather than re-derived, deliberately:
// it is the check that refuses a critic score which does not agree with the threshold it claims to have been
// judged against, and a second validator would eventually disagree with this one.
export function asVerification(value: unknown): Verification | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const d = value as Record<string, unknown>;
  const at = asText(d.at);
  if (!isVerifyMode(d.mode) || typeof d.passed !== 'boolean' || at === undefined) return undefined;
  const out: Verification = { mode: d.mode, passed: d.passed, at };
  for (const key of VERIFICATION_TEXT) {
    const text = asText(d[key]);
    if (text !== undefined) out[key] = text;
  }
  // `output` is captured bytes, not a sentence, so it is kept EXACTLY — `asText` trims, which means a
  // gate's output did not round-trip, and an output that was empty disappeared from a failing verdict
  // entirely. "The command printed nothing" is evidence about a failure, and losing it leaves a reader
  // wondering whether it printed nothing or nobody looked.
  if (typeof d.output === 'string') out.output = d.output;
  const numbers = criticNumbers(d, out.passed);
  if (numbers === DAMAGED) return undefined;
  return { ...out, ...numbers };
}

const DAMAGED = Symbol('a verdict contradicting its own evidence');

// A critic verdict's two numbers, or `DAMAGED`.
//
// For a critic these ARE the verdict rather than decoration around it, so a present-but-invalid one
// damages the whole thing: a score of 4 clears every bar there is, and a threshold of 99 is one the
// config validator could never have produced. A malformed `command` or `output` is different and is
// dropped field by field — those are evidence a verdict can lack and still mean something.
//
// And the two are checked against the VERDICT. Every field used to be validated on its own with nothing
// comparing them, so a file could carry a pass whose score sat below its own bar — and `passed` is the
// field the loop acts on. Dropped rather than recomputed: recomputing would quietly overwrite what the
// file says, and inventing a decision is the failure this whole guard exists to prevent.
//
// Extracted from `asVerification` rather than inlined: the same checks nested there put it past the
// complexity ceiling, and the metric is measuring depth — as is the reader.
function criticNumbers(
  d: Record<string, unknown>,
  passed: boolean,
): { score?: number; threshold?: number } | typeof DAMAGED {
  const score = asFraction(d.score);
  const threshold = asFraction(d.threshold);
  if (d.score !== undefined && score === undefined) return DAMAGED;
  if (d.threshold !== undefined && threshold === undefined) return DAMAGED;
  if (score !== undefined && threshold !== undefined && passed !== score >= threshold) return DAMAGED;
  return {
    ...(score === undefined ? {} : { score }),
    ...(threshold === undefined ? {} : { threshold }),
  };
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text === '' ? undefined : text;
}

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (RUN_STATUSES as readonly string[]).includes(value);
}

function isOutcome(value: unknown): value is RunOutcome {
  return typeof value === 'string' && (RUN_OUTCOMES as readonly string[]).includes(value);
}

// A run id that sorts chronologically as a string: the store lists a card's runs by filename, so
// ordering must not depend on reading every file. `at` is the caller's clock — nothing here reads
// the time, so a test can pin it.
export function runId(at: Date, suffix: string): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${suffix}`;
}

// What may be interpolated into a path as a run id. It exists because the id arrives from a URL
// segment: Fastify decodes `%2F` AFTER matching the route, so `..%2F..%2Fsecret` reached the store as
// `../../secret` and read a file outside it.
//
// A character class rather than the timestamp shape `runId` produces, and the distinction is the whole
// point: what closes the traversal is the absence of `.`, `/` and `\`, not the presence of a
// timestamp. Demanding the exact shape would additionally reject any id written by an older version —
// and would have meant rewriting a hundred fixtures whose readable names are why the suites are
// legible, buying nothing for the boundary.
const RUN_ID = /^[A-Za-z0-9_-]+$/;

export function isRunId(run: string): boolean {
  return RUN_ID.test(run);
}

// About the project, not a card. One predicate rather than two `undefined` checks at every call
// site: the store dispatches on it, the accounting excludes these from per-card totals, and the
// dashboard labels them.
export function isProjectRun(record: RunRecord): boolean {
  return record.card === undefined && record.board === undefined;
}

// The order a run file is written in: identity, then state, then what was asked, then what came back.
// A run file is something a human reads in a diff.
//
// Named rather than inline because these lists ARE the set of fields that persist: a field on the
// interface and absent from here is one `serializeRun` silently never writes, so it would round-trip as
// gone. The exhaustiveness check below turns that into a typecheck failure, and `RUN_RECORD_KEYS` lets
// test/mirror.test.ts hold the web mirror to the same set.
const IDENTITY_KEYS = ['run', 'card', 'board', 'skill', 'status', 'outcome', 'resolved'] as const;
const DETAIL_KEYS = [
  'started',
  'finished',
  'previous',
  'backend',
  'model',
  'effort',
  'mode',
  'prompt',
  'attached',
  'summary',
  'options',
  'created',
  'note',
  'usage',
  'suggestions',
  'pgid',
  'pgstart',
  'filesChanged',
  // Last, and in this order: what the run answered, then what was decided about it. A run file is
  // read in a diff, and the verdict is the thing you look for at the bottom.
  'score',
  'overshoot',
  'verification',
] as const;

export const RUN_RECORD_KEYS = [...IDENTITY_KEYS, ...DETAIL_KEYS, 'report'] as const;

// A field on `RunRecord` that no list above names. `never` when every one is covered; otherwise this
// line fails to compile and names the field that would not persist.
type Unwritten = Exclude<keyof RunRecord, (typeof RUN_RECORD_KEYS)[number]>;
const _everyFieldIsWritten: Unwritten extends never ? true : Unwritten = true;
void _everyFieldIsWritten;

export function serializeRun(record: RunRecord): string {
  const { report, ...front } = record;
  const data: Record<string, unknown> = {};
  for (const key of IDENTITY_KEYS) {
    if (front[key] !== undefined) data[key] = front[key];
  }
  for (const key of DETAIL_KEYS) {
    if (front[key] !== undefined) data[key] = front[key];
  }
  return matter.stringify(`${report}\n`, data);
}

// Written whenever the count SUCCEEDED, zero included; absent only when it could not be taken.
//
// The earlier version omitted zero to keep records tidy, which collapsed three facts into one:
// "filed none", "filed none as far as we know" and "the store was unreadable" all looked
// identical. The checkup reads this to decide whether a card was scoped wrongly, and "no findings"
// is a very different input from "we did not look".
export function withSuggestions(record: RunRecord, count: number | undefined): RunRecord {
  return count === undefined ? record : { ...record, suggestions: count };
}

// Same shape and same reason as withSuggestions: zero is a real answer — a run that changed nothing —
// and absence means there was no repository to ask. A `filesChanged: 0` invented for a project without
// git would read as a run that did nothing, which is the opposite of what it would mean.
export function withFilesChanged(record: RunRecord, count: number | undefined): RunRecord {
  return count === undefined ? record : { ...record, filesChanged: count };
}

// Fields that are simply absent when unset, rather than present and empty. Gathered in loops
// rather than a chain of conditional spreads: same behaviour, and a dozen ternaries in one
// expression is what pushed parseRun past the complexity gate.
const TEXT_OPTIONALS = [
  'finished',
  'resolved',
  'previous',
  'prompt',
  'summary',
  'note',
  'overshoot',
] as const;
const LIST_OPTIONALS = ['attached', 'options', 'created'] as const;

// Whole-number fields, each with the smallest value it may legitimately hold. One table rather than a
// guard apiece: the floors are the only thing that differs, and three near-identical blocks pushed
// parseRun past the complexity gate.
//
// The two counts may be genuinely zero — a run that filed no suggestions, a run that changed no files.
// A pgid may not: 0 is our own process group and 1 is init, and signalling either would be
// catastrophic, so the floor is 2 here as well as at the kill — a hand-edited record must not be able
// to aim the reaper. A start time of 0 is not one either.
const COUNT_OPTIONALS = [
  { key: 'suggestions', min: 0 },
  { key: 'filesChanged', min: 0 },
  { key: 'pgid', min: 2 },
  { key: 'pgstart', min: 1 },
] as const;

function optionalFields(d: Record<string, unknown>): Partial<RunRecord> {
  const out: Partial<RunRecord> = {};
  for (const { key, min } of COUNT_OPTIONALS) {
    const n = d[key];
    if (typeof n === 'number' && Number.isInteger(n) && n >= min) out[key] = n;
  }
  if (isOutcome(d.outcome)) out.outcome = d.outcome;
  const usage = asUsage(d.usage);
  if (usage !== undefined) out.usage = usage;
  const verification = asVerification(d.verification);
  if (verification !== undefined) out.verification = verification;
  const score = asFraction(d.score);
  if (score !== undefined) out.score = score;
  for (const key of TEXT_OPTIONALS) {
    const value = asText(d[key]);
    if (value !== undefined) out[key] = value;
  }
  for (const key of LIST_OPTIONALS) {
    const value = asStrings(d[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// Parse a run file. Returns null for anything that is not one: a results folder is ordinary disk,
// and a stray markdown file there must not become a phantom run in the dashboard.
export function parseRun(content: string): RunRecord | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return null; // malformed YAML
  }
  const d = parsed.data as Record<string, unknown>;
  const run = asText(d.run);
  const card = asText(d.card);
  const skill = asText(d.skill);
  const board = asText(d.board);
  if (!run || !skill || !isStatus(d.status)) return null;
  // Both or neither — see RunRecord. One without the other is not a run we could ever write back.
  if (!card !== !board) return null;

  return {
    run,
    ...(card && board ? { card, board: board as BoardName } : {}),
    skill,
    status: d.status,
    started: asText(d.started) ?? '',
    backend: asText(d.backend) ?? '',
    model: asText(d.model) ?? '',
    effort: asText(d.effort) ?? '',
    mode: asText(d.mode) ?? '',
    ...optionalFields(d),
    report: parsed.content.trim(),
  };
}

// Parse what the agent wrote. A missing or unreadable outcome counts as `attention`: the contract
// says say so explicitly, and silence is not success.
export function parseAgentReport(content: string): AgentReport {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return { outcome: 'attention', body: content.trim() };
  }
  const d = parsed.data as Record<string, unknown>;
  const score = asFraction(d.score);
  return {
    outcome: isOutcome(d.outcome) ? d.outcome : 'attention',
    ...(asText(d.summary) ? { summary: asText(d.summary) } : {}),
    ...(asStrings(d.options) ? { options: asStrings(d.options) } : {}),
    ...(asStrings(d.created) ? { created: asStrings(d.created) } : {}),
    // A judging run's two extra fields. Absent everywhere else, and a score outside 0..1 is dropped
    // rather than clamped: a 4 is not a judgement, and clamping it to 1 would invent a pass.
    ...(score === undefined ? {} : { score }),
    ...(asText(d.overshoot) ? { overshoot: asText(d.overshoot) } : {}),
    body: parsed.content.trim(),
  };
}

// Fold the agent's report into the record VibeBoard owns. The agent decides `outcome`, `summary`,
// `options`, `created` and the body; VibeBoard decides `status` and the timings, so an agent that
// rewrites its file wholesale can never lose them.
export function withReport(record: RunRecord, report: AgentReport, finished: string): RunRecord {
  return {
    ...record,
    status: report.outcome,
    outcome: report.outcome,
    finished,
    ...(report.summary ? { summary: report.summary } : {}),
    ...(report.options ? { options: report.options } : {}),
    ...(report.created ? { created: report.created } : {}),
    // A critic's own answer, kept on the critic's own record. What came OF it is written to the run
    // being judged, as `verification` — one fact, one home, on each side.
    ...(report.score === undefined ? {} : { score: report.score }),
    ...(report.overshoot ? { overshoot: report.overshoot } : {}),
    report: report.body,
  };
}

// End a run that produced no usable report. `status` is the caller's (failed, cancelled,
// interrupted, or attention for "finished and said nothing"), and the note is what the UI shows in
// place of a report — never a blank pane.
export function withoutReport(
  record: RunRecord,
  status: RunStatus,
  note: string,
  finished: string,
  transcriptTail = '',
): RunRecord {
  return { ...record, status, finished, note, report: transcriptTail.trim() };
}

// What the turn cost, attached before either ending is decided — a run that failed or was cancelled
// still spent tokens, and that is exactly when knowing so matters. Absent usage leaves the record
// untouched rather than writing an empty `usage: {}`.
export function withUsage(record: RunRecord, usage: RunUsage | undefined): RunRecord {
  return usage === undefined ? record : { ...record, usage };
}

// The verdict, attached after the run settled and after whatever verified it has answered. Its own
// function rather than a spread at the call site, so there is ONE statement of what "this run was
// judged" writes — and so a loop cannot half-write it.
export function withVerification(record: RunRecord, verification: Verification): RunRecord {
  return { ...record, verification };
}

// In-flight statuses cannot survive a restart: the child process is gone with the server that
// spawned it, so a record still claiming to run is stale rather than live.
export function isInFlight(status: RunStatus): boolean {
  return status === 'queued' || status === 'running';
}

// Statuses that leave something for a person to decide. `success` and `cancelled` do not: one is
// finished work, the other is a decision already taken. In-flight runs are not resolvable either —
// they have not ended, and stopping one is `cancel`, not a resolution.
export const RESOLVABLE_STATUSES: readonly RunStatus[] = ['attention', 'failed', 'interrupted'];

// Still asking for a decision. The single source for that question: the server filters on it when a
// card closes, and the dashboard's grouping is asserted against it in test/mirror.test.ts.
export function needsResolution(record: RunRecord): boolean {
  return record.resolved === undefined && RESOLVABLE_STATUSES.includes(record.status);
}

export function withResolution(record: RunRecord, at: string): RunRecord {
  return { ...record, resolved: at };
}

// A run that left NOTHING behind — no report, no files, no cards. Asked before a card's work is verified,
// because verifying nothing is the shape that advances a card over work that never happened: a `gates` route
// whose run died runs its commands over an unchanged tree, which was green before and is green now, and the
// card advances having implemented nothing. Found by the first hand-run through the critic; the same hole is
// wider under `gates`, where no model is involved to notice.
//
// FAIL CLOSED, and the direction matters: every clause must hold, so the answer is "nothing" only when there
// is nothing on any of the three counts. Being wrong the other way costs a wasted verification, which is
// ordinary; being wrong this way is a card advanced over an empty run.
//
// Each clause earns its place:
// - `failed` only. `attention` is a run that finished and SAID it could not do the work — it has a report and
//   a verdict is exactly what should judge it. A run whose report claimed success and which was then killed by
//   the clock is `failed` WITH an `outcome`, and the clause below keeps it verifiable.
// - `outcome === undefined` is "the agent never delivered a report", and it is the whole of that question.
//   `withReport` is the only producer of `outcome`, so its absence means no report was ever folded in.
// - `filesChanged === 0` and never `!filesChanged`: absent means the measurement could not be taken, which is
//   not evidence that nothing changed. And files alone are never enough — `derive-features` writes cards
//   through the API and legitimately changes no files, so a files-only test would call a real derivation empty.
//
// NOT `record.report`, and this is the correction a review had to make (2026-08-06): `withoutReport` puts the
// TRANSCRIPT TAIL in that field precisely when there is no agent report, so `!record.report?.trim()` was false
// for exactly the dead run this predicate exists to catch — `{"kind":"text","text":"[opencode failed: fetch
// failed]"}` is a non-empty `report`. The refusal was dead in production, and the tests did not notice because
// they hand-built `report: ''`, a shape the runner never writes. Compose the real functions in a test, or a
// field's NAME will keep standing in for what actually goes in it.
export function producedNothing(record: RunRecord): boolean {
  return record.status === 'failed' && record.outcome === undefined && record.filesChanged === 0;
}
