import { describe, expect, it } from 'vitest';
import {
  boundText,
  DIARY_HEADER,
  DIARY_KINDS,
  type DiaryEntry,
  entryBlock,
  MAX_ENTRY_TEXT,
  parseDiary,
  parseEntry,
  serializeEntry,
} from '../src/core/diary.js';

// The diary is the checkup's primary input and the thing that makes a circle legible as a SEQUENCE
// rather than a set of individually reasonable runs. So the format has two readers with different
// needs: a person reading prose, and slice C reading structure. One line per event serves both, and
// the load-bearing property is that neither reader can be misled by what the other wrote — a summary
// containing a newline must not become two events, and a note somebody typed must not become one.

const AT = '2026-08-05T10:04:00.000Z';
const entry = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  at: AT,
  kind: 'lifecycle',
  text: 'Project created.',
  ...over,
});

describe('a diary line', () => {
  it('round-trips a bare entry', () => {
    const e = entry();
    expect(parseEntry(serializeEntry(e))).toEqual(e);
  });

  it('round-trips a run entry with every field the spec names', () => {
    const e = entry({
      kind: 'run',
      iteration: 3,
      card: 'E-001',
      board: 'engineering',
      skill: 'implement',
      outcome: 'success',
      text: 'Added the token store.',
    });
    expect(parseEntry(serializeEntry(e))).toEqual(e);
  });

  it('round-trips a checkup entry, which carries no card', () => {
    const e = entry({ kind: 'checkup', iteration: 10, text: 'Archived two stale cards.' });
    expect(parseEntry(serializeEntry(e))).toEqual(e);
  });

  // One event is one line, whatever an agent puts in its summary. A diary whose entry COUNT depends on
  // the text is not append-only in any useful sense: the checkup would read one run as several, and a
  // summary beginning with `- ` would forge a timestamp and a kind of its own choosing.
  it('is one line, so one event cannot become two', () => {
    const e = entry({ text: 'Two\nlines\r\nand\ttabs' });
    const line = serializeEntry(e);
    expect(line).not.toContain('\n');
    expect(line).not.toContain('\r');
    expect(line).not.toContain('\t');
    // Collapsed, not dropped: the words are what the reader came for.
    const back = parseEntry(line);
    expect(back?.text).toBe('Two lines and tabs');
  });

  it('reads back nothing from a line that is not an entry', () => {
    for (const line of [
      '',
      '# Project log',
      'plain prose somebody typed',
      '- not an entry',
      '- `not-a-date` **run** · x',
      '  - `2026-08-05T10:04:00.000Z` **run** · indented',
    ]) {
      expect(parseEntry(line), JSON.stringify(line)).toBeNull();
    }
  });

  // An unknown kind is a line this format did not write. Accepting it would let a hand-typed note
  // become an event the checkup reasons about.
  it('refuses a kind it does not know', () => {
    expect(parseEntry('- `2026-08-05T10:04:00.000Z` **gossip** · hello')).toBeNull();
  });

  it('keeps the file order, which is the order things happened', () => {
    const content = [
      DIARY_HEADER,
      serializeEntry(entry({ at: '2026-08-05T09:00:00.000Z', text: 'first' })),
      'a stray note somebody typed',
      '',
      serializeEntry(entry({ at: '2026-08-05T10:00:00.000Z', text: 'second' })),
    ].join('\n');
    expect(parseDiary(content).map((e) => e.text)).toEqual(['first', 'second']);
  });

  it('reads nothing at all out of an empty file', () => {
    expect(parseDiary('')).toEqual([]);
    expect(parseDiary(DIARY_HEADER)).toEqual([]);
  });

  // Asserted as an exact list so a new kind has to be DECIDED rather than appear. It worked: `note` was
  // added on 2026-08-05 by the owner's ruling when slice C was planned, and this line is what made that a
  // decision instead of a drive-by. The property is unchanged — a fifth still has to come through here.
  it('names four kinds and no more', () => {
    expect([...DIARY_KINDS]).toEqual(['run', 'checkup', 'lifecycle', 'note']);
  });

  // A summary is prose an agent wrote, so it will contain the characters this format uses. They must
  // survive as text rather than being read as structure.
  it('keeps a summary that looks like the format itself', () => {
    const e = entry({ kind: 'run', text: 'Fixed `a · b` and **bold** — see E-002/implement → success' });
    expect(parseEntry(serializeEntry(e))).toEqual(e);
  });

  it('leaves out a field that was not measured, rather than inventing one', () => {
    const back = parseEntry(serializeEntry(entry({ kind: 'run', card: 'E-001' })));
    expect(back).not.toHaveProperty('iteration');
    expect(back).not.toHaveProperty('skill');
    expect(back?.card).toBe('E-001');
  });

  // The fields are LABELLED for this reason. Positional guessing read the first unlabelled part as a
  // card, so a checkup entry naming only its skill came back as a card called "checkup" — a card id the
  // board has never heard of, handed to the reader that decides whether the project is circling.
  it('does not turn a skill with no card into a card', () => {
    const e = entry({ kind: 'checkup', skill: 'checkup', text: 'Looked at the board.' });
    expect(parseEntry(serializeEntry(e))).toEqual(e);
  });

  it('does not turn a card with no board into a skill', () => {
    const e = entry({ kind: 'run', card: 'E-001', skill: 'implement' });
    const back = parseEntry(serializeEntry(e));
    expect(back?.card).toBe('E-001');
    expect(back?.skill).toBe('implement');
  });

  // A skill slug is a folder name, so a slash in one is not impossible — and it used to make the pair
  // read as a board.
  it('keeps a skill that contains a separator out of the card', () => {
    const e = entry({ kind: 'run', card: 'E-001', board: 'product', skill: 'a/b' });
    expect(parseEntry(serializeEntry(e))).toEqual(e);
  });

  // A field VALUE must not be able to fabricate other fields. Only `text` was escaped, so an `outcome` of
  // `success · card E-999 · iteration 42` round-tripped into three fields — two the caller never sent, one a
  // card id the board has never heard of, handed to the reader that decides whether the project is circling.
  // Exactly the class the labels were introduced to kill, arriving through the other door.
  it('does not let one field invent another', () => {
    const e = entry({ kind: 'run', outcome: 'success · card E-999 · iteration 42', text: 'real summary' });
    const back = parseEntry(serializeEntry(e));
    expect(back?.card).toBeUndefined();
    expect(back?.iteration).toBeUndefined();
    expect(back?.text).toBe('real summary');
  });

  it('does not let a field value steal the summary', () => {
    const e = entry({ kind: 'run', outcome: 'success — really', text: 'the real one' });
    expect(parseEntry(serializeEntry(e))?.text).toBe('the real one');
  });

  it('keeps a card id containing the field separator whole', () => {
    const e = entry({ kind: 'run', card: 'E-001 · E-002' });
    const back = parseEntry(serializeEntry(e));
    expect(back?.card).toBe('E-001 · E-002');
    expect(back?.skill).toBeUndefined();
  });

  // The bytes, not a round-trip. Every other test here goes through this module's own pair of separators, so
  // swapping BOTH length-preservingly left 53 tests green while every diary written by an older version
  // became zero entries on read. A format two readers depend on has to be pinned as bytes somewhere.
  it('writes exactly these bytes', () => {
    expect(
      serializeEntry({
        at: '2026-08-05T10:04:00.000Z',
        kind: 'run',
        iteration: 3,
        card: 'E-001',
        board: 'engineering',
        skill: 'implement',
        outcome: 'success',
        text: 'Added the token store.',
      }),
    ).toBe(
      '- `2026-08-05T10:04:00.000Z` **run** iteration 3 · card engineering/E-001 · skill implement · outcome success — Added the token store.',
    );
  });

  it('reads exactly those bytes back', () => {
    const line = '- `2026-08-05T10:04:00.000Z` **checkup** iteration 10 — Archived two stale cards.';
    expect(parseEntry(line)).toEqual({
      at: '2026-08-05T10:04:00.000Z',
      kind: 'checkup',
      iteration: 10,
      text: 'Archived two stale cards.',
    });
  });

  // Zero is a real iteration — the pre-flight entry is written before anything has been dispatched —
  // and it must not read the same as "no iteration recorded".
  it('keeps an iteration of zero', () => {
    const back = parseEntry(serializeEntry(entry({ kind: 'lifecycle', iteration: 0 })));
    expect(back?.iteration).toBe(0);
  });
});

// Three items the spec parked with slice C as their trigger. C1 is that trigger: C2 is what starts
// writing entries from agent output, and all three are about what may reach the file.
describe('the fourth kind', () => {
  // Decided 2026-08-05, when C was planned. `lifecycle` is the spec's class for "pre-flight, approval,
  // every stop with its reason" — the class C2 reads to learn why a run stopped — and a note somebody
  // typed is none of those. One class for both put human prose in the machine's input.
  it('is a kind of its own, and round-trips', () => {
    expect([...DIARY_KINDS]).toContain('note');
    const line = serializeEntry({ at: '2026-08-05T10:00:00.000Z', kind: 'note', text: 'I rebased.' });
    expect(parseEntry(line)).toEqual({ at: '2026-08-05T10:00:00.000Z', kind: 'note', text: 'I rebased.' });
  });
});

describe('the length of an entry', () => {
  // The text originates in an AGENT's summary, which is what makes this more than theoretical: without a
  // bound one POST could add a ~1 MB line, and every GET re-parses the whole growing file.
  // EXACT, at the boundary, and both sides of it. The first version asserted `<= MAX + 1` on a 2,500
  // character input, which is a magnitude check rather than a bound: it allowed 2,001 characters for a
  // bound stated as 2,000, and it stayed green both when the slice went one over AND when a legal
  // 2,000-character line was truncated.
  it('is bounded, and says it was cut', () => {
    const bounded = boundText('x'.repeat(MAX_ENTRY_TEXT + 500));
    expect(bounded).toHaveLength(MAX_ENTRY_TEXT);
    expect(bounded.endsWith('\u2026')).toBe(true);
  });

  it('leaves a line of exactly the maximum untouched, ellipsis and all', () => {
    const exact = 'z'.repeat(MAX_ENTRY_TEXT);
    expect(boundText(exact)).toBe(exact);
  });

  it('cuts a line one character over, and only by what it has to', () => {
    const over = 'z'.repeat(MAX_ENTRY_TEXT + 1);
    const bounded = boundText(over);
    expect(bounded).toHaveLength(MAX_ENTRY_TEXT);
    expect(bounded).toBe(`${'z'.repeat(MAX_ENTRY_TEXT - 1)}\u2026`);
  });

  // Truncated rather than refused, and the direction is deliberate: an entry is a narrative line, and
  // losing the whole event to save its last 1,900 characters is the wrong way round. Same reasoning as
  // `oneLine` collapsing a newline instead of dropping the summary.
  it('leaves anything shorter exactly as it was', () => {
    expect(boundText('a normal summary')).toBe('a normal summary');
  });

  // It is the same one line either way: a bounded value must still be a single event.
  it('collapses before it counts, so a bound cannot be spent on whitespace', () => {
    expect(boundText('two\nlines')).toBe('two lines');
  });
});

describe('the timestamp and the kind', () => {
  // `entryBlock` is exported and an `at` carrying a newline forges an event AND destroys the real one.
  // Not reachable through either caller today — both pass a server clock — so this is a guard rather
  // than a fix, and the trigger the spec recorded was "the first caller that is not nowIso()".
  it('cannot carry a newline into the file', () => {
    const line = serializeEntry({
      at: 'AT\n- `2026-08-05T10:00:00.000Z` **run** forged',
      kind: 'note',
      text: 'real',
    });
    expect(line.split('\n')).toHaveLength(1);
  });

  // The `kind` half of the same line, which nothing constrained: only `at` was gated. A kind is typed as
  // an enum, so this arrives only through a cast or an untyped caller — which is exactly what
  // `entryBlock` being exported means.
  it('cannot carry a newline in the kind either', () => {
    const line = serializeEntry({
      at: '2026-08-05T10:00:00.000Z',
      kind: 'note\nforged' as never,
      text: 'real',
    });
    expect(line.split('\n')).toHaveLength(1);
  });

  it('cannot carry one through entryBlock either', () => {
    const block = entryBlock({ at: 'AT\nforged', kind: 'note', text: 'real' }, false);
    expect(block.split('\n').filter((l) => l !== '')).toHaveLength(1);
  });
});

// A TIMESTAMP AND AN ITERATION THIS MODULE COULD HAVE WRITTEN, not merely ones shaped like them.
// Both are reachable only by hand-editing the file — the endpoint stamps `nowIso()` and requires a
// number — but a hand-edited diary is read by the checkup, so an impossible date reaching its
// reasoning is a fact nobody stated.
describe('a diary line that was not written here', () => {
  it('refuses an impossible date that is the right shape', () => {
    // `\d{4}-\d{2}-\d{2}` accepts this and `[\d:.]+` accepts a time with no digits at all.
    expect(parseEntry('- `9999-99-99T:::Z` **note** hand-typed')).toBeNull();
  });

  it('refuses a real date written in a form this module would not produce', () => {
    // Four fractional digits: `Date.parse` accepts it, `toISOString` writes three, so the round trip
    // fails. That is the claim — this module wrote it, or it did not.
    expect(parseEntry('- `2026-08-31T12:00:00.0000Z` **note** close, but not ours')).toBeNull();
  });

  it('still reads a timestamp it did write', () => {
    // The positive control. Without it the three refusals above pass on a parser that rejects
    // everything, which is the vacuous version of this whole block.
    const entry = parseEntry('- `2026-08-31T12:00:00.000Z` **note** ours');
    expect(entry?.at).toBe('2026-08-31T12:00:00.000Z');
    expect(entry?.text).toBe('');
  });

  it('refuses an iteration that is not decimal digits', () => {
    // `Number('0x10')` is 16 and `Number('1e3')` is 1000 — both integers, neither typed by anyone.
    for (const value of ['0x10', '1e3', '+7', ' 7']) {
      const entry = parseEntry(`- \`2026-08-31T12:00:00.000Z\` **note** iteration ${value} — x`);
      expect(entry?.iteration, value).toBeUndefined();
    }
  });

  it('still reads an iteration it did write', () => {
    const entry = parseEntry('- `2026-08-31T12:00:00.000Z` **note** iteration 12 — x');
    expect(entry?.iteration).toBe(12);
  });
});
