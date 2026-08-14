import { describe, expect, it } from 'vitest';
import {
  applyRouteRenames,
  DEFAULT_AUTOPILOT,
  isBlockedColumn,
  isTerminalColumn,
} from '../src/core/autopilot.js';
import { defaultConfig } from '../src/store/project/config.js';

describe('the autopilot block', () => {
  it('treats terminal and blocked as explicit facts, never as the absence of a route', () => {
    expect(isTerminalColumn(DEFAULT_AUTOPILOT, 'engineering', 'done')).toBe(true);
    expect(isTerminalColumn(DEFAULT_AUTOPILOT, 'engineering', 'review')).toBe(false);
    expect(isBlockedColumn(DEFAULT_AUTOPILOT, 'engineering', 'blocked')).toBe(true);
  });

  // DECISION 45's 2026-08-13 CORRECTION. A story sits among siblings exactly as a task does, so one that
  // cannot be broken down is left on the board and its feature carries on with the next story. A FEATURE
  // has no sibling to carry on with, so it still stops the loop and names itself — and that asymmetry is
  // the whole rule, which is why both halves are asserted here rather than only the new one.
  it('answers for product as well as engineering, and never for features', () => {
    expect(isBlockedColumn(DEFAULT_AUTOPILOT, 'product', 'blocked')).toBe(true);
    expect(isBlockedColumn(DEFAULT_AUTOPILOT, 'features', 'blocked')).toBe(false);
    // Still the column the config NAMES, on either board: a slug that is not it is an ordinary column.
    expect(isBlockedColumn(DEFAULT_AUTOPILOT, 'product', 'in-progress')).toBe(false);
  });

  // A COLUMN IS A FOLDER, so a board the machine may block a card on must actually have the column — or
  // the stamp writes the card where `readBoard` does not look. Asserted against the scaffolder's own
  // defaults, and features is asserted NOT to have it: an unused column on a person's board is clutter
  // that invites them to drag a feature into a state nothing reads.
  it('ships the column on every board it may be stamped on, and on no other', () => {
    const boards = defaultConfig('T').boards;
    expect(boards.product.columns).toContain('Blocked');
    expect(boards.engineering.columns).toContain('Blocked');
    expect(boards.features.columns).not.toContain('Blocked');
    // NOT LAST on either: the closing column is the final one (server/boards/cards-routes.ts), so a Blocked column
    // appended after Done would resolve a blocked card's runs and leave Done closing nothing.
    expect(boards.product.columns.at(-1)).toBe('Done');
    expect(boards.engineering.columns.at(-1)).toBe('Done');
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
