import { describe, it, expect } from 'vitest';
import { isFreeModel, mergeModels } from '../src/server/models.js';

describe('isFreeModel', () => {
  it('flags OpenRouter :free and OpenCode -free ids', () => {
    expect(isFreeModel('openrouter/deepseek/deepseek-r1:free')).toBe(true);
    expect(isFreeModel('opencode/deepseek-v4-flash-free')).toBe(true);
    expect(isFreeModel('deepseek/deepseek-v4-flash')).toBe(false);
    expect(isFreeModel('opus')).toBe(false);
  });
});

describe('mergeModels', () => {
  it('dedupes by id and lists free models first', () => {
    const merged = mergeModels([
      [{ id: 'deepseek/deepseek-v4-flash', free: false }, { id: 'opencode/x-free', free: true }],
      [{ id: 'opencode/x-free', free: true }, { id: 'openrouter/a:free', free: true }],
    ]);
    expect(merged.map((m) => m.id)).toEqual(['opencode/x-free', 'openrouter/a:free', 'deepseek/deepseek-v4-flash']);
    expect(merged.filter((m) => m.id === 'opencode/x-free')).toHaveLength(1); // deduped
  });
});
