import { describe, expect, it } from 'vitest';
import { slugify } from '../src/core/slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('In Progress')).toBe('in-progress');
  });
  it('handles single words', () => {
    expect(slugify('Backlog')).toBe('backlog');
  });
  it('trims and collapses non-alphanumerics', () => {
    expect(slugify('  To Do! ')).toBe('to-do');
  });
});
