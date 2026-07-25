import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaffoldProject } from '../src/core/scaffold.js';
import { discoverProjects } from '../src/server/discover.js';
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
