import { describe, it, expect } from 'vitest';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { readConfig } from '../src/core/config.js';
import { readBoard } from '../src/core/board.js';

const TODAY = '2026-07-23';

describe('scaffoldProject', () => {
  it('greenfield: writes config, folders, docs, sample cards, and a fresh CLAUDE.md', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'greenfield', today: TODAY });

    const config = await readConfig(root);
    expect(config.name).toBe('Demo');
    await expect(access(join(root, 'product', 'archive'))).resolves.toBeUndefined();
    await expect(access(join(root, 'engineering', 'archive'))).resolves.toBeUndefined();
    await expect(access(join(root, 'VIBEBOARD.md'))).resolves.toBeUndefined();

    const claude = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('VIBEBOARD.md');

    const product = await readBoard(root, 'product', config);
    const engineering = await readBoard(root, 'engineering', config);
    expect(product.length).toBeGreaterThan(0);
    expect(engineering[0].links).toContain(product[0].id);
  });

  it('brownfield: preserves an existing CLAUDE.md, appending only a pointer', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'CLAUDE.md'), '# Existing Project\n\nImportant rules here.\n', 'utf8');
    await scaffoldProject(root, { name: 'Adopted', mode: 'brownfield', today: TODAY });

    const claude = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('Important rules here.');
    expect(claude).toContain('VIBEBOARD.md');
    await expect(access(join(root, 'VIBEBOARD.md'))).resolves.toBeUndefined();
  });

  it('brownfield: adds the cockpit but no sample cards, leaving existing files alone', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'README.md'), '# My real repo\n', 'utf8');
    await scaffoldProject(root, { name: 'Adopted', mode: 'brownfield', today: TODAY });

    const config = await readConfig(root);
    for (const board of ['features', 'product', 'engineering'] as const) {
      expect(await readBoard(root, board, config), board).toEqual([]); // no "delete me" cards
    }
    // the cockpit itself is there, and the pre-existing file is untouched
    await expect(access(join(root, 'product', 'todo'))).resolves.toBeUndefined();
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# My real repo\n');
  });

  it('brownfield: does not duplicate the pointer on re-run', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'CLAUDE.md'), '# X\n', 'utf8');
    await scaffoldProject(root, { name: 'A', mode: 'brownfield', today: TODAY });
    await scaffoldProject(root, { name: 'A', mode: 'brownfield', today: TODAY });
    const claude = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    expect(claude.match(/VIBEBOARD\.md/g)?.length).toBe(1);
  });
});
