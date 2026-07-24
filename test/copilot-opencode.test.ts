import { describe, it, expect } from 'vitest';
import { parseOpencodeLine } from '../src/server/copilot-opencode.js';

const SID = 'ses_06e76951affeypl3iLUT8EFVgD';
const TEXT = JSON.stringify({ type: 'text', sessionID: SID, part: { id: 'p1', type: 'text', text: '1\n2\n3' } });
const STEP_START = JSON.stringify({ type: 'step_start', sessionID: SID, part: { type: 'step-start' } });
const STEP_FINISH = JSON.stringify({
  type: 'step_finish', sessionID: SID,
  part: { type: 'step-finish', reason: 'stop', cost: 0.0123, tokens: { input: 11228, output: 2, reasoning: 11, cache: { read: 500, write: 100 } } },
});

describe('parseOpencodeLine', () => {
  it('maps a text part to a text event and carries the session id', () => {
    expect(parseOpencodeLine(TEXT)).toEqual({ events: [{ kind: 'text', text: '1\n2\n3' }], sessionId: SID });
  });

  it('ignores step_start but keeps the session id', () => {
    expect(parseOpencodeLine(STEP_START)).toEqual({ events: [], sessionId: SID });
  });

  it('maps step_finish to usage (input+cache) + result (cost)', () => {
    const { events, sessionId } = parseOpencodeLine(STEP_FINISH);
    expect(sessionId).toBe(SID);
    expect(events[0]).toEqual({ kind: 'usage', contextTokens: 11228 + 500 + 100 });
    expect(events[1]).toMatchObject({ kind: 'result', sessionId: SID });
    const result = events[1];
    if (result.kind !== 'result') throw new Error('expected result');
    expect(result.stats.costUsd).toBe(0.0123);
    expect(result.stats.contextTokens).toBe(11228 + 500 + 100);
    expect(result.stats.outputTokens).toBe(2);
  });

  it('returns no events for malformed lines', () => {
    expect(parseOpencodeLine('not json')).toEqual({ events: [] });
  });
});
