import { describe, expect, it } from 'vitest';
import type { AutopilotConfig } from '../src/core/autopilot.js';
import { coveredBy } from '../src/core/covered.js';
import type { Card } from '../src/core/types.js';

// A CLAIM THAT THE WORK IS ALREADY DONE, AND WHETHER IT CHECKS OUT. `decision 43` refuses an unverifiable
// claim, and it is right to; this is the verifiable version of the same sentence.

const ap = {
  terminal: { features: ['done'], product: ['done'], engineering: ['done'] },
  blockedColumn: 'blocked',
} as unknown as AutopilotConfig;

const C = (id: string, board: string, columnSlug: string): Card =>
  ({ id, board, columnSlug, title: id, links: [], tags: [], order: 10 }) as unknown as Card;

const board = [
  C('P-030', 'product', 'done'),
  C('E-031', 'engineering', 'done'),
  C('E-040', 'engineering', 'blocked'),
  C('P-050', 'product', 'in-progress'),
];

describe('coveredBy', () => {
  it('accepts a claim whose every cited card exists and is done', () => {
    expect(coveredBy(ap, board, ['P-030', 'E-031'])).toBe(true);
  });

  it('refuses a card id that is not on the board', () => {
    // The whole point: an invented citation must leave the run no better off than saying nothing.
    expect(coveredBy(ap, board, ['P-030', 'E-999'])).toBe(false);
  });

  it('refuses a cited card that is still open', () => {
    expect(coveredBy(ap, board, ['P-030', 'P-050'])).toBe(false);
  });

  // BLOCKED COUNTS AS SETTLED, which is decision 45's argument unchanged: a blocked card has had every
  // attempt it is allowed and will not land on its own. Work that stopped there is still work that
  // happened, and refusing it would leave the citing card stuck for a reason nobody can clear.
  it('accepts a cited card that is blocked, because blocked is settled', () => {
    expect(coveredBy(ap, board, ['E-040'])).toBe(true);
  });

  // `[].every()` IS TRUE, so an empty list would advance a card having cited nothing at all — the
  // vacuous pass this codebase has been bitten by before.
  it('refuses an empty claim', () => {
    expect(coveredBy(ap, board, [])).toBe(false);
  });

  it('refuses a claim citing an archived card', () => {
    const archived = [...board, C('P-060', 'product', 'archive')];
    expect(coveredBy(ap, archived, ['P-060'])).toBe(false);
  });
});
