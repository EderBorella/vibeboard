import { describe, expect, it } from 'vitest';
import {
  parseSuggestion,
  SUGGESTION_KEYS,
  type Suggestion,
  serializeSuggestion,
} from '../src/core/suggestions.js';

const NOW = '2026-08-02T10:00:00.000Z';
const base: Suggestion = {
  id: '20260802-1',
  state: 'active',
  created: NOW,
  title: 'The query is linear',
  body: 'It scans every card on every keystroke.',
};

describe('parseSuggestion', () => {
  it('round-trips every field', () => {
    const full: Suggestion = {
      ...base,
      run: 'run-7',
      card: 'E-001',
      board: 'engineering',
      state: 'dismissed',
      reason: 'out of scope',
      became: 'P-004',
    };
    expect(parseSuggestion(serializeSuggestion(full))).toEqual(full);
    // Every field the record HAS is in the round trip, so a new one cannot be added without either
    // travelling through the parser or failing here.
    expect([...SUGGESTION_KEYS].sort()).toEqual(Object.keys(full).sort());
  });

  // `became` is the card it BECAME; `card` is the card it was filed FROM. Two facts, and reusing one
  // field for both would make "which card is this about" unanswerable.
  it('keeps became and card apart', () => {
    const parsed = parseSuggestion(
      serializeSuggestion({ ...base, card: 'E-001', became: 'P-004', state: 'actioned' }),
    );
    expect(parsed?.card).toBe('E-001');
    expect(parsed?.became).toBe('P-004');
  });

  it('returns null for a file that is not a suggestion', () => {
    expect(parseSuggestion('just some notes\n')).toBeNull();
    expect(parseSuggestion('---\nid: x\n---\nno title\n')).toBeNull();
  });

  it('returns null for frontmatter that will not parse, twice in a row', () => {
    // Twice on purpose: gray-matter caches by input string and caches an EMPTY result after a
    // throw, so the second identical file used to parse "successfully" as {}.
    const broken = '---\ntitle: "oops\n---\nbody\n';
    expect(parseSuggestion(broken)).toBeNull();
    expect(parseSuggestion(broken)).toBeNull();
  });

  it('degrades an unknown state to active rather than dropping the finding', () => {
    const parsed = parseSuggestion('---\nid: x\nstate: banana\ntitle: t\ncreated: n\n---\nbody\n');
    expect(parsed?.state).toBe('active');
  });

  it('leaves absent fields absent rather than empty', () => {
    const parsed = parseSuggestion(serializeSuggestion(base));
    expect(parsed).not.toHaveProperty('run');
    expect(parsed).not.toHaveProperty('reason');
    expect(parsed).not.toHaveProperty('became');
  });

  // The same `asText` guard the other optional fields get: a blank one is no answer, and a non-string
  // is a hand-edited file rather than a card id.
  it('drops a became that is blank or not a string', () => {
    expect(parseSuggestion('---\nid: x\ntitle: t\nbecame: "   "\n---\nb\n')).not.toHaveProperty('became');
    expect(parseSuggestion('---\nid: x\ntitle: t\nbecame: 7\n---\nb\n')).not.toHaveProperty('became');
  });
});
