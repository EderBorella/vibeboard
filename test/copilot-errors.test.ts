// THE ERROR TABLE, AND THE PAYLOAD THAT PROVOKED IT.
//
// Pure, so no server and no backend: the whole subject is "given this string, what should a person be
// told and is Retry worth offering". The real 429 from 2026-08-31 is the first case, written out
// exactly as it arrived rather than paraphrased — a sanitised fixture would not have the nested JSON
// that made the original unreadable, and matching prose that never occurs proves nothing.
import { describe, expect, it } from 'vitest';
import { classifyCopilotError } from '../src/core/copilot-errors.js';

// Verbatim, from the owner's chat.
const REAL_429 =
  'UnknownError: {"code":429,"message":"Provider returned error","metadata":{"error_type":"rate_limit_exceeded"}}';

describe('classifyCopilotError', () => {
  it('reads the real 429 as a rate limit and offers a retry', () => {
    const info = classifyCopilotError(REAL_429);
    expect(info.kind).toBe('rate_limit');
    expect(info.retryable).toBe(true);
    expect(info.sentence).toMatch(/rate-limiting this model/);
  });

  it('keeps the raw payload after the sentence rather than discarding it', () => {
    // The remedy is for acting on; the payload is for reporting a bug with. Dropping it would make an
    // unrecognised failure undiagnosable, which is the opposite of the problem being fixed.
    expect(classifyCopilotError(REAL_429).sentence).toContain('rate_limit_exceeded');
  });

  // THE ROW THAT MATTERS MOST, because it is the one where a button would lie. A Retry on expired
  // credentials fails identically every time and teaches people the control does nothing.
  it('refuses to offer a retry for an auth failure', () => {
    for (const raw of ['401 Unauthorized', 'invalid api key', 'Authentication failed']) {
      const info = classifyCopilotError(raw);
      expect(info.kind, raw).toBe('auth');
      expect(info.retryable, raw).toBe(false);
    }
  });

  // ORDER, ASSERTED. A 401 returned BY a provider matches the provider row's `\b5\d{2}\b`? No — but it
  // does contain the word "provider", and an alphabetical or careless reordering would let the
  // provider row claim it and flip `retryable` to true. This is the case that pins the precedence.
  it('calls a provider 401 an auth failure, not a provider fault', () => {
    const info = classifyCopilotError('Provider returned error: 401 unauthorized');
    expect(info.kind).toBe('auth');
    expect(info.retryable).toBe(false);
  });

  it.each([
    ['timed out waiting for the model', 'timeout'],
    ['ECONNREFUSED 127.0.0.1:4096', 'provider'],
    ['503 Service Unavailable', 'provider'],
    ['fetch failed', 'provider'],
  ])('reads %s as %s', (raw, kind) => {
    expect(classifyCopilotError(raw).kind).toBe(kind);
  });

  // UNKNOWN IS RETRYABLE, and it is a decision rather than a fallback: the failures we cannot name are
  // dominated by transient ones, and the two mistakes do not cost the same. A Retry that fails again
  // wastes a click; a missing Retry on a passing fault sends someone to restart the app.
  it('offers a retry for a failure it cannot name', () => {
    const info = classifyCopilotError('something nobody has seen before');
    expect(info.kind).toBe('unknown');
    expect(info.retryable).toBe(true);
  });

  it('clips a payload long enough to push the remedy off the screen', () => {
    const info = classifyCopilotError(`429 ${'x'.repeat(5000)}`);
    expect(info.sentence.length).toBeLessThan(400);
    expect(info.sentence).toContain('…');
  });
});
