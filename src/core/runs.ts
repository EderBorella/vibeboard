import matter from 'gray-matter';
import type { BoardName } from './types.js';

// A run is a file: `<board>/results/<CARD-ID>/<runId>.md`. Its frontmatter is VibeBoard's record of
// what was dispatched and how it ended; its body is the agent's report, verbatim.
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

export interface RunRecord {
  run: string; // sortable id, also the filename
  card: string;
  board: BoardName;
  skill: string; // skill slug
  status: RunStatus;
  started: string; // ISO timestamp
  backend: string;
  model: string;
  effort: string;
  mode: string;
  outcome?: RunOutcome;
  finished?: string;
  previous?: string; // the run this one continues
  prompt?: string; // the user's additional prompt, verbatim
  attached?: string[]; // paths passed to the agent
  summary?: string; // one line, from the agent
  options?: string[]; // the agent's options — attention only
  created?: string[]; // card ids the run created
  note?: string; // VibeBoard's own explanation when there is no report to speak for the run
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

export function serializeRun(record: RunRecord): string {
  const { report, ...front } = record;
  const data: Record<string, unknown> = {};
  // Written in a deliberate order: identity, then state, then what was asked, then what came back.
  // A run file is something a human reads in a diff.
  for (const key of ['run', 'card', 'board', 'skill', 'status', 'outcome'] as const) {
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
  ] as const) {
    if (front[key] !== undefined) data[key] = front[key];
  }
  return matter.stringify(`${report}\n`, data);
}

// Fields that are simply absent when unset, rather than present and empty. Gathered in loops
// rather than a chain of conditional spreads: same behaviour, and a dozen ternaries in one
// expression is what pushed parseRun past the complexity gate.
const TEXT_OPTIONALS = ['finished', 'previous', 'prompt', 'summary', 'note'] as const;
const LIST_OPTIONALS = ['attached', 'options', 'created'] as const;

function optionalFields(d: Record<string, unknown>): Partial<RunRecord> {
  const out: Partial<RunRecord> = {};
  if (isOutcome(d.outcome)) out.outcome = d.outcome;
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
  if (!run || !card || !skill || !board || !isStatus(d.status)) return null;

  return {
    run,
    card,
    board: board as BoardName,
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

// In-flight statuses cannot survive a restart: the child process is gone with the server that
// spawned it, so a record still claiming to run is stale rather than live.
export function isInFlight(status: RunStatus): boolean {
  return status === 'queued' || status === 'running';
}
