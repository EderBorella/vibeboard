import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONVENTIONS_FILE, INSTRUCTIONS_FILE, POINTER_FILES } from '../src/core/layout.js';
import { ensureControlFiles, ensurePointerFile } from '../src/store/project/control.js';
import { scaffoldProject } from '../src/store/project/scaffold.js';
import { tempDir } from './helpers.js';

const read = (root: string, name: string): Promise<string> => readFile(join(root, name), 'utf8');

const [CLAUDE_MD, AGENTS_MD] = POINTER_FILES;

// The pointer files stay at the root, so their imports now carry a path. An `@`-import may, which
// is the whole reason the two documents could move inside `.vibeboard/` at all.
const NOTE = `See ${CONVENTIONS_FILE} for card conventions and ${INSTRUCTIONS_FILE} for project-specific instructions.`;
const IMPORTS = `@${CONVENTIONS_FILE}\n@${INSTRUCTIONS_FILE}`;

describe('scaffold control files', () => {
  it('writes INSTRUCTIONS.md and points CLAUDE.md / AGENTS.md at both docs', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'greenfield', today: '2026-07-25' });

    const instructions = await read(root, INSTRUCTIONS_FILE);
    expect(instructions).toMatch(/# Project instructions/);
    expect(instructions).toContain('added to');

    for (const pointer of POINTER_FILES) {
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
    await ensurePointerFile(root, CLAUDE_MD, 'Demo', true);
    expect(await read(root, CLAUDE_MD)).toBe(`# Demo\n\n${IMPORTS}\n\n${NOTE}\n`);
  });

  it('appends to an existing file that ends in a newline, separated by one blank line', async () => {
    const root = await tempDir();
    await writeFile(join(root, CLAUDE_MD), '# Old\n', 'utf8');
    await ensurePointerFile(root, CLAUDE_MD, 'Demo', false);
    expect(await read(root, CLAUDE_MD)).toBe(`# Old\n\n${IMPORTS}\n`);
  });

  it('terminates the last line first when the existing file has no trailing newline', async () => {
    const root = await tempDir();
    await writeFile(join(root, CLAUDE_MD), '# Old', 'utf8');
    await ensurePointerFile(root, CLAUDE_MD, 'Demo', false);
    expect(await read(root, CLAUDE_MD)).toBe(`# Old\n\n${IMPORTS}\n`);
  });

  it('creates a bare import block when there is no file and this is not a greenfield write', async () => {
    const root = await tempDir();
    await ensurePointerFile(root, AGENTS_MD, 'Demo', false);
    expect(await read(root, AGENTS_MD)).toBe(`\n${IMPORTS}\n`);
  });

  it('appends only the import that is missing', async () => {
    const root = await tempDir();
    await writeFile(join(root, CLAUDE_MD), `# Old\n\n@${CONVENTIONS_FILE}\n`, 'utf8');
    await ensurePointerFile(root, CLAUDE_MD, 'Demo', false);
    expect(await read(root, CLAUDE_MD)).toBe(`# Old\n\n@${CONVENTIONS_FILE}\n\n@${INSTRUCTIONS_FILE}\n`);
  });

  it('leaves a file that already has both imports byte-identical', async () => {
    const root = await tempDir();
    const before = `# Mine\n\n${IMPORTS}\n\nmy own words\n`;
    await writeFile(join(root, CLAUDE_MD), before, 'utf8');
    await ensurePointerFile(root, CLAUDE_MD, 'Demo', false);
    expect(await read(root, CLAUDE_MD)).toBe(before);
  });

  it('does not take the greenfield path when the file already has content', async () => {
    const root = await tempDir();
    await writeFile(join(root, CLAUDE_MD), '# Mine\n', 'utf8');
    await ensurePointerFile(root, CLAUDE_MD, 'Demo', true);
    // Greenfield is requested but the file is non-empty, so the user's content survives and only
    // the imports are appended — no heading is rewritten and no note is added.
    expect(await read(root, CLAUDE_MD)).toBe(`# Mine\n\n${IMPORTS}\n`);
  });
});

describe('ensureControlFiles migration', () => {
  it('backfills an older project and is idempotent', async () => {
    const root = await tempDir();
    // Simulate a pre-Project-Control project: an old single-line CLAUDE.md, no INSTRUCTIONS.md.
    await writeFile(join(root, CLAUDE_MD), '# Old\n\nSee VIBEBOARD.md for card conventions.\n', 'utf8');

    await ensureControlFiles(root);
    const claudeOnce = await read(root, CLAUDE_MD);
    expect(await read(root, INSTRUCTIONS_FILE)).toMatch(/# Project instructions/);
    expect(claudeOnce).toContain(`@${INSTRUCTIONS_FILE}`);
    expect(claudeOnce).toContain(`@${CONVENTIONS_FILE}`);
    // AGENTS.md did not exist. Migration is NOT a greenfield write, so it gets the bare import
    // block rather than a fresh "# name" heading and note.
    expect(await read(root, AGENTS_MD)).toBe(`\n${IMPORTS}\n`);

    // Running again changes nothing (imports already present).
    await ensureControlFiles(root);
    const claudeTwice = await read(root, CLAUDE_MD);
    expect(claudeTwice).toBe(claudeOnce);
    expect(claudeTwice.split(`@${INSTRUCTIONS_FILE}`).length - 1).toBe(1);
  });

  it('never overwrites an INSTRUCTIONS.md the user has already written', async () => {
    const root = await tempDir();
    await mkdir(join(root, INSTRUCTIONS_FILE, '..'), { recursive: true });
    await writeFile(join(root, INSTRUCTIONS_FILE), 'my standing orders\n', 'utf8');
    await ensureControlFiles(root);
    expect(await read(root, INSTRUCTIONS_FILE)).toBe('my standing orders\n');
  });
});
