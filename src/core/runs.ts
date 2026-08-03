import matter from 'gray-matter';
import type { BoardName } from './types.js';

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

// About the project, not a card. One predicate rather than two `undefined` checks at every call
// site: the store dispatches on it, the accounting excludes these from per-card totals, and the
// dashboard labels them.
export function isProjectRun(record: RunRecord): boolean {
  return record.card === undefined && record.board === undefined;
}

export function serializeRun(record: RunRecord): string {
  const { report, ...front } = record;
  const data: Record<string, unknown> = {};
  // Written in a deliberate order: identity, then state, then what was asked, then what came back.
  // A run file is something a human reads in a diff.
  for (const key of ['run', 'card', 'board', 'skill', 'status', 'outcome', 'resolved'] as const) {
    if (front[key] !== undefined) data[key] = front[key];
  }
  for (const key of [
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
  ] as const) {
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

// Fields that are simply absent when unset, rather than present and empty. Gathered in loops
// rather than a chain of conditional spreads: same behaviour, and a dozen ternaries in one
// expression is what pushed parseRun past the complexity gate.
const TEXT_OPTIONALS = ['finished', 'resolved', 'previous', 'prompt', 'summary', 'note'] as const;
const LIST_OPTIONALS = ['attached', 'options', 'created'] as const;

function optionalFields(d: Record<string, unknown>): Partial<RunRecord> {
  const out: Partial<RunRecord> = {};
  // Same rule as RunUsage: zero is a fact worth keeping, NaN and negatives are not facts at all.
  if (typeof d.suggestions === 'number' && Number.isFinite(d.suggestions) && d.suggestions >= 0) {
    out.suggestions = d.suggestions;
  }
  // A pgid of 0 or 1 is not a run's group — 0 is our own and 1 is init — and either would be
  // catastrophic to signal. Dropped here as well as guarded at the kill, because a hand-edited record
  // must not be able to aim the reaper.
  for (const key of ['pgid', 'pgstart'] as const) {
    const n = d[key];
    if (typeof n === 'number' && Number.isInteger(n) && n > 1) out[key] = n;
  }
  if (isOutcome(d.outcome)) out.outcome = d.outcome;
  const usage = asUsage(d.usage);
  if (usage !== undefined) out.usage = usage;
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
  return {
    outcome: isOutcome(d.outcome) ? d.outcome : 'attention',
    ...(asText(d.summary) ? { summary: asText(d.summary) } : {}),
    ...(asStrings(d.options) ? { options: asStrings(d.options) } : {}),
    ...(asStrings(d.created) ? { created: asStrings(d.created) } : {}),
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
