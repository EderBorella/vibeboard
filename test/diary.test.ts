import { describe, expect, it } from 'vitest';
import {
  DIARY_HEADER,
  DIARY_KINDS,
  type DiaryEntry,
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

  // The three the spec names, asserted as a list so a fourth added later has to be decided rather than
  // appearing. Same property the stop reasons have.
  it('names three kinds and no more', () => {
    expect([...DIARY_KINDS]).toEqual(['run', 'checkup', 'lifecycle']);
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

  // Zero is a real iteration — the pre-flight entry is written before anything has been dispatched —
  // and it must not read the same as "no iteration recorded".
  it('keeps an iteration of zero', () => {
    const back = parseEntry(serializeEntry(entry({ kind: 'lifecycle', iteration: 0 })));
    expect(back?.iteration).toBe(0);
  });
});
