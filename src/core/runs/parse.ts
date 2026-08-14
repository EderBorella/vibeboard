import matter from 'gray-matter';
// `../parse.js` is the shared coercion module — NOT this file. One directory up, and a different
// subject: that one is `asText`/`oneOf` for any frontmatter, this one is a run file specifically.
import { asText, oneOf } from '../parse.js';
import type { BoardName } from '../types.js';
import { isVerifyMode, type Verification } from '../verify.js';
import {
  type AgentReport,
  REVIEW_VERDICTS,
  RUN_OUTCOMES,
  RUN_STATUSES,
  type RunRecord,
  type RunUsage,
} from './types.js';

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

// Fields of a verdict that are plain sentences. A table rather than five near-identical guards: the
// only thing that differs is the key, and flattening keeps this under the complexity ceiling.
const VERIFICATION_TEXT = ['command', 'reason', 'by'] as const;

// A verdict read back off disk, or nothing. Field by field, because a run file is something a person
// may edit and one bad key must not cost the record — but `mode`, `passed` and `at` are REQUIRED and a
// verdict missing any of them is dropped whole rather than defaulted. Defaulting `passed` either way
// invents a decision nobody made, and the direction that invents a pass is how work advances on
// nothing at all; a verdict with no timestamp is one nobody can place in the sequence.
// Exported for the endpoint that writes a verdict onto a run. Reused rather than re-derived, deliberately:
// a second validator would eventually disagree with this one.
//
// THE `score`/`threshold` AGREEMENT CHECK GOES WITH THE CRITIC. It refused a verdict whose score sat below
// its own bar, which was worth having because `passed` is the field the loop acts on and for a critic the
// numbers WERE the verdict. A review's verdict has no such pair to contradict itself with: `passed` is what
// the review said, and there is nothing beside it to disagree with.
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
  return out;
}

const isStatus = oneOf(RUN_STATUSES);

const isOutcome = oneOf(RUN_OUTCOMES);

// Anything that is not one of the two is DROPPED rather than read as either. `verdict: maybe` is not an
// answer, and the direction that guesses at `done` advances a card on a word nobody defined.
const isVerdict = oneOf(REVIEW_VERDICTS);

// Fields that are simply absent when unset, rather than present and empty. Gathered in loops
// rather than a chain of conditional spreads: same behaviour, and a dozen ternaries in one
// expression is what pushed parseRun past the complexity gate.
const TEXT_OPTIONALS = ['finished', 'resolved', 'previous', 'prompt', 'summary', 'note'] as const;
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
  if (isVerdict(d.verdict)) out.verdict = d.verdict;
  const usage = asUsage(d.usage);
  if (usage !== undefined) out.usage = usage;
  const verification = asVerification(d.verification);
  if (verification !== undefined) out.verification = verification;
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
    // A review's answer, dropped unless it is one of the two. Absent is what an inconclusive review is.
    ...(isVerdict(d.verdict) ? { verdict: d.verdict } : {}),
    body: parsed.content.trim(),
  };
}
