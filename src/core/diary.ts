import { BOARDS, type BoardName } from './types.js';

// The diary: `.vibeboard/PROJECT-LOG.md`, append-only, one line per event.
//
// The high-level narrative, deliberately not a transcript — detailed reports stay in `results/` beside
// their card. It is load-bearing rather than decorative: it is the checkup's primary input, and what
// makes a circle legible as a SEQUENCE rather than a set of individually reasonable runs.
//
// Two readers, different needs. A person reads prose; slice C reads structure. One markdown list item
// per event serves both, and this module is the whole statement of the format — pure, so it can be
// tested without a filesystem, and so the store has nothing to decide.

// The three classes of event the spec names. `run` carries what the run was; `checkup` is the mandatory
// accountability entry; `lifecycle` is pre-flight, approval and every stop with its reason.
export const DIARY_KINDS = ['run', 'checkup', 'lifecycle'] as const;
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
  return `- \`${entry.at}\` **${entry.kind}**${middle}${text === '' ? '' : ` — ${text}`}`;
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

function isKind(value: string): value is DiaryKind {
  return (DIARY_KINDS as readonly string[]).includes(value);
}

function isBoard(value: string): value is BoardName {
  return (BOARDS as readonly string[]).includes(value);
}

// `null` for anything this module did not write. The checkup reasons about what comes back, so a
// hand-typed line becoming an event would be a fact nobody stated.
export function parseEntry(line: string): DiaryEntry | null {
  const match = LINE.exec(line);
  if (!match) return null;
  const [, at, kind, rest = ''] = match;
  if (at === undefined || kind === undefined || !isKind(kind)) return null;

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
