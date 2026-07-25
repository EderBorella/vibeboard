import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureControlFiles, ensurePointerFile } from '../src/core/control.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { tempDir } from './helpers.js';

const read = (root: string, name: string): Promise<string> => readFile(join(root, name), 'utf8');

const NOTE = 'See VIBEBOARD.md for card conventions and INSTRUCTIONS.md for project-specific instructions.';
const IMPORTS = '@VIBEBOARD.md\n@INSTRUCTIONS.md';

describe('scaffold control files', () => {
  it('writes INSTRUCTIONS.md and points CLAUDE.md / AGENTS.md at both docs', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'greenfield', today: '2026-07-25' });

    const instructions = await read(root, 'INSTRUCTIONS.md');
    expect(instructions).toMatch(/# Project instructions/);
    expect(instructions).toContain('added to');

    for (const pointer of ['CLAUDE.md', 'AGENTS.md']) {
      expect(await read(root, pointer), pointer).toBe(`# Demo\n\n${IMPORTS}\n\n${NOTE}\n`);
    }
  });
});

// The separator arithmetic here is the whole point of the function: an existing file may or may
// not end in a newline, and getting it wrong either glues an import onto the user's last line or
// leaves a widening gap. Asserting exact bytes is what pins it — `toContain` cannot see either.
describe('ensurePointerFile', () => {
  it('writes a fresh file with the heading, both imports, and the note', async () => {
    const root = await tempDir();
    await ensurePointerFile(root, 'CLAUDE.md', 'Demo', true);
    expect(await read(root, 'CLAUDE.md')).toBe(`# Demo\n\n${IMPORTS}\n\n${NOTE}\n`);
  });

  it('appends to an existing file that ends in a newline, separated by one blank line', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'CLAUDE.md'), '# Old\n', 'utf8');
    await ensurePointerFile(root, 'CLAUDE.md', 'Demo', false);
    expect(await read(root, 'CLAUDE.md')).toBe(`# Old\n\n${IMPORTS}\n`);
  });

  it('terminates the last line first when the existing file has no trailing newline', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'CLAUDE.md'), '# Old', 'utf8');
    await ensurePointerFile(root, 'CLAUDE.md', 'Demo', false);
    expect(await read(root, 'CLAUDE.md')).toBe(`# Old\n\n${IMPORTS}\n`);
  });

  it('creates a bare import block when there is no file and this is not a greenfield write', async () => {
    const root = await tempDir();
    await ensurePointerFile(root, 'AGENTS.md', 'Demo', false);
    expect(await read(root, 'AGENTS.md')).toBe(`\n${IMPORTS}\n`);
  });

  it('appends only the import that is missing', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'CLAUDE.md'), '# Old\n\n@VIBEBOARD.md\n', 'utf8');
    await ensurePointerFile(root, 'CLAUDE.md', 'Demo', false);
    expect(await read(root, 'CLAUDE.md')).toBe('# Old\n\n@VIBEBOARD.md\n\n@INSTRUCTIONS.md\n');
  });

  it('leaves a file that already has both imports byte-identical', async () => {
    const root = await tempDir();
    const before = `# Mine\n\n${IMPORTS}\n\nmy own words\n`;
    await writeFile(join(root, 'CLAUDE.md'), before, 'utf8');
    await ensurePointerFile(root, 'CLAUDE.md', 'Demo', false);
    expect(await read(root, 'CLAUDE.md')).toBe(before);
  });

  it('does not take the greenfield path when the file already has content', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'CLAUDE.md'), '# Mine\n', 'utf8');
    await ensurePointerFile(root, 'CLAUDE.md', 'Demo', true);
    // Greenfield is requested but the file is non-empty, so the user's content survives and only
    // the imports are appended — no heading is rewritten and no note is added.
    expect(await read(root, 'CLAUDE.md')).toBe(`# Mine\n\n${IMPORTS}\n`);
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
    // AGENTS.md did not exist. Migration is NOT a greenfield write, so it gets the bare import
    // block rather than a fresh "# name" heading and note.
    expect(await read(root, 'AGENTS.md')).toBe(`\n${IMPORTS}\n`);

    // Running again changes nothing (imports already present).
    await ensureControlFiles(root);
    const claudeTwice = await read(root, 'CLAUDE.md');
    expect(claudeTwice).toBe(claudeOnce);
    expect(claudeTwice.match(/@INSTRUCTIONS\.md/g)!.length).toBe(1);
  });

  it('never overwrites an INSTRUCTIONS.md the user has already written', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'INSTRUCTIONS.md'), 'my standing orders\n', 'utf8');
    await ensureControlFiles(root);
    expect(await read(root, 'INSTRUCTIONS.md')).toBe('my standing orders\n');
  });
});
