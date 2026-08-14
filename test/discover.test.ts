import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_DIR, CONFIG_FILE } from '../src/core/layout.js';
import { discoverProjects } from '../src/server/boards/discover.js';
import { scaffoldProject } from '../src/store/project/scaffold.js';
import { tempDir } from './helpers.js';

describe('discoverProjects', () => {
  it('finds scaffolded projects in immediate subdirs, sorted by name, ignoring non-projects', async () => {
    const root = await tempDir();
    await scaffoldProject(join(root, 'zeta'), { name: 'Zeta', mode: 'greenfield', today: '2026-07-23' });
    await scaffoldProject(join(root, 'alpha'), { name: 'Alpha', mode: 'greenfield', today: '2026-07-23' });
    await mkdir(join(root, 'not-a-project'), { recursive: true });
    await writeFile(join(root, 'loose-file.txt'), 'x');

    const refs = await discoverProjects(root);
    expect(refs.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
    expect(refs[0].path).toBe(join(root, 'alpha'));
  });

  it('returns empty array for a nonexistent root', async () => {
    expect(await discoverProjects('/no/such/dir/vb')).toEqual([]);
  });
});

describe('discoverProjects skips and ordering', () => {
  // A valid project in a place the scan must refuse to look.
  const plant = async (root: string, dir: string, name: string): Promise<void> => {
    await mkdir(join(root, dir), { recursive: true });
    await scaffoldProject(join(root, dir), { name, mode: 'brownfield', today: '2026-07-25' });
  };

  it.each(['.hidden', '.config', 'node_modules'])('ignores a project inside %s', async (dir) => {
    const root = await tempDir();
    await plant(root, dir, 'Should Not Appear');
    await plant(root, 'visible', 'Visible');
    expect((await discoverProjects(root)).map((p) => p.name)).toEqual(['Visible']);
  });

  it('orders by project name, not by directory name', async () => {
    const root = await tempDir();
    // Directory order and name order deliberately disagree.
    await plant(root, 'aaa-dir', 'Zebra');
    await plant(root, 'zzz-dir', 'Alpha');
    expect((await discoverProjects(root)).map((p) => p.name)).toEqual(['Alpha', 'Zebra']);
  });

  it('skips a directory whose config exists but cannot be parsed', async () => {
    const root = await tempDir();
    await plant(root, 'good', 'Good');
    await mkdir(join(root, 'broken', CONFIG_DIR), { recursive: true });
    await writeFile(join(root, 'broken', CONFIG_DIR, CONFIG_FILE), '{{{ not yaml', 'utf8');
    expect((await discoverProjects(root)).map((p) => p.name)).toEqual(['Good']);
  });
});
