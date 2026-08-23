import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKENDS, backendLabel, fmtK, relTime } from '../web/src/organisms/copilot/format.js';

afterEach(() => vi.useRealTimers());

describe('backendLabel', () => {
  it.each([
    ['claude-code', 'Claude'],
    ['opencode', 'OpenCode'],
    ['something-else', 'something-else'], // unknown falls back to the raw id
    ['', ''],
  ])('labels %p as %p', (id, expected) => {
    expect(backendLabel(id)).toBe(expected);
  });

  it('offers exactly the two backends the dock renders', () => {
    expect(BACKENDS).toEqual([
      { value: 'claude-code', label: 'Claude' },
      { value: 'opencode', label: 'OpenCode' },
    ]);
  });
});

// The money formatter that used to live here is gone: the dock and the runs pane render the same number
// and rounded it to different places, so both now go through `formatCost` — see test/format.test.ts.

describe('fmtK', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1.0k'],
    [1500, '1.5k'],
    [12_345, '12.3k'],
    [1_000_000, '1000.0k'],
  ])('formats %p as %p', (n, expected) => {
    expect(fmtK(n)).toBe(expected);
  });
});

describe('relTime', () => {
  const at = (iso: string, now: string): string => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    return relTime(iso);
  };

  it.each([
    ['2026-07-25T12:00:00Z', '2026-07-25T12:00:00Z', 'just now'],
    ['2026-07-25T12:00:00Z', '2026-07-25T12:00:44Z', 'just now'], // under the 45s boundary
    ['2026-07-25T12:00:00Z', '2026-07-25T12:00:45Z', '1m'], // and at it
    ['2026-07-25T12:00:00Z', '2026-07-25T12:30:00Z', '30m'],
    ['2026-07-25T12:00:00Z', '2026-07-25T12:59:00Z', '59m'], // just under the hour boundary
    ['2026-07-25T12:00:00Z', '2026-07-25T13:00:00Z', '1h'], // and exactly on it
    ['2026-07-25T12:00:00Z', '2026-07-25T13:29:00Z', '1h'], // 89m rounds to 1h
    ['2026-07-25T12:00:00Z', '2026-07-26T09:00:00Z', '21h'],
    ['2026-07-25T12:00:00Z', '2026-07-26T11:00:00Z', '23h'], // just under the day boundary
    ['2026-07-25T12:00:00Z', '2026-07-26T12:00:00Z', '1d'], // and exactly on it
    ['2026-07-25T12:00:00Z', '2026-07-28T12:00:00Z', '3d'],
  ])('renders %p seen at %p as %p', (iso, now, expected) => {
    expect(at(iso, now)).toBe(expected);
  });

  it('clamps a future timestamp to "just now" rather than showing a negative age', () => {
    expect(at('2026-07-25T12:05:00Z', '2026-07-25T12:00:00Z')).toBe('just now');
  });

  it.each(['', 'not a date', 'yesterday'])('returns empty for the unparseable %p', (iso) => {
    expect(relTime(iso)).toBe('');
  });
});
