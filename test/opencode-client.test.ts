import { describe, expect, it } from 'vitest';
import {
  messageToEvents,
  neverConnected,
  OpencodeTurnFailed,
  splitModel,
} from '../src/server/boxes/opencode-client.js';

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
    // `error`, NOT `text`. It used to be `text`, which is what the model SAID — so a failed turn
    // arrived as an ordinary assistant bubble that could be neither styled nor acted on.
    expect(events.some((e) => e.kind === 'error' && e.text.includes('model deprecated'))).toBe(true);
    expect(result(data, 0).stats.ok).toBe(false);
  });

  describe('the error it reports', () => {
    // The failure this change exists for: `[opencode: Streaming response failed]` was all a failed
    // run left behind, and it names neither the kind of fault nor the provider that had it.
    // SINCE 2026-08-31 the composed string is the INPUT to `classifyCopilotError` rather than the
    // output: what the user reads is a situation and a remedy, with this appended in parentheses so
    // an unrecognised failure stays diagnosable. These cases still pin the composition.
    it('names the error as well as its message, when both are there and differ', () => {
      const { events } = messageToEvents(
        { info: { error: { name: 'ProviderStreamError', data: { message: 'Streaming response failed' } } } },
        0,
      );
      // The COMPOSITION is still the subject — name plus message — but it is now the input to
      // `classifyCopilotError` rather than the whole of what the user reads, so it is asserted as a
      // substring of the sentence instead of as the sentence.
      const error = events.find((e) => e.kind === 'error');
      expect(error?.text).toContain('ProviderStreamError: Streaming response failed');
    });

    it('says it once when the name and the message are the same string', () => {
      const { events } = messageToEvents(
        { info: { error: { name: 'Overloaded', data: { message: 'Overloaded' } } } },
        0,
      );
      const error = events.find((e) => e.kind === 'error');
      expect(error?.text).toContain('Overloaded');
      // Once, not twice — that is what this case has always been about.
      expect(error?.text.match(/Overloaded/g)).toHaveLength(1);
    });

    it('falls back to the name, then to a plain word, when there is no message', () => {
      const named = messageToEvents({ info: { error: { name: 'AuthError' } } }, 0).events.find(
        (e) => e.kind === 'error',
      );
      expect(named?.text).toContain('AuthError');
      const bare = messageToEvents({ info: { error: {} } }, 0).events.find((e) => e.kind === 'error');
      expect(bare?.text).toContain('error');
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

// A REQUEST THAT NEVER CROSSED THE WIRE, which is the one thing that makes a dead OpenCode turn
// classifiable. `fault.ts` will only call a run the machine's fault when the backend REPORTED usage and
// that usage was zero both ways — absent usage says nothing at all — and its own comment names this as
// the one known case left unclassified for want of a record to derive it from.
//
// There are three now, from the calculator project on 2026-08-16: 449ms each, no turns, no tokens, and
// a whole transcript of `[opencode failed: fetch failed]`. Auto-pilot burned all three of
// derive-features' attempts on them and stopped saying the README was too thin to derive features
// from. Nothing had opened the README.
//
// The distinction this pins is the honest one: a connection that was never established moved no
// tokens, and we know it. A server that ANSWERED — 500, 404, anything — may have done work first, so
// that stays unclaimed and keeps burning, exactly as before.
describe('whether the request reached the server at all', () => {
  it('calls a refused connection unreachable', () => {
    // What undici throws when nothing is listening: a TypeError whose cause carries the syscall error.
    // This is the shape the calculator produced against a container that had been removed.
    const err = new TypeError('fetch failed');
    (err as Error & { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });

    expect(neverConnected(err)).toBe(true);
  });

  it('does not call an HTTP error unreachable, because the server answered it', () => {
    // `postJson` throws this itself for a non-2xx. The server was reached and may have spent tokens
    // before failing, so claiming zero usage here would hand a card unlimited retries.
    expect(neverConnected(new Error('opencode 500: internal error'))).toBe(false);
  });

  it('sees through the wrapper that carries the session id out of a failed turn', () => {
    // `opencodeTurn` rewraps so a failed turn does not lose its conversation. The classification has to
    // read the cause rather than the wrapper, or every unreachable turn reads as an ordinary failure.
    // Carries a real cause code: the wrapper is what is under test, and a fixture without one now
    // passes for the wrong reason — it would be refused whether the unwrapping worked or not.
    const cause = new TypeError('fetch failed');
    (cause as Error & { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    const wrapped = new OpencodeTurnFailed('ses_x', cause);

    expect(neverConnected(wrapped)).toBe(true);
  });

  it('refuses an abort, because a cancelled turn is a person’s decision and not the machine’s fault', () => {
    // A cancelled or timed-out turn rejects the same fetch. `neverReachedModel` already refuses both,
    // so this is belt and braces — but it keeps the reason here rather than resting on a guard two
    // modules away.
    const abort = new DOMException('This operation was aborted', 'AbortError');

    expect(neverConnected(abort)).toBe(false);
  });
});

// THE CASE THAT NEARLY WENT IN WRONG. Measured, not reasoned about: a server that accepts a request and
// does not answer makes Node's fetch throw `TypeError: fetch failed` after 300862ms with
// `cause.code = UND_ERR_HEADERS_TIMEOUT`. That is the SAME surface shape as a refused connection, and a
// predicate that matched TypeError alone called it "never reached a model".
//
// It is not. The request was sent; the model may have been working for five minutes and spending tokens
// the whole time. Worse, classifying it as the machine's fault stops it burning an attempt — so a card
// that times out every time would retry for ever and never reach a person, which is the one direction
// `fault.ts` says this must never be wrong in.
//
// This is exactly what the calculator project hit on 2026-08-16: every first run against a free model
// died at 5m01s, the retry succeeded, and each failure cost an attempt.
describe('a slow server is not an absent one', () => {
  const undiciError = (code: string, name: string): TypeError => {
    const err = new TypeError('fetch failed');
    (err as Error & { cause?: unknown }).cause = Object.assign(new Error(name), { code, name });
    return err;
  };

  it('refuses a headers timeout: the request WAS sent', () => {
    expect(neverConnected(undiciError('UND_ERR_HEADERS_TIMEOUT', 'HeadersTimeoutError'))).toBe(false);
  });

  it('refuses a body timeout, for the same reason', () => {
    expect(neverConnected(undiciError('UND_ERR_BODY_TIMEOUT', 'BodyTimeoutError'))).toBe(false);
  });

  it('refuses a reset connection: it was established, so something may have crossed it', () => {
    expect(neverConnected(undiciError('ECONNRESET', 'Error'))).toBe(false);
  });

  it('still accepts the failures that mean nothing was ever sent', () => {
    // Connection-establishment errors only. Each of these is a measurement that no byte left this
    // process: there was nothing to send it over.
    expect(neverConnected(undiciError('ECONNREFUSED', 'Error'))).toBe(true);
    expect(neverConnected(undiciError('ENOTFOUND', 'Error'))).toBe(true);
    expect(neverConnected(undiciError('EHOSTUNREACH', 'Error'))).toBe(true);
    expect(neverConnected(undiciError('UND_ERR_CONNECT_TIMEOUT', 'ConnectTimeoutError'))).toBe(true);
  });

  it('refuses a TypeError with no cause at all, rather than guessing', () => {
    // A bug of ours throwing a bare TypeError must not be reported as a dead network — an unclassified
    // failure costs one attempt, a wrongly-classified one costs the cap.
    expect(neverConnected(new TypeError('fetch failed'))).toBe(false);
  });
});
