// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelOption } from '../web/src/api.js';
import { fmtCtx, fmtPrice, loadFavs, providerOf, saveFavs } from '../web/src/components/model-format.js';

const model = (over: Partial<ModelOption>): ModelOption => ({ id: 'x/y', free: false, ...over });

describe('fmtCtx', () => {
  it.each([
    [undefined, ''],
    [0, ''],
    [1, '1'],
    [999, '999'],
    [1000, '1K'],
    [1500, '2K'], // rounded, not truncated
    [200_000, '200K'],
    [999_999, '1000K'],
    [1_000_000, '1M'], // a whole million drops the decimal
    [1_500_000, '1.5M'], // a fractional one keeps it
    [2_000_000, '2M'],
    [1_048_576, '1.0M'],
  ])('formats %p as %p', (n, expected) => {
    expect(fmtCtx(n)).toBe(expected);
  });
});

describe('fmtPrice', () => {
  it.each([
    [{ free: true, promptPerM: 5 }, 'Free'], // free wins over any price
    [{ free: true }, 'Free'],
    [{ free: false }, ''], // no price known
    [{ free: false, promptPerM: 0.14, completionPerM: 0.28 }, '$0.14 / $0.28'],
    [{ free: false, promptPerM: 3 }, '$3 / $0'], // missing completion reads as zero
    [{ free: false, promptPerM: 0, completionPerM: 0 }, '$0 / $0'],
  ])('formats %o as %p', (over, expected) => {
    expect(fmtPrice(model(over))).toBe(expected);
  });
});

describe('providerOf', () => {
  it.each([
    ['opus', 'claude'], // claude aliases carry no prefix
    ['sonnet', 'claude'],
    ['opencode/deepseek-v4', 'opencode'],
    ['openrouter/some/model:free', 'openrouter'],
    ['/leading', ''],
  ])('reads %p as %p', (id, expected) => {
    expect(providerOf(id)).toBe(expected);
  });
});

describe('favourites storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a set', () => {
    saveFavs(new Set(['a', 'b']));
    expect([...loadFavs()].sort()).toEqual(['a', 'b']);
  });

  it('starts empty when nothing is stored', () => {
    expect(loadFavs().size).toBe(0);
  });

  it.each(['not json', '{}', 'null', '42'])('recovers from the stored value %p', (raw) => {
    localStorage.setItem('vb-fav-models', raw);
    expect(loadFavs().size).toBe(0);
  });

  it('reads back what a previous session wrote under the same key', () => {
    localStorage.setItem('vb-fav-models', JSON.stringify(['kept']));
    expect([...loadFavs()]).toEqual(['kept']);
  });
});
