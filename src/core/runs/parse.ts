import matter from 'gray-matter';
// `../parse.js` is the shared coercion module — NOT this file. One directory up, and a different
// subject: that one is `asText`/`oneOf` for any frontmatter, this one is a run file specifically.
import { asText, oneOf } from '../parse.js';
import type { BoardName } from '../types.js';
import { isVerifyMode, type Verification } from '../verify.js';
import {
  type AgentReport,
  REVIEW_VERDICTS,
  RUN_FAULTS,
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

// Whose failure it was. Anything else is dropped, which lands on the fail-safe side: an unclassified
// failure still burns the card's attempt, so a hand-edited `fault: whatever` cannot hand a card
// unlimited retries.
const isFault = oneOf(RUN_FAULTS);

// Fields that are simply absent when unset, rather than present and empty. Gathered in loops
// rather than a chain of conditional spreads: same behaviour, and a dozen ternaries in one
// expression is what pushed parseRun past the complexity gate.
// `forgiven` is one of these, and it has to be: it is written by the store and read back by
// `burnsAttempt`, so a record that serialised it and parsed it away would be a card cleared on screen
// and still at its cap on the next read. Nothing caught that — the round-trip fixture named neither
// this field nor `fault` — so both are now in the round trip in test/runs-parse.test.ts.
const TEXT_OPTIONALS = ['finished', 'forgiven', 'resolved', 'previous', 'prompt', 'summary', 'note'] as const;
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

// EVERY FIELD THIS FILE READS, NAMED — and the compiler checks the list is complete.
//
// `serialize.ts` has carried `_everyFieldIsWritten` for a long time: add a field to `RunRecord`, forget
// to write it, and the typecheck fails. Reading had no equivalent, so the guard was one-directional —
// a new field could be added, written, round-tripped past `npm run check`, and then silently dropped on
// the way back in. It would not throw and it would not fail a gate; the value would just be gone, and
// the first symptom would be a dashboard column that is empty for no reason.
//
// The three `*_OPTIONALS` lists below are self-describing; these two are not, because they are read by
// hand — the enum-guarded fields each need their own type predicate, and the required block in
// `parseRun` reads its keys inline. Both are listed here so the union can be closed.
const GUARDED_KEYS = ['outcome', 'fault', 'verdict', 'usage', 'verification'] as const;
const REQUIRED_KEYS = [
  'run',
  'card',
  'board',
  'skill',
  'status',
  'started',
  'backend',
  'model',
  'effort',
  'mode',
  'report',
] as const;

type ParsedKey =
  | (typeof TEXT_OPTIONALS)[number]
  | (typeof LIST_OPTIONALS)[number]
  | (typeof COUNT_OPTIONALS)[number]['key']
  | (typeof GUARDED_KEYS)[number]
  | (typeof REQUIRED_KEYS)[number];

// The same shape as `serialize.ts`'s check, pointed the other way: if a `RunRecord` field is not read
// anywhere above, `Unread` is that field's name rather than `never` and this line stops compiling with
// the missing name in the error.
type Unread = Exclude<keyof RunRecord, ParsedKey>;
const _everyFieldIsRead: Unread extends never ? true : Unread = true;
void _everyFieldIsRead;

function optionalFields(d: Record<string, unknown>): Partial<RunRecord> {
  const out: Partial<RunRecord> = {};
  for (const { key, min } of COUNT_OPTIONALS) {
    const n = d[key];
    if (typeof n === 'number' && Number.isInteger(n) && n >= min) out[key] = n;
  }
  if (isOutcome(d.outcome)) out.outcome = d.outcome;
  if (isFault(d.fault)) out.fault = d.fault;
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

// THE FRONTMATTER BLOCK, READ A LINE AT A TIME, for when YAML has refused it.
//
// One colon-space in an unquoted scalar is enough. A review answered `verdict: done` and wrote
// `summary: formats pairs as "word: count" strings`; YAML read `word` as a nested key, threw, and the
// WHOLE report was discarded — the verdict with it. The loop then saw a review that decided nothing,
// counted three of them, and stopped the project saying "an API key, a disk or a model is the likelier
// cause than the card". Nothing was wrong with the key, the disk, the model or the card: the agent had
// answered correctly and the machine could not hear it.
//
// So this exists because THE ANSWER MATTERS MORE THAN ITS SYNTAX. The keys the machine acts on are a
// closed set of flat scalars, and `key: rest-of-line` needs no YAML at all. Nested structure — a
// report's `options:` list — is not recoverable this way and is not attempted: what this rescues is the
// three fields that decide whether a card moves.
//
// Deliberately NOT a fix in the prompt alone. Telling agents to quote the summary lowers the odds and
// cannot close it, and a rule that depends on every future model getting YAML right is the kind of
// thing that fails silently a month later, on one card, in a run nobody is watching.
const RESCUED = ['outcome', 'verdict', 'summary'] as const;

// One `key: value` line, if the key is one the machine acts on. Shared by all three readers below so
// the quote-stripping and the allow-list exist in one place.
function readPair(line: string, out: Record<string, string>): void {
  const at = line.indexOf(':');
  if (at <= 0) return;
  // Markdown emphasis around the key, because a model writing prose writes `**Verdict:** sent-back`.
  const key = line
    .slice(0, at)
    .trim()
    .replace(/^\*+|\*+$/g, '')
    .toLowerCase();
  if (!(RESCUED as readonly string[]).includes(key)) return;
  // FIRST WINS. A report can mention `verdict` again in its own prose — the line the agent wrote as its
  // answer comes first, and a later mention must not overwrite it.
  if (out[key] !== undefined) return;
  // Surrounding quotes and emphasis stripped, because a value that WAS quoted is the one YAML would
  // have read, and `**sent-back**` is the same answer wearing markdown.
  out[key] = line
    .slice(at + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .replace(/^\*+|\*+$/g, '')
    .replace(/^`(.*)`$/, '$1')
    .trim();
}

// THREE SHAPES, NOT ONE, and the two it could not see are the ones that cost three review runs.
//
// The original reader existed for frontmatter that YAML REFUSED — a colon-space in an unquoted scalar.
// It required `---` on the first line, so it could not see a verdict written any other way, and three
// shapes observed in real runs all failed it: a bare `**Verdict: \`sent-back\`**` in the body, a
// ```yaml fence, and a markdown fence containing frontmatter. Each was read as NO verdict, counted as
// an inconclusive review, and pushed the loop towards "an API key, a disk or a model is the likelier
// cause than the card" — when the agent had answered correctly and the machine could not hear it.
//
// TWO READERS, IN ORDER, AND THE ORDER IS THE PRIORITY: a real frontmatter block is the contract and
// wins; a line anywhere else is the fallback. `readPair` keeps the first value it sees, so the body can
// never overwrite the block.
//
// THIS DOES NOT MAKE THE PROMPT'S CONTRACT OPTIONAL. `contracts.ts` still shows the exact frontmatter
// and says to quote a value containing a colon. A prompt-only fix lowers the odds and cannot close it,
// which is the argument this whole function was written under; a reader-only fix would licence any
// shape at all. Both, and the contract is still what is asked for.
// STEP 1 ON ITS OWN, because two questions need different answers from it. What VALUE a key has is best
// answered by both readers; whether a key was WRITTEN AS FRONTMATTER can only be answered by this one.
// Conflating them stamped a successful run as unreadable because its prose said "Verdict:".
function frontmatterPairs(content: string): Record<string, string> {
  const lines = content.split('\n');
  const out: Record<string, string> = {};
  if (lines[0]?.trim() !== '---') return out;
  const end = lines.indexOf('---', 1);
  if (end !== -1) for (const line of lines.slice(1, end)) readPair(line, out);
  return out;
}

function rescueFrontmatter(content: string): Record<string, string> {
  const lines = content.split('\n');
  // 1. A frontmatter block, whether or not YAML could read it.
  const out: Record<string, string> = frontmatterPairs(content);

  // 2. Any line in the body, INCLUDING inside a fence. A tagged ```yaml block, a bare fence and a
  //    frontmatter block that was fenced by mistake all reduce to "a line somewhere that reads
  //    `verdict: x`", so they need no reader of their own.
  //
  //    THERE WAS A SEPARATE FENCE READER HERE AND IT IS DELETED, because a planted defect proved it
  //    was doing nothing: removing it left all three fenced tests passing. Nothing in the code could
  //    tell the two apart, and code no test can distinguish is code that will rot without anyone
  //    noticing. The frontmatter reader above still runs FIRST, so the contract still wins.
  //    Deliberately the weakest reader: it matches any line at all, so it is the one most likely to
  //    catch a mention rather than an answer — which is why it runs after the block above and, through
  //    `readPair`'s first-wins rule, cannot overwrite it.
  for (const line of lines) readPair(line, out);

  return out;
}

// A VERDICT KEY THE READER COULD NOT USE, which is the one thing about a report that says the loss was
// ours rather than the work's.
//
// Present-and-unusable, never absent: `verdict: maybe`, `verdict: {}`.
// An absent key is a review that decided nothing, which is a real inconclusive review and the whole
// subject of `inconclusiveReviews`. Conflating the two would empty that bound of its meaning in exactly
// the direction that hands a genuinely undecidable card unlimited reviews.
// WHAT IT IS GIVEN MATTERS MORE THAN WHAT IT DOES, and getting that wrong shipped a real defect for the
// length of one review. It was handed the MERGED record — YAML plus `rescueFrontmatter`, whose second
// reader scans every line of the whole document on purpose. So a report whose frontmatter had no verdict
// at all was flagged because its PROSE said `Verdict: the approach was sound.`, which is one of the exact
// shapes the rescue reader exists to catch. A successful run was then stamped `unreadable-report`, burned
// no attempt, and the card did not move — for ever, since the same report would be written again.
//
// So this is only ever asked of the FRONTMATTER: `parsed.data` when YAML read it, and the frontmatter
// block alone when YAML threw. A mention in the body is a mention.
function unusableVerdict(d: Record<string, unknown>): string | undefined {
  // `verdict:` with no value parses to null, and that is a review that decided nothing rather than one we
  // could not read — the same case as an absent key.
  if (!('verdict' in d) || d.verdict === undefined || d.verdict === null) return undefined;
  if (isVerdict(d.verdict)) return undefined;
  const shown = typeof d.verdict === 'string' ? d.verdict : typeof d.verdict;
  return `its verdict reads "${shown.slice(0, 40)}", which is neither done nor sent-back`;
}

// Parse what the agent wrote. A missing or unreadable outcome counts as `attention`: the contract
// says say so explicitly, and silence is not success.
//
// TWO READERS, IN ORDER: YAML first, because a well-formed report is the normal case and its `options:`
// list only exists there; the line reader second, for the fields above when YAML has thrown or when it
// parsed but lost them.
// The rescue-only reading, for a report whose YAML threw. Its own function because it is a different
// reader with a different reach — three fields off single lines, no `options`, no `created`, and no
// identity — and folding both into one body put `parseAgentReport` over the complexity ceiling.
function fromRescueAlone(
  rescued: Record<string, string>,
  block: Record<string, string>,
  body: string,
): AgentReport {
  const unreadable = unusableVerdict(block);
  return {
    outcome: isOutcome(rescued.outcome) ? rescued.outcome : 'attention',
    ...(asText(rescued.summary) ? { summary: asText(rescued.summary) } : {}),
    ...(isVerdict(rescued.verdict) ? { verdict: rescued.verdict } : {}),
    // NO `run` HERE, and it is not an omission. `RESCUED` is three fields that decide whether a card
    // moves, and adding an identity to a reader that matches ANY line would let a report mentioning
    // another run in its prose fail its own identity check. When YAML has thrown, the id is simply not
    // asked for — the check is worth having on the normal path and not worth a false accusation.
    ...(unreadable === undefined ? {} : { unreadable }),
    body,
  };
}

// The body of a report whose frontmatter block must be dropped. With YAML thrown, `matter` gives
// nothing back, so leaving the block in would show the reader the frontmatter as prose — which is what
// the run record on disk did before 2026-08-14.
function bodyAfterBlock(content: string): string {
  const lines = content.split('\n');
  const end = lines[0]?.trim() === '---' ? lines.indexOf('---', 1) : -1;
  return (end === -1 ? content : lines.slice(end + 1).join('\n')).trim();
}

export function parseAgentReport(content: string): AgentReport {
  let parsed: matter.GrayMatterFile<string> | undefined;
  try {
    parsed = matter(content);
  } catch {
    parsed = undefined;
  }
  const rescued = rescueFrontmatter(content);
  // The BLOCK's own pairs as well as the merged ones: the values are read from the merge, as they always
  // were, but "was a verdict written in the frontmatter" can only be answered by the block.
  if (parsed === undefined)
    return fromRescueAlone(rescued, frontmatterPairs(content), bodyAfterBlock(content));
  // YAML WINS WHERE IT SPOKE. It read a quoted scalar correctly and can carry a multi-line one, which the
  // line reader cannot; the rescued values only fill keys YAML did not produce.
  const d = { ...rescued, ...parsed.data } as Record<string, unknown>;
  // `parsed.data`, NOT `d` — see `unusableVerdict`. The merge carries body lines and this question is
  // about the frontmatter.
  const unreadable = unusableVerdict(parsed.data as Record<string, unknown>);
  return {
    outcome: isOutcome(d.outcome) ? d.outcome : 'attention',
    ...(asText(d.summary) ? { summary: asText(d.summary) } : {}),
    ...(asStrings(d.options) ? { options: asStrings(d.options) } : {}),
    ...(asStrings(d.created) ? { created: asStrings(d.created) } : {}),
    // A review's answer, dropped unless it is one of the two. Absent is what an inconclusive review is.
    ...(isVerdict(d.verdict) ? { verdict: d.verdict } : {}),
    ...(asText(d.run) ? { run: asText(d.run) } : {}),
    ...(unreadable === undefined ? {} : { unreadable }),
    body: parsed.content.trim(),
  };
}
