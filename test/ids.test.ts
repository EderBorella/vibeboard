import { describe, expect, it } from 'vitest';
import { idPrefix, nextId } from '../src/core/ids.js';

describe('ids', () => {
  it('maps boards to prefixes', () => {
    expect(idPrefix('product')).toBe('P');
    expect(idPrefix('engineering')).toBe('E');
  });
  it('returns the first id when none exist', () => {
    expect(nextId('product', [], 3)).toBe('P-001');
  });
  it('increments past the max, ignoring gaps and other prefixes', () => {
    expect(nextId('product', ['P-001', 'P-003', 'E-009'], 3)).toBe('P-004');
  });
  it('respects the padding width', () => {
    expect(nextId('engineering', ['E-099'], 3)).toBe('E-100');
  });
});
