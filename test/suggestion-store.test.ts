import { describe, expect, it } from 'vitest';
import type { Suggestion } from '../src/core/suggestions.js';
import {
  countRunSuggestions,
  listSuggestions,
  setSuggestionState,
  writeSuggestion,
} from '../src/server/suggestion-store.js';
import { tempDir } from './helpers.js';

const make = (id: string, over: Partial<Suggestion> = {}): Suggestion => ({
  id,
  state: 'active',
  created: `2026-08-02T10:00:0${id}.000Z`,
  title: `finding ${id}`,
  body: 'body',
  ...over,
});

describe('the suggestion store', () => {
  it('filters by state', async () => {
    const root = await tempDir();
    // Two active, so the filter has to actually filter — with one of each, returning everything
    // and returning only the active one are indistinguishable.
    await writeSuggestion(root, make('1'));
    await writeSuggestion(root, make('2'));
    await writeSuggestion(root, make('3', { state: 'dismissed' }));
    expect((await listSuggestions(root, 'active')).map((s) => s.id)).toEqual(['1', '2']);
    expect((await listSuggestions(root)).map((s) => s.id)).toEqual(['1', '2', '3']);
  });

  it('is empty, not broken, before anything has been filed', async () => {
    expect(await listSuggestions(await tempDir(), 'active')).toEqual([]);
  });

  it('records the reason when dismissing, and none when actioning', async () => {
    const root = await tempDir();
    await writeSuggestion(root, make('1'));
    expect((await setSuggestionState(root, '1', 'dismissed', 'out of scope'))?.reason).toBe('out of scope');
    await writeSuggestion(root, make('2'));
    const actioned = await setSuggestionState(root, '2', 'actioned');
    expect(actioned?.state).toBe('actioned');
    expect(actioned).not.toHaveProperty('reason');
  });

  it('drops a stale reason when a dismissed suggestion is reopened', async () => {
    const root = await tempDir();
    await writeSuggestion(root, make('1', { state: 'dismissed', reason: 'out of scope' }));
    expect(await setSuggestionState(root, '1', 'active')).not.toHaveProperty('reason');
  });

  it('answers null for an id that does not exist, rather than inventing one', async () => {
    expect(await setSuggestionState(await tempDir(), 'nope', 'actioned')).toBeNull();
  });

  it('counts only the suggestions a given run filed', async () => {
    const root = await tempDir();
    await writeSuggestion(root, make('1', { run: 'run-a' }));
    await writeSuggestion(root, make('2', { run: 'run-a' }));
    await writeSuggestion(root, make('3', { run: 'run-b' }));
    await writeSuggestion(root, make('4'));
    expect(await countRunSuggestions(root, 'run-a')).toBe(2);
    expect(await countRunSuggestions(root, 'run-z')).toBe(0);
  });
});
