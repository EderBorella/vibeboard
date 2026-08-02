import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foundationStatus, readGates, readSmokeCommand } from '../src/core/foundation.js';
import { FOUNDATION_DIR } from '../src/core/layout.js';
import { tempDir } from './helpers.js';

async function write(root: string, name: string, content: string): Promise<void> {
  await mkdir(join(root, FOUNDATION_DIR), { recursive: true });
  await writeFile(join(root, FOUNDATION_DIR, name), content, 'utf8');
}

describe('the foundation documents', () => {
  it('reports every missing document by name on a project that has none', async () => {
    const root = await tempDir();
    const status = await foundationStatus(root);
    expect(status.present).toEqual([]);
    expect(status.missing).toEqual(['STACK.md', 'CODE-QUALITY.md', 'TESTING.md', 'UX.md', 'DESIGN.md']);
    expect(status.ok).toBe(false);
  });

  it('reads the gates from CODE-QUALITY.md frontmatter', async () => {
    const root = await tempDir();
    await write(
      root,
      'CODE-QUALITY.md',
      '---\ngates:\n  - name: types\n    command: npm run typecheck\n  - name: tests\n    command: npm test\n---\nWhat these gates mean.\n',
    );
    expect(await readGates(root)).toEqual({
      ok: true,
      gates: [
        { name: 'types', command: 'npm run typecheck' },
        { name: 'tests', command: 'npm test' },
      ],
    });
  });

  // Fail closed, four ways. Each of these once meant "every card passes".
  it('fails when the file is missing, declares no gates, or declares one that cannot run', async () => {
    const root = await tempDir();
    expect(await readGates(root)).toEqual({
      ok: false,
      reason: 'foundation/CODE-QUALITY.md does not exist, so there are no gates to run.',
    });

    await write(root, 'CODE-QUALITY.md', '---\ngates: []\n---\nNothing yet.\n');
    expect(await readGates(root)).toEqual({
      ok: false,
      reason:
        'foundation/CODE-QUALITY.md declares no gates, and a card cannot pass a gate set that is empty.',
    });

    await write(root, 'CODE-QUALITY.md', '---\ngates:\n  - name: types\n---\n');
    expect(await readGates(root)).toEqual({
      ok: false,
      reason: 'foundation/CODE-QUALITY.md: the gate "types" has no command.',
    });

    await write(root, 'CODE-QUALITY.md', '---\ngates:\n  - command: npm test\n---\n');
    expect(await readGates(root)).toEqual({
      ok: false,
      reason: 'foundation/CODE-QUALITY.md: a gate has no name.',
    });
  });

  // A file with prose but no frontmatter is the likeliest hand-written mistake, and it must not read
  // as "no gates declared, carry on".
  it('fails on a CODE-QUALITY.md that has prose and no frontmatter', async () => {
    const root = await tempDir();
    await write(root, 'CODE-QUALITY.md', '# Quality\n\nRun the tests before you finish.\n');
    expect(await readGates(root)).toEqual({
      ok: false,
      reason:
        'foundation/CODE-QUALITY.md declares no gates, and a card cannot pass a gate set that is empty.',
    });
  });

  it('reads the smoke command from TESTING.md, and fails closed without one', async () => {
    const root = await tempDir();
    expect(await readSmokeCommand(root)).toEqual({
      ok: false,
      reason: 'foundation/TESTING.md does not exist, so there is no smoke test to close a feature.',
    });
    await write(root, 'TESTING.md', '# How we test\n');
    expect(await readSmokeCommand(root)).toEqual({
      ok: false,
      reason: 'foundation/TESTING.md declares no `smoke:` command.',
    });
    await write(root, 'TESTING.md', '---\nsmoke: npm run smoke\n---\nHow we test.\n');
    expect(await readSmokeCommand(root)).toEqual({ ok: true, command: 'npm run smoke' });
  });

  it('counts a document that exists but is empty as missing', async () => {
    const root = await tempDir();
    await write(root, 'STACK.md', '   \n');
    const status = await foundationStatus(root);
    expect(status.missing).toContain('STACK.md');
    expect(status.present).not.toContain('STACK.md');
  });

  it('is ok only when all five are there with something in them', async () => {
    const root = await tempDir();
    for (const name of ['STACK.md', 'CODE-QUALITY.md', 'TESTING.md', 'UX.md', 'DESIGN.md']) {
      await write(root, name, `# ${name}\n\nDecided.\n`);
    }
    const status = await foundationStatus(root);
    expect(status.missing).toEqual([]);
    expect(status.ok).toBe(true);
  });

  // gray-matter caches by input string and caches an EMPTY result after a throw, so two documents
  // with the same broken frontmatter must not have the second one parse "successfully" as {}.
  it('fails the same way twice on identical broken frontmatter', async () => {
    const root = await tempDir();
    const broken = '---\ngates: [unclosed\n---\nbody\n';
    await write(root, 'CODE-QUALITY.md', broken);
    const first = await readGates(root);
    await write(root, 'CODE-QUALITY.md', broken);
    expect(await readGates(root)).toEqual(first);
    expect(first.ok).toBe(false);
  });
});
