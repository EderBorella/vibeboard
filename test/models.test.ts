import { describe, expect, it } from 'vitest';
import { mergeModels, modelsFromProvider } from '../src/server/models.js';

describe('mergeModels', () => {
  it('dedupes by id and lists free models first', () => {
    const merged = mergeModels([
      [
        { id: 'deepseek/deepseek-v4-flash', free: false },
        { id: 'opencode/x-free', free: true },
      ],
      [
        { id: 'opencode/x-free', free: true },
        { id: 'openrouter/a:free', free: true },
      ],
    ]);
    expect(merged.map((m) => m.id)).toEqual([
      'opencode/x-free',
      'openrouter/a:free',
      'deepseek/deepseek-v4-flash',
    ]);
    expect(merged.filter((m) => m.id === 'opencode/x-free')).toHaveLength(1); // deduped
  });
});

describe('modelsFromProvider', () => {
  it('maps capabilities, limits and cost into a prefixed ModelOption', () => {
    const out = modelsFromProvider('deepseek', {
      'deepseek-v4-flash': {
        name: 'DeepSeek V4 Flash',
        capabilities: { toolcall: true, reasoning: true, attachment: false, input: { image: false } },
        limit: { context: 1000000, output: 384000 },
        cost: { input: 0.14, output: 0.28 },
      },
    });
    expect(out).toEqual([
      {
        id: 'deepseek/deepseek-v4-flash',
        free: false,
        name: 'DeepSeek V4 Flash',
        promptPerM: 0.14,
        completionPerM: 0.28,
        contextLength: 1000000,
        caps: { toolCall: true, reasoning: true, vision: false, attachment: false },
      },
    ]);
  });

  it('marks a zero-cost model free and reads image input as vision', () => {
    const [m] = modelsFromProvider('opencode', {
      'ling-3.0-flash-free': {
        capabilities: { toolcall: false, input: { image: true } },
        cost: { input: 0, output: 0 },
      },
    });
    expect(m.id).toBe('opencode/ling-3.0-flash-free');
    expect(m.free).toBe(true);
    expect(m.caps).toEqual({ toolCall: false, reasoning: undefined, vision: true, attachment: undefined });
  });

  it('is safe on empty / capability-less definitions', () => {
    expect(modelsFromProvider('x', {})).toEqual([]);
    const [m] = modelsFromProvider('x', { bare: {} });
    expect(m).toMatchObject({ id: 'x/bare', free: true });
  });
});
