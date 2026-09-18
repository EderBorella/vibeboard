import { describe, expect, it } from 'vitest';
import { BOX_KINDS, isBoxKind } from '../src/core/box-kinds.js';
import { defaultConfig } from '../src/store/project/config.js';

describe('the kind vocabulary', () => {
  it('is the three ruled categories, and nothing else answers to it', () => {
    expect(BOX_KINDS).toEqual(['web', 'game', 'research']);
    expect(isBoxKind('web')).toBe(true);
    expect(isBoxKind('webb')).toBe(false);
    expect(isBoxKind(undefined)).toBe(false);
  });

  it('a new project is explicitly web, and an old config stays without a block', () => {
    // New projects keep the behaviour every project had before kinds existed — the checkup can open a
    // page. Absence (an old project) means the same image, decided in imageForKind, not backfilled here.
    expect(defaultConfig('p').box).toEqual({ kind: 'web' });
  });
});
