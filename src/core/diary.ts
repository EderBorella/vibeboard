import { type BoardName, isBoard, oneOf } from './types.js';

// The diary: `.vibeboard/PROJECT-LOG.md`, append-only, one line per event.
//
// The high-level narrative, deliberately not a transcript — detailed reports stay in `results/` beside
// their card. It is load-bearing rather than decorative: it is the checkup's primary input, and what
// makes a circle legible as a SEQUENCE rather than a set of individually reasonable runs.
//
// Two readers, different needs. A person reads prose; slice C reads structure. One markdown list item
// per event serves both, and this module is the whole statement of the format — pure, so it can be
// tested without a filesystem, and so the store has nothing to decide.

// Four classes of event. `run` carries what the run was; `checkup` is the mandatory accountability
// entry; `lifecycle` is pre-flight, approval and every stop with its reason.
//
// `note` was added on 2026-08-05, when slice C was planned. The spec named three, and a hand-typed entry
// was being written as `lifecycle` — the class the loop reads to learn why a run stopped. A line somebody
// typed is none of those things, and one class for both put human prose in the machine's input. Extending
// an enumeration a later slice consumes was the owner's call rather than a tidy-up, so it was asked.
export const DIARY_KINDS = ['run', 'checkup', 'lifecycle', 'note'] as const;
export type DiaryKind = (typeof DIARY_KINDS)[number];

export interface DiaryEntry {
  at: string; // ISO, the server's clock
  kind: DiaryKind;
  text: string; // the one-line summary a person reads
  // Present when there is something to say. Absent, never zero-or-empty: a `run` entry with no card is
  // a checkup or a pre-flight, and "iteration 0" is a real iteration the pre-flight writes.
  iteration?: number;
  card?: string;
  board?: BoardName;
  skill?: string;
  outcome?: string;
}

// The file's first line, written once when the diary is created. A heading rather than a bare list so
// the file reads as a document when opened directly — which is how it will usually be read.
export const DIARY_HEADER = '# Project log\n';

// One event is one line, whatever an agent put in its summary — and this is the load-bearing half of
// that. Left unescaped, a summary containing a newline becomes two events, and one beginning with `- `
// forges its own timestamp and kind. Collapsed rather than dropped, because the words are the point.
function oneLine(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// A narrative line, not a document. The text arrives from an agent's summary, so without this the only
// bound is Fastify's 1 MB body limit — and `GET /api/log` re-parses the whole growing file on every read.
//
// TRUNCATED rather than refused: an entry is one event in a sequence, and losing the event to save its
// last 1,900 characters is the wrong way round. Same reasoning as `oneLine` collapsing a newline instead
// of dropping the summary that contained it.
//
// Applied by the CALLER that builds the entry, not by `serializeEntry`: applied there, the endpoint's
// reply and its broadcast would carry the full text while the file held the short line, and the two
// would disagree about what happened.
export const MAX_ENTRY_TEXT = 2000;

export function boundText(text: string): string {
  const line = oneLine(text);
  return line.length <= MAX_ENTRY_TEXT ? line : `${line.slice(0, MAX_ENTRY_TEXT - 1).trimEnd()}…`;
}

// A field value, escaped so it cannot be read as structure. Backslash first, or the escapes we add below
// would themselves be escaped on the next pass. Real escaping rather than stripping, because the value has
// to come back whole: a diary that quietly rewrote what it was told is worse than one that looks odd.
function safeValue(value: string): string {
  return oneLine(value).replace(/\\/g, '\\\\').replace(/·/g, '\\·').replace(/—/g, '\\—');
}

// Escaping puts the backslash BEFORE the separator character, so an escaped value can never contain the
// separator SEQUENCE — ` \· ` is not ` · `. That is what lets the parser below split plainly: two helpers
// that skipped escaped separators were written first and then deleted, because no test could tell them from
// this, and machinery nothing constrains is machinery nobody can trust.
const unescaped = (value: string): string => value.replace(/\\(.)/g, '$1');

// Every field carries its own label, and that is a correctness requirement rather than a style choice.
// Guessing from position read the first unlabelled part as a card, so a checkup entry naming only its
// skill came back as a card called "checkup" — an id the board has never heard of, handed to the reader
// that decides whether the project is circling. A label costs six characters and removes the class.
const FIELDS = [
  ['iteration', (e: DiaryEntry) => (e.iteration === undefined ? undefined : `${e.iteration}`)],
  ['card', (e: DiaryEntry) => (e.card === undefined ? undefined : e.board ? `${e.board}/${e.card}` : e.card)],
  ['skill', (e: DiaryEntry) => e.skill],
  ['outcome', (e: DiaryEntry) => e.outcome],
] as const;

// `- \`<at>\` **<kind>** iteration 3 · card engineering/E-001 · skill implement · outcome success — <text>`
//
// The timestamp is in backticks and the kind in bold because both are read at a glance down the left of
// the file; the em dash separates the structure from the prose. There is no ` · ` between the kind and the
// first field — an earlier version of this comment said there was, and a test was written against the
// comment rather than the bytes. The bytes are asserted exactly in test/diary.test.ts now.
//
// Field VALUES are escaped, not just `text`. Escaping only the summary left the other door open: an
// `outcome` of `success · card E-999 · iteration 42` round-tripped into three fields, two of which the
// caller never sent and one a card id the board has never heard of — the same fabrication the labels were
// introduced to prevent, arriving through a different field.
export function serializeEntry(entry: DiaryEntry): string {
  const parts: string[] = [];
  for (const [label, render] of FIELDS) {
    const value = render(entry);
    if (value !== undefined && value !== '') parts.push(`${label} ${safeValue(String(value))}`);
  }
  const middle = parts.length > 0 ? ` ${parts.join(' · ')}` : '';
  const text = oneLine(entry.text);
  // `at` and `kind` go through the collapse too. Only `text` did, and `entryBlock` is exported: an `at`
  // containing a newline forges an event AND destroys the real one by splitting the line in half. Not
  // reachable through either caller today — both pass a server clock — which is why this is a guard
  // rather than a fix, and why the trigger recorded for it was the first caller that is not that clock.
  return `- \`${oneLine(entry.at)}\` **${oneLine(entry.kind)}**${middle}${text === '' ? '' : ` — ${text}`}`;
}

// How an entry is committed to the file. One home for it, because two writers create lines here — the
// store appending, and scaffold creating the file with its first — and a heading written by one and not
// the other, or a newline forgotten by either, is a corrupt diary.
export function entryBlock(entry: DiaryEntry, withHeader: boolean): string {
  return `${withHeader ? DIARY_HEADER : ''}${serializeEntry(entry)}\n`;
}

// Anchored at the start of the line and on an ISO-shaped timestamp: the file is ordinary markdown that a
// person may add prose to, and a note that happens to start with a dash must not become an event.
const LINE = /^- `(\d{4}-\d{2}-\d{2}T[\d:.]+Z)` \*\*([a-z]+)\*\*(.*)$/;
// `<label> <value>`, where the label is one of the four FIELDS names. Anything else is prose somebody
// wrote in the structure position and is ignored rather than guessed at.
const FIELD = /^(iteration|card|skill|outcome) (.+)$/;

const isKind = oneOf(DIARY_KINDS);

// `null` for anything this module did not write. The checkup reasons about what comes back, so a
// hand-typed line becoming an event would be a fact nobody stated.
// A TIMESTAMP THIS MODULE COULD HAVE WRITTEN, not merely one shaped like one.
//
// `LINE` is a SHAPE: `\d{4}-\d{2}-\d{2}` accepts `9999-99-99`, and `[\d:.]+` accepts `:::` with no
// digits in it at all. Nothing downstream re-validated — `parseEntry` copied `at` through verbatim —
// so a hand-edited file could put an impossible date into the checkup's reasoning.
//
// `Date.parse` and not a tighter regex: a regex that accepts only real dates has to know about month
// lengths and leap years, which is a calendar reimplemented in a character class. The round trip is
// the honest test — parse it, write it back, and require the same string. That also rejects a date
// that is real but not CANONICAL (`2026-8-01`, a non-Z offset), which is the actual claim: this
// module wrote it, or it did not.
function isWrittenHere(at: string): boolean {
  const ms = Date.parse(at);
  return Number.isFinite(ms) && new Date(ms).toISOString() === at;
}

export function parseEntry(line: string): DiaryEntry | null {
  const match = LINE.exec(line);
  if (!match) return null;
  const [, at, kind, rest = ''] = match;
  if (at === undefined || kind === undefined || !isKind(kind)) return null;
  // THE WHOLE ENTRY, not the field. The module's convention is `null` for anything it did not write,
  // and an entry whose timestamp is impossible is not an entry with one bad field — there is no
  // position on a timeline to put it at.
  if (!isWrittenHere(at)) return null;

  // The prose is whatever follows the FIRST em dash separator; everything before it is structure. Split
  // on the separator rather than the character, so an em dash inside a summary stays in the summary.
  const cut = rest.indexOf(' — ');
  const structure = cut < 0 ? rest : rest.slice(0, cut);
  const text = cut < 0 ? '' : rest.slice(cut + 3);

  const entry: DiaryEntry = { at, kind, text };
  for (const part of structure.split(' · ')) {
    const field = FIELD.exec(part.trim());
    if (field?.[1] !== undefined && field[2] !== undefined) applyField(entry, field[1], unescaped(field[2]));
  }
  return entry;
}

// Extracted from parseEntry rather than inlined: the same decisions nested inside the loop pushed the
// function past the complexity ceiling, and flattening beats shortening — the metric is measuring depth,
// and so is the reader.
function applyField(entry: DiaryEntry, label: string, value: string): void {
  if (label === 'iteration') {
    // DECIMAL DIGITS ONLY. `Number('0x10')` is 16 and `Number('1e3')` is 1000 — both integers, both
    // accepted by the old check, and neither is anything this module would have written. An iteration
    // read as 16 when the file says `0x10` is a number nobody typed.
    if (!/^\d+$/.test(value)) return;
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0) entry.iteration = n;
    return;
  }
  if (label === 'outcome') {
    entry.outcome = value;
    return;
  }
  if (label === 'skill') {
    entry.skill = value;
    return;
  }
  // `<board>/<card>`, and only when the first segment really is a board — a card id containing a slash
  // is not a board name, and must not be split into one.
  const slash = value.indexOf('/');
  const board = slash < 0 ? '' : value.slice(0, slash);
  if (isBoard(board)) {
    entry.board = board;
    entry.card = value.slice(slash + 1);
    return;
  }
  entry.card = value;
}

export function parseDiary(content: string): DiaryEntry[] {
  const entries: DiaryEntry[] = [];
  for (const line of content.split('\n')) {
    const entry = parseEntry(line);
    if (entry) entries.push(entry);
  }
  return entries;
}
