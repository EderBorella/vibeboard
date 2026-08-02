import { describe, expect, it } from 'vitest';
import { parseSuggestion, type Suggestion, serializeSuggestion } from '../src/core/suggestions.js';

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
    };
    expect(parseSuggestion(serializeSuggestion(full))).toEqual(full);
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
  });
});
