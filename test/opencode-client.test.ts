import { describe, expect, it } from 'vitest';
import { messageToEvents, splitModel } from '../src/server/boxes/opencode-client.js';

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

// Every test below is about ONE field of the result, so each builds the payload it describes rather
// than sharing a literal a stale expectation could keep passing against.
function result(...args: Parameters<typeof messageToEvents>) {
  const found = messageToEvents(...args).events.find((e) => e.kind === 'result');
  if (found?.kind !== 'result') throw new Error('expected a result event');
  return found;
}

describe('messageToEvents', () => {
  it('maps a successful message (real shape) to text + usage + result', () => {
    const data = {
      info: {
        sessionID: 'ses_x',
        cost: 0.001652,
        tokens: { input: 11774, output: 2, cache: { read: 0, write: 0 } },
        time: { created: 1785595903966, completed: 1785595905977 },
      },
      parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'hmm' },
        { type: 'text', text: 'ok' },
        { type: 'step-finish' },
      ],
    };
    const { events } = messageToEvents(data, 0);
    expect(events).toContainEqual({ kind: 'text', text: 'ok' });
    expect(events).toContainEqual({ kind: 'usage', contextTokens: 11774 });
    const res = result(data, 0);
    expect(res.sessionId).toBe('ses_x');
    expect(res.stats).toMatchObject({
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
    const { events } = messageToEvents(data, 0);
    expect(events.some((e) => e.kind === 'text' && e.text.includes('model deprecated'))).toBe(true);
    expect(result(data, 0).stats.ok).toBe(false);
  });

  describe('the error it reports', () => {
    // The failure this change exists for: `[opencode: Streaming response failed]` was all a failed
    // run left behind, and it names neither the kind of fault nor the provider that had it.
    it('names the error as well as its message, when both are there and differ', () => {
      const { events } = messageToEvents(
        { info: { error: { name: 'ProviderStreamError', data: { message: 'Streaming response failed' } } } },
        0,
      );
      expect(events).toContainEqual({
        kind: 'text',
        text: '\n[opencode: ProviderStreamError: Streaming response failed]',
      });
    });

    it('says it once when the name and the message are the same string', () => {
      const { events } = messageToEvents(
        { info: { error: { name: 'Overloaded', data: { message: 'Overloaded' } } } },
        0,
      );
      expect(events).toContainEqual({ kind: 'text', text: '\n[opencode: Overloaded]' });
    });

    it('falls back to the name, then to a plain word, when there is no message', () => {
      expect(messageToEvents({ info: { error: { name: 'AuthError' } } }, 0).events).toContainEqual({
        kind: 'text',
        text: '\n[opencode: AuthError]',
      });
      expect(messageToEvents({ info: { error: {} } }, 0).events).toContainEqual({
        kind: 'text',
        text: '\n[opencode: error]',
      });
    });

    it('threads the WHOLE error object out, not just the part it printed', () => {
      // The transcript line stays short; the detail still has to reach the log, so the caller is
      // handed the object verbatim rather than the string.
      const error = {
        name: 'ProviderStreamError',
        data: { message: 'Streaming response failed', providerID: 'opencode', status: 502 },
        retryable: true,
      };
      expect(messageToEvents({ info: { error } }, 0).error).toEqual(error);
    });

    it('reports no error on a message that did not fail', () => {
      expect(messageToEvents({ info: { sessionID: 's' }, parts: [] }, 0).error).toBeUndefined();
    });
  });

  describe('what the turn cost', () => {
    it('takes the duration from the server’s own stamps', () => {
      // Real values from a live server's response: created → completed is the turn as it timed it.
      // The measured fallback is absurd on purpose, so a regression to it cannot pass.
      expect(
        result({ info: { time: { created: 1785595903966, completed: 1785595905977 } } }, 999_999).stats
          .durationMs,
      ).toBe(2011);
    });

    it('falls back to the measured elapsed when the response carries no timing', () => {
      expect(result({ info: {} }, 1234).stats.durationMs).toBe(1234);
      expect(result({ info: { time: { created: 1000 } } }, 1234).stats.durationMs).toBe(1234);
      expect(result({ info: { time: { completed: 2000 } } }, 1234).stats.durationMs).toBe(1234);
    });

    it('falls back rather than reporting a negative duration', () => {
      expect(result({ info: { time: { created: 2000, completed: 1000 } } }, 1234).stats.durationMs).toBe(
        1234,
      );
    });

    it('omits turns entirely rather than claiming one', () => {
      // Absence and zero are different facts in RunUsage, and OpenCode reports neither a turn count
      // nor anything that means the same thing — so the honest record has no `turns` at all. The
      // step-start part is here because counting those is the tempting wrong answer.
      const stats = result(
        { info: { time: { created: 1, completed: 2 } }, parts: [{ type: 'step-start' }] },
        0,
      ).stats;
      expect(stats).not.toHaveProperty('turns');
    });
  });
});
