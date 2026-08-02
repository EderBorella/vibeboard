import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { Route } from '../src/core/autopilot.js';
import { configPath } from '../src/core/config.js';
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
