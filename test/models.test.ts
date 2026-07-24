import { describe, it, expect } from 'vitest';
import { isFreeModel, parseOpencodeModels } from '../src/server/models.js';

describe('isFreeModel', () => {
  it('flags OpenRouter :free and OpenCode -free ids', () => {
    expect(isFreeModel('openrouter/deepseek/deepseek-r1:free')).toBe(true);
    expect(isFreeModel('opencode/deepseek-v4-flash-free')).toBe(true);
    expect(isFreeModel('deepseek/deepseek-chat')).toBe(false);
    expect(isFreeModel('opus')).toBe(false);
  });
});

describe('parseOpencodeModels', () => {
  it('parses lines into options with free flags', () => {
    const out = 'opencode/deepseek-v4-flash-free\ndeepseek/deepseek-chat\n\n  deepseek/deepseek-reasoner  \n';
    expect(parseOpencodeModels(out)).toEqual([
      { id: 'opencode/deepseek-v4-flash-free', free: true },
      { id: 'deepseek/deepseek-chat', free: false },
      { id: 'deepseek/deepseek-reasoner', free: false },
    ]);
  });
});
