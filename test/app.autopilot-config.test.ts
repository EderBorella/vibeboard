import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { Route } from '../src/core/autopilot.js';
import { configPath } from '../src/core/config.js';
import { boardRel } from '../src/core/layout.js';
import type { ProjectConfig } from '../src/core/types.js';
import { openTestProject } from './helpers.js';

// The routing table names columns by slug on both sides, and a column IS a folder. Renaming one
// moves the folder; a table left behind deletes a route in silence and the cards in it go quiet.

const ENGINEERING = ['Backlog', 'In Progress', 'Review', 'Blocked', 'Done'];

const readDisk = async (root: string): Promise<ProjectConfig> =>
  parse(await readFile(configPath(root), 'utf8')) as ProjectConfig;

describe('PATCH /api/config and the routing table', () => {
  it('carries the routes through a column rename, so a renamed column keeps its skill', async () => {
    const { app, root } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { boards: { engineering: { columns: ['Backlog', 'In Progress', 'QA', 'Blocked', 'Done'] } } },
    });
    expect(res.statusCode).toBe(200);
    const routes: Route[] = res.json().autopilot.routes;
    expect(routes.find((r) => r.column === 'qa')).toMatchObject({
      board: 'engineering',
      skill: 'test',
      next: 'done',
    });
    // The other side of the rename: backlog advanced into `review`, which no longer exists.
    expect(routes.find((r) => r.board === 'engineering' && r.column === 'backlog')?.next).toBe('qa');
    // Persisted, not merely returned: a reply nobody wrote down would keep working until restart.
    expect((await readDisk(root)).autopilot?.routes.some((r) => r.column === 'qa')).toBe(true);
  });

  it('refuses a column edit that would leave a column with nothing to do', async () => {
    const { app } = await openTestProject({ name: 'A', mode: 'brownfield' });
    // Adding a column is the easy way to open a hole: nothing routes to or from it.
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: {
        boards: {
          engineering: { columns: ['Backlog', 'In Progress', 'Review', 'Blocked', 'Staging', 'Done'] },
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('"staging" is neither routed, terminal nor blocked');
    // Not half-applied: the config still has the old columns.
    const config = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(config.boards.engineering.columns).toEqual(ENGINEERING);
  });

  // The Settings modal sends all three boards on every save, so a refusal has to be able to arrive
  // AFTER another board's folders would have been renamed. Reading config.yaml cannot see this —
  // it is written last, so it is always unchanged on a refusal — which is why this asserts on the
  // folders. Before the plan/apply split it found `features/planned/` on disk holding F-001, a card
  // invisible to the board with its id released for reuse.
  it('moves no folder when a later board in the same patch is refused', async () => {
    const { app, root } = await openTestProject({ name: 'A' });
    const before = (await readdir(join(root, boardRel('features')))).sort();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: {
        boards: {
          features: { columns: ['Backlog', 'Planned', 'In Progress', 'Done'] }, // Todo -> Planned
          engineering: { columns: [...ENGINEERING.slice(0, 4), 'Staging', 'Done'] }, // unroutable
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect((await readdir(join(root, boardRel('features')))).sort()).toEqual(before);
    expect(before).not.toContain('planned');
    // And the cards are still where the board looks for them.
    const state = (await app.inject({ method: 'GET', url: '/api/state' })).json();
    expect(state.snapshot.boards.features.length).toBeGreaterThan(0);
  });

  // Same shape, refused by the folders themselves rather than by the routing table.
  it('moves no folder when a later board is refused for holding cards', async () => {
    const { app, root } = await openTestProject({ name: 'A' });
    const before = (await readdir(join(root, boardRel('features')))).sort();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: {
        boards: {
          features: { columns: ['Backlog', 'Planned', 'In Progress', 'Done'] },
          // Backlog holds the scaffold's engineering sample card, so removing it is refused by the
          // folders — before the routing table gets a say, which is the ordering under test.
          engineering: { columns: ['In Progress', 'Review', 'Blocked', 'Done'] },
        },
      },
    });

    expect(res.statusCode).toBe(409);
    expect((await readdir(join(root, boardRel('features')))).sort()).toEqual(before);
  });

  it('reports a hand-edited block that is not shaped like one, rather than failing with a 500', async () => {
    const { app } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { autopilot: { maxIterations: 10 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('autopilot.routes must be a list of routes.');
  });

  it('refuses a hand-edited routing table that names a column the board does not have', async () => {
    const { app } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const current = (await app.inject({ method: 'GET', url: '/api/config' })).json() as ProjectConfig;
    const autopilot = structuredClone(current.autopilot);
    if (!autopilot) throw new Error('a project scaffolded today has an autopilot block');
    autopilot.routes[0] = { ...autopilot.routes[0], next: 'shipped' };
    const res = await app.inject({ method: 'PATCH', url: '/api/config', payload: { autopilot } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('advances to "shipped"');
  });

  // Migration is deferred deliberately, so a project written before the lifecycle existed keeps
  // working exactly as it did — no new refusals, and no silent backfill either.
  it('leaves a project with no autopilot block alone', async () => {
    const { app, root, session } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const config = await readDisk(root);
    delete config.autopilot;
    await writeFile(configPath(root), stringify(config), 'utf8');
    await session.reloadConfig();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: {
        boards: {
          engineering: { columns: ['Backlog', 'In Progress', 'Review', 'Blocked', 'Staging', 'Done'] },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().autopilot).toBeUndefined();
  });
});
