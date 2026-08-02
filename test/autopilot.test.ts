import { describe, expect, it } from 'vitest';
import {
  applyRouteRenames,
  DEFAULT_AUTOPILOT,
  isBlockedColumn,
  isTerminalColumn,
  routeFor,
} from '../src/core/autopilot.js';
import { defaultConfig } from '../src/core/config.js';

describe('the autopilot routing table', () => {
  it('routes a card by (board, column) and names where it goes next', () => {
    const route = routeFor(DEFAULT_AUTOPILOT, 'engineering', 'backlog');
    expect(route).toEqual({
      board: 'engineering',
      column: 'backlog',
      skill: 'implement',
      verify: 'gates',
      next: 'review',
    });
    // A lookup, not a judgement: an unrouted column answers "nothing runs here".
    expect(routeFor(DEFAULT_AUTOPILOT, 'engineering', 'done')).toBeUndefined();
  });

  it('treats terminal and blocked as explicit facts, never as the absence of a route', () => {
    expect(isTerminalColumn(DEFAULT_AUTOPILOT, 'engineering', 'done')).toBe(true);
    expect(isTerminalColumn(DEFAULT_AUTOPILOT, 'engineering', 'review')).toBe(false);
    // Blocked is engineering's alone — a product card at its attempt cap stops the run instead.
    expect(isBlockedColumn(DEFAULT_AUTOPILOT, 'engineering', 'blocked')).toBe(true);
    expect(isBlockedColumn(DEFAULT_AUTOPILOT, 'product', 'blocked')).toBe(false);
  });

  it('a new project ships the block, so its routes and its columns agree from the start', () => {
    expect(defaultConfig('T').autopilot).toEqual(DEFAULT_AUTOPILOT);
  });

  // Every project's config is mutated in place by the ensure* helpers and written back, so a shared
  // reference would let one project's edit reach the next project's defaults in the same process.
  it('hands each project its own copy of the defaults', () => {
    const config = defaultConfig('T');
    expect(config.autopilot).not.toBe(DEFAULT_AUTOPILOT);
    config.autopilot!.routes.pop();
    expect(defaultConfig('U').autopilot!.routes).toHaveLength(DEFAULT_AUTOPILOT.routes.length);
  });

  it('carries routes through a column rename, on both the source and the destination side', () => {
    const renamed = applyRouteRenames(DEFAULT_AUTOPILOT, 'engineering', [{ from: 'review', to: 'qa' }]);
    expect(routeFor(renamed, 'engineering', 'qa')?.skill).toBe('test');
    expect(routeFor(renamed, 'engineering', 'review')).toBeUndefined();
    // `next` is a column too: renaming Review must not leave backlog pointing at a column that is gone.
    expect(routeFor(renamed, 'engineering', 'backlog')?.next).toBe('qa');
    // Another board's routes are untouched.
    expect(routeFor(renamed, 'product', 'backlog')?.next).toBe('todo');
  });

  it('renames the terminal and blocked columns of the board being renamed, and only that board', () => {
    const renamed = applyRouteRenames(DEFAULT_AUTOPILOT, 'engineering', [
      { from: 'done', to: 'shipped' },
      { from: 'blocked', to: 'stuck' },
    ]);
    expect(renamed.terminal.engineering).toEqual(['shipped']);
    expect(renamed.blockedColumn).toBe('stuck');
    expect(isTerminalColumn(renamed, 'engineering', 'done')).toBe(false);
    // The routes that advanced into `done` advance into its new name.
    expect(routeFor(renamed, 'engineering', 'review')?.next).toBe('shipped');
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

  it('renames the columns a rollup rule names, on both of its sides', () => {
    const renamed = applyRouteRenames(DEFAULT_AUTOPILOT, 'product', [
      { from: 'in-progress', to: 'building' },
      { from: 'done', to: 'shipped' },
    ]);
    const product = renamed.rollup.find((r) => r.board === 'product');
    expect(product).toMatchObject({ column: 'building', next: 'shipped' });
    // Board-scoped: the features rule keeps its own column, and keeps having no `next` at all —
    // an `eligible` rule that grew one would be claiming to move a card it only unlocks.
    const features = renamed.rollup.find((r) => r.board === 'features');
    expect(features).toMatchObject({ column: 'in-progress', action: 'eligible' });
    expect(features && 'next' in features).toBe(false);
  });

  it('returns the table unchanged when nothing was renamed', () => {
    expect(applyRouteRenames(DEFAULT_AUTOPILOT, 'engineering', [])).toBe(DEFAULT_AUTOPILOT);
  });
});
