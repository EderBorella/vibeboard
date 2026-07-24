import { describe, it, expect } from 'vitest';
import { isFreeModel, mergeModels, opencodeModelsFromProviders } from '../src/server/models.js';

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

describe('opencodeModelsFromProviders', () => {
  it('extracts only the opencode gateway provider, prefixed and free-flagged', () => {
    const json = {
      providers: [
        { id: 'deepseek', models: { 'deepseek-v4-flash': {}, 'deepseek-chat': {} } },
        { id: 'openrouter', models: { 'microsoft/phi-4': {} } },
        { id: 'opencode', models: { 'deepseek-v4-flash-free': {}, 'ling-3.0-flash-free': {}, 'big-pickle': {} } },
      ],
    };
    expect(opencodeModelsFromProviders(json)).toEqual([
      { id: 'opencode/deepseek-v4-flash-free', free: true },
      { id: 'opencode/ling-3.0-flash-free', free: true },
      { id: 'opencode/big-pickle', free: false },
    ]);
  });

  it('is safe on an empty / malformed payload', () => {
    expect(opencodeModelsFromProviders({})).toEqual([]);
    expect(opencodeModelsFromProviders({ providers: [{ id: 'opencode' }] })).toEqual([]);
  });
});
