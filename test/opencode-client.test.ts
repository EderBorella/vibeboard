import { describe, it, expect } from 'vitest';
import { splitModel, messageToEvents } from '../src/server/opencode-client.js';

describe('splitModel', () => {
  it('splits provider/model on the first slash (modelID may contain slashes)', () => {
    expect(splitModel('deepseek/deepseek-v4-flash')).toEqual({
      providerID: 'deepseek',
      modelID: 'deepseek-v4-flash',
    });
    expect(splitModel('openrouter/deepseek/deepseek-r1:free')).toEqual({
      providerID: 'openrouter',
      modelID: 'deepseek/deepseek-r1:free',
    });
  });
});

describe('messageToEvents', () => {
  it('maps a successful message (real shape) to text + usage + result', () => {
    const data = {
      info: {
        sessionID: 'ses_x',
        cost: 0.001652,
        tokens: { input: 11774, output: 2, cache: { read: 0, write: 0 } },
      },
      parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'hmm' },
        { type: 'text', text: 'ok' },
        { type: 'step-finish' },
      ],
    };
    const events = messageToEvents(data);
    expect(events).toContainEqual({ kind: 'text', text: 'ok' });
    expect(events).toContainEqual({ kind: 'usage', contextTokens: 11774 });
    const result = events.find((e) => e.kind === 'result');
    if (!result || result.kind !== 'result') throw new Error('expected result');
    expect(result.sessionId).toBe('ses_x');
    expect(result.stats).toMatchObject({
      ok: true,
      costUsd: 0.001652,
      contextTokens: 11774,
      outputTokens: 2,
    });
    // reasoning is dropped (thinking hidden)
    expect(events.some((e) => e.kind === 'text' && e.text === 'hmm')).toBe(false);
  });

  it('surfaces an API error and marks the result not-ok', () => {
    const data = {
      info: { sessionID: 's', error: { name: 'APIError', data: { message: 'model deprecated' } } },
      parts: [],
    };
    const events = messageToEvents(data);
    expect(events.some((e) => e.kind === 'text' && e.text.includes('model deprecated'))).toBe(true);
    const result = events.find((e) => e.kind === 'result');
    if (!result || result.kind !== 'result') throw new Error('expected result');
    expect(result.stats.ok).toBe(false);
  });
});
