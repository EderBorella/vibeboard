import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureControlFiles } from '../src/core/control.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { tempDir } from './helpers.js';

const read = (root: string, name: string): Promise<string> => readFile(join(root, name), 'utf8');

describe('scaffold control files', () => {
  it('writes INSTRUCTIONS.md and points CLAUDE.md / AGENTS.md at both docs', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'greenfield', today: '2026-07-25' });

    const instructions = await read(root, 'INSTRUCTIONS.md');
    expect(instructions).toMatch(/# Project instructions/);

    for (const pointer of ['CLAUDE.md', 'AGENTS.md']) {
      const body = await read(root, pointer);
      expect(body, pointer).toContain('@VIBEBOARD.md');
      expect(body, pointer).toContain('@INSTRUCTIONS.md');
    }
  });
});

describe('ensureControlFiles migration', () => {
  it('backfills an older project and is idempotent', async () => {
    const root = await tempDir();
    // Simulate a pre-Project-Control project: an old single-line CLAUDE.md, no INSTRUCTIONS.md.
    await writeFile(join(root, 'CLAUDE.md'), '# Old\n\nSee VIBEBOARD.md for card conventions.\n', 'utf8');

    await ensureControlFiles(root);
    const claudeOnce = await read(root, 'CLAUDE.md');
    expect(await read(root, 'INSTRUCTIONS.md')).toMatch(/# Project instructions/);
    expect(claudeOnce).toContain('@INSTRUCTIONS.md');
    expect(claudeOnce).toContain('@VIBEBOARD.md');
    // AGENTS.md did not exist — it is created with the imports.
    expect(await read(root, 'AGENTS.md')).toContain('@INSTRUCTIONS.md');

    // Running again changes nothing (imports already present).
    await ensureControlFiles(root);
    const claudeTwice = await read(root, 'CLAUDE.md');
    expect(claudeTwice).toBe(claudeOnce);
    expect(claudeTwice.match(/@INSTRUCTIONS\.md/g)!.length).toBe(1);
  });
});
