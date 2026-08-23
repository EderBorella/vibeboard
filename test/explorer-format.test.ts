import { describe, expect, it } from 'vitest';
import { formatBytes } from '../web/src/organisms/explorer/format.js';

describe('formatBytes', () => {
  it('is empty for a size that was never reported', () => {
    // Directories and links carry no size; the column must be blank, not "0 B" or "undefined".
    expect(formatBytes(undefined)).toBe('');
  });

  it('says nothing clever about an empty file', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('counts bytes up to a kilobyte', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('switches unit exactly at the boundary', () => {
    // The `<` boundaries are the only place the unit choice can be off by one.
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('keeps one decimal below ten and drops it above', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 9.94)).toBe('9.9 KB');
    expect(formatBytes(1024 * 12.4)).toBe('12 KB');
    expect(formatBytes(1024 * 1024 * 3.45)).toBe('3.5 MB');
    expect(formatBytes(1024 * 1024 * 40)).toBe('40 MB');
  });
});
