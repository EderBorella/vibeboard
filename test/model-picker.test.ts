import { describe, it, expect } from 'vitest';
import { matchesFilter, compareModels, type ModelFilter } from '../web/src/components/ModelPicker.js';
import type { ModelOption } from '../web/src/api.js';

const model = (id: string, over: Partial<ModelOption> = {}): ModelOption =>
  ({ id, name: id, free: false, caps: { toolCall: true, vision: false }, ...over }) as ModelOption;

const filter = (over: Partial<ModelFilter> = {}): ModelFilter => ({
  query: '',
  provider: 'all',
  toolOnly: false,
  freeOnly: false,
  visionOnly: false,
  value: '',
  defaultModel: '',
  ...over,
});

describe('matchesFilter', () => {
  it('keeps everything when no filter is set', () => {
    expect(matchesFilter(model('a/one'), filter())).toBe(true);
  });

  it('filters on tool-call, free and vision capability', () => {
    expect(
      matchesFilter(
        model('a', { caps: { toolCall: false } } as Partial<ModelOption>),
        filter({ toolOnly: true }),
      ),
    ).toBe(false);
    expect(matchesFilter(model('a'), filter({ toolOnly: true }))).toBe(true);
    expect(matchesFilter(model('a'), filter({ freeOnly: true }))).toBe(false);
    expect(matchesFilter(model('a', { free: true }), filter({ freeOnly: true }))).toBe(true);
    expect(matchesFilter(model('a'), filter({ visionOnly: true }))).toBe(false);
  });

  it('filters by provider, treating an unprefixed id as claude', () => {
    expect(matchesFilter(model('opencode/x'), filter({ provider: 'opencode' }))).toBe(true);
    expect(matchesFilter(model('opencode/x'), filter({ provider: 'claude' }))).toBe(false);
    expect(matchesFilter(model('opus'), filter({ provider: 'claude' }))).toBe(true);
  });

  it('matches the query against id and name, case-insensitively', () => {
    expect(matchesFilter(model('a/deepseek', { name: 'DeepSeek V4' }), filter({ query: 'deep' }))).toBe(true);
    expect(matchesFilter(model('a/x', { name: 'Other' }), filter({ query: 'deep' }))).toBe(false);
    expect(matchesFilter(model('a/x', { name: 'Other' }), filter({ query: '  OTHER ' }))).toBe(true);
  });

  it('never hides the current selection or the backend default', () => {
    // Every filter set against it, and it still survives — otherwise the list would imply the
    // selected model is not what is in force.
    const strict = filter({ toolOnly: true, freeOnly: true, visionOnly: true, provider: 'nope' });
    const hidden = model('a/x', { free: false, caps: { toolCall: false } } as Partial<ModelOption>);
    expect(matchesFilter(hidden, strict)).toBe(false);
    expect(matchesFilter(hidden, { ...strict, value: 'a/x' })).toBe(true);
    expect(matchesFilter(hidden, { ...strict, defaultModel: 'a/x' })).toBe(true);
  });
});

describe('compareModels', () => {
  const sorted = (
    ids: string[],
    ctx: { defaultModel: string; favs: Set<string> },
    over: Record<string, Partial<ModelOption>> = {},
  ): string[] =>
    ids
      .map((id) => model(id, over[id] ?? {}))
      .sort((a, b) => compareModels(a, b, ctx))
      .map((m) => m.id);

  it('puts the backend default first, above favourites', () => {
    const ctx = { defaultModel: 'd', favs: new Set(['f']) };
    expect(sorted(['a', 'f', 'd'], ctx)).toEqual(['d', 'f', 'a']);
  });

  it('puts favourites above free models', () => {
    const ctx = { defaultModel: '', favs: new Set(['f']) };
    expect(sorted(['a', 'f', 'z'], ctx, { z: { free: true } })).toEqual(['f', 'z', 'a']);
  });

  it('falls back to name order, using the id when unnamed', () => {
    const ctx = { defaultModel: '', favs: new Set<string>() };
    expect(sorted(['b', 'a', 'c'], ctx)).toEqual(['a', 'b', 'c']);
    expect(sorted(['b', 'a'], ctx, { a: { name: 'zzz' }, b: { name: 'aaa' } })).toEqual(['b', 'a']);
  });

  it('is a stable ordering for equal models', () => {
    const ctx = { defaultModel: '', favs: new Set<string>() };
    expect(compareModels(model('a'), model('a'), ctx)).toBe(0);
  });
});
