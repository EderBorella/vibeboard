import { describe, expect, it } from 'vitest';
import {
  applyRouteRenames,
  DEFAULT_AUTOPILOT,
  isBlockedColumn,
  isTerminalColumn,
} from '../src/core/autopilot.js';
import { defaultConfig } from '../src/core/config.js';

describe('the autopilot block', () => {
  it('treats terminal and blocked as explicit facts, never as the absence of a route', () => {
    expect(isTerminalColumn(DEFAULT_AUTOPILOT, 'engineering', 'done')).toBe(true);
    expect(isTerminalColumn(DEFAULT_AUTOPILOT, 'engineering', 'review')).toBe(false);
    // Blocked is engineering's alone — a product card at its attempt cap stops the run instead.
    expect(isBlockedColumn(DEFAULT_AUTOPILOT, 'engineering', 'blocked')).toBe(true);
    expect(isBlockedColumn(DEFAULT_AUTOPILOT, 'product', 'blocked')).toBe(false);
  });

  it('a new project ships the block, so its terminal columns and its columns agree from the start', () => {
    expect(defaultConfig('T').autopilot).toEqual(DEFAULT_AUTOPILOT);
  });

  // Every project's config is mutated in place by the ensure* helpers and written back, so a shared
  // reference would let one project's edit reach the next project's defaults in the same process.
  it('hands each project its own copy of the defaults', () => {
    const config = defaultConfig('T');
    expect(config.autopilot).not.toBe(DEFAULT_AUTOPILOT);
    config.autopilot!.terminal.engineering.pop();
    expect(defaultConfig('U').autopilot!.terminal.engineering).toEqual(['done']);
  });

  it('renames the terminal and blocked columns of the board being renamed, and only that board', () => {
    const renamed = applyRouteRenames(DEFAULT_AUTOPILOT, 'engineering', [
      { from: 'done', to: 'shipped' },
      { from: 'blocked', to: 'stuck' },
    ]);
    expect(renamed.terminal.engineering).toEqual(['shipped']);
    expect(renamed.blockedColumn).toBe('stuck');
    expect(isTerminalColumn(renamed, 'engineering', 'done')).toBe(false);
    // The other boards still have a Done column of their own, and it is still where a card finishes.
    // A single flat list of slugs got this wrong: renaming engineering's Done un-terminalled theirs.
    expect(renamed.terminal.product).toEqual(['done']);
    expect(isTerminalColumn(renamed, 'features', 'done')).toBe(true);
  });

  it('does not touch the blocked column when some other board is renamed', () => {
    const renamed = applyRouteRenames(DEFAULT_AUTOPILOT, 'product', [{ from: 'todo', to: 'blocked' }]);
    expect(renamed.blockedColumn).toBe('blocked');
    expect(renamed.terminal.engineering).toEqual(['done']);
  });

  it('returns the table unchanged when nothing was renamed', () => {
    expect(applyRouteRenames(DEFAULT_AUTOPILOT, 'engineering', [])).toBe(DEFAULT_AUTOPILOT);
  });
});

describe('the critic threshold default', () => {
  // 0.6 because that is what OpenHands ships for the same mechanism — the only prior art this design
  // has for the number itself, rather than a figure we made up.
  it('is the number the prior art ships', () => {
    expect(DEFAULT_AUTOPILOT.criticThreshold).toBe(0.6);
  });
});
