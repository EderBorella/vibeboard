import { describe, expect, it } from 'vitest';
import type { AutopilotConfig } from '../src/core/autopilot.js';
import { isLastOpenFeature } from '../src/core/last-feature.js';
import type { Card } from '../src/core/types.js';

// WHETHER THE SMOKE COMMAND MAY REFUSE THIS FEATURE'S CLOSE. Written from a greenfield run in which three
// features in a row stalled on a command none of them could have made pass — it spawned a file a LATER
// feature owned.

const ap = {
  terminal: { features: ['done'], product: ['done'], engineering: ['done'] },
  blockedColumn: 'blocked',
} as unknown as AutopilotConfig;

const F = (id: string, columnSlug: string): Card =>
  ({ id, board: 'features', columnSlug, title: id, links: [], tags: [], order: 10 }) as unknown as Card;

describe('isLastOpenFeature', () => {
  it('is false while another feature is still in backlog', () => {
    const me = F('F-002', 'in-progress');
    expect(isLastOpenFeature(ap, [me, F('F-001', 'done'), F('F-003', 'backlog')], me)).toBe(false);
  });

  it('is true when every other feature is done', () => {
    const me = F('F-004', 'in-progress');
    expect(isLastOpenFeature(ap, [me, F('F-001', 'done'), F('F-002', 'done')], me)).toBe(true);
  });

  // A FEATURE HAS NO BLOCKED COLUMN — `BLOCKED_BOARDS` is product and engineering. The first version of this
  // test assumed otherwise and failed, which is how the premise was found to be wrong rather than the code.
  it('treats a feature still in backlog as outstanding', () => {
    const me = F('F-002', 'in-progress');
    expect(isLastOpenFeature(ap, [me, F('F-001', 'done'), F('F-007', 'backlog')], me)).toBe(false);
  });

  it('is true for the only feature on the board', () => {
    const me = F('F-001', 'in-progress');
    expect(isLastOpenFeature(ap, [me], me)).toBe(true);
  });
});
