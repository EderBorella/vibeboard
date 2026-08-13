import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { Route } from '../src/core/autopilot.js';
import { configPath, readConfig, writeConfig } from '../src/core/config.js';
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
          // Dropping Blocked leaves `blockedColumn` naming a column engineering does not have, which
          // is refused by the lifecycle check rather than by the folders — and refused AFTER features'
          // rename has been planned, which is the ordering this case exists for.
          engineering: { columns: ['Backlog', 'In Progress', 'Review', 'Done'] },
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

// Removing the block is removing the gate, and `mergeConfig` is a spread — so one request could
// switch off every check that keeps a card from being stranded.
describe('PATCH /api/config cannot delete the lifecycle', () => {
  it('refuses a patch that would remove the autopilot block', async () => {
    const { app, root } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const res = await app.inject({ method: 'PATCH', url: '/api/config', payload: { autopilot: null } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('would remove the autopilot block');
    // Still on disk, not merely still in memory.
    expect((await readDisk(root)).autopilot?.routes.length).toBeGreaterThan(0);
  });

  it('still refuses when the block is invalid — the way out is to fix it, not to delete it', async () => {
    const { app, root, session } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const config = await readDisk(root);
    // biome-ignore lint/suspicious/noExplicitAny: a hand-edited file can hold any shape
    (config as any).autopilot = { maxIterations: 10 };
    await writeFile(configPath(root), stringify(config), 'utf8');
    await session.reloadConfig();
    const res = await app.inject({ method: 'PATCH', url: '/api/config', payload: { autopilot: null } });
    expect(res.statusCode).toBe(400);
  });
});

// A pre-existing problem in the lifecycle is not the fault of a request that does not touch it. The
// cover check ran on every patch, and Settings sends `boards` on every save — so an invalid block
// meant no setting could be saved at all, and the refusal talked about columns while the user was
// changing their model.
describe('an invalid lifecycle does not lock the rest of Settings', () => {
  const breakBlock = async (root: string, session: { reloadConfig: () => Promise<unknown> }) => {
    const config = await readDisk(root);
    // Through `unknown`: a hand-edited file can hold any shape, which is the whole point of the test.
    (config as unknown as Record<string, unknown>).autopilot = { maxIterations: 10 };
    await writeFile(configPath(root), stringify(config), 'utf8');
    await session.reloadConfig();
  };

  it('saves a setting that has nothing to do with the lifecycle', async () => {
    const { app, root, session } = await openTestProject({ name: 'A', mode: 'brownfield' });
    await breakBlock(root, session);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { copilot: { backend: 'opencode', backends: {} }, keepChats: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().keepChats).toBe(7);
    // Persisted, and the broken block is left exactly as it was rather than quietly normalised.
    const onDisk = await readDisk(root);
    expect(onDisk.keepChats).toBe(7);
    expect(onDisk.autopilot).toEqual({ maxIterations: 10 });
  });

  it('still refuses the moment the patch touches columns', async () => {
    const { app, root, session } = await openTestProject({ name: 'A', mode: 'brownfield' });
    await breakBlock(root, session);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { boards: { engineering: { columns: [...ENGINEERING, 'Staging'] } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('autopilot.routes must be a list of routes.');
  });

  it('still refuses a patch that would remove the block, which touches it by definition', async () => {
    const { app } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const res = await app.inject({ method: 'PATCH', url: '/api/config', payload: { autopilot: null } });
    expect(res.statusCode).toBe(400);
  });
});

// The caps became editable from Settings in slice D, which made this class of refusal reachable from the
// UI for the first time: before it, the numbers were read-only and only a hand-edited YAML could be
// wrong. A refusal that talks about column routing to someone who cleared a cap box is the dead-end
// message the project's own rule forbids — and the same shape as the bug already recorded as fixed.
describe('refusing a cap, and saying the right thing about it', () => {
  // The whole block, with one cap replaced — which is what Settings sends: `{...config.autopilot,
  // ...editedCaps}`. Patching the caps alone would drop `routes` and be refused for a different reason,
  // and the test would then pass while proving nothing about the remedy.
  const patchCap = async (payload: Record<string, unknown>) => {
    const { app, session } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { autopilot: { ...session.config?.autopilot, ...payload } },
    });
    expect(res.statusCode).toBe(400);
    return res.json().error as string;
  };

  // `null` is what an emptied number box becomes on the wire: `Number('')` is NaN and JSON has no NaN.
  it.each([
    ['a cleared budget', { budgetUsd: null }],
    ['a cleared iteration cap', { maxIterations: null }],
    ['a negative budget', { budgetUsd: -5 }],
    ['a zero iteration cap', { maxIterations: 0 }],
  ])('answers %s without sending the user to the routing table', async (_label, payload) => {
    const error = await patchCap(payload);
    expect(error).not.toContain('every column is routed');
    expect(error).toContain('Settings');
  });

  // The other half: a real lifecycle problem must still carry the remedy that names the file, because
  // the block genuinely is not editable from the UI. The trigger used to be `routes: []`, which the
  // retired cover check refused; a board with no terminal column is the same class and still refused.
  it('still names config.yaml when the problem is the lifecycle rather than a cap', async () => {
    const error = await patchCap({ terminal: { features: [], product: ['done'], engineering: ['done'] } });
    expect(error).toContain('.vibeboard/config.yaml');
  });
});

// The regression slice C1's review found. Adding a required key to the autopilot block made every
// previously-valid config invalid, and the Settings modal always sends `boards` — so the cover check ran
// on every save and a project that predated the key could not change its miniature size, its model, or
// anything else. Exactly the class fixed on 2026-08-03 for a different key, through a new one.
describe('a project created before a key existed', () => {
  it('can still save an unrelated setting', async () => {
    const { app, root } = await openTestProject();
    const config = await readConfig(root);
    delete (config.autopilot as unknown as Record<string, unknown>).criticThreshold;
    await writeConfig(root, config);
    // Reopening is what upgrades it — the same path that backfills missing boards.
    const opened = await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect(opened.statusCode).toBe(200);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { boards: config.boards, miniatureChars: 99 },
    });
    expect(res.statusCode).toBe(200);
    expect((await readConfig(root)).miniatureChars).toBe(99);
  });

  it('has the key on disk afterwards, so the upgrade is durable rather than per-request', async () => {
    const { app, root } = await openTestProject();
    const config = await readConfig(root);
    delete (config.autopilot as unknown as Record<string, unknown>).criticThreshold;
    await writeConfig(root, config);
    await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect((await readConfig(root)).autopilot?.criticThreshold).toBe(0.6);
  });

  // The refusal still fires for a value that IS there and is wrong — the backfill covers absence only.
  it('is still refused when the key is present and invalid', async () => {
    const { app, root } = await openTestProject();
    const config = await readConfig(root);
    (config.autopilot as unknown as Record<string, unknown>).criticThreshold = 5;
    await writeConfig(root, config);
    await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { boards: config.boards, miniatureChars: 99 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/criticThreshold/);
  });
});
