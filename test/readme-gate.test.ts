import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readmeGate } from '../src/core/readme.js';
import { tempDir } from './helpers.js';

// Comfortably over the threshold, and prose rather than 200 x's: the check counts non-whitespace
// characters, and a fixture of one repeated letter would not notice if it started counting words.
const PROSE = 'A tool that turns a folder of notes into a searchable timeline for one person. '.repeat(4);

describe('the README gate', () => {
  it('refuses a project with no README, naming what it is for', async () => {
    expect(await readmeGate(await tempDir())).toEqual({
      ok: false,
      reason: 'This project has no README. Auto-pilot derives the whole feature list from it.',
    });
  });

  it.each(['README.md', 'readme.md', 'ReadMe.markdown', 'README', 'readme.txt'])(
    'accepts %s',
    async (name) => {
      const root = await tempDir();
      await writeFile(join(root, name), `# Thing\n\n${PROSE}\n`, 'utf8');
      expect(await readmeGate(root)).toEqual({ ok: true, path: name });
    },
  );

  it('refuses a stub, and says how short it is', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'README.md'), '# Thing\n', 'utf8');
    expect(await readmeGate(root)).toEqual({
      ok: false,
      reason:
        'README.md is 6 characters long, which is too thin to derive features from. Describe what the project is for.',
    });
  });

  // Whitespace is not description. A file padded with blank lines must not pass a length check.
  it('counts characters rather than bytes, so padding does not buy a pass', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'README.md'), `# Thing\n${'\n'.repeat(500)}   \t  \n`, 'utf8');
    const gate = await readmeGate(root);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain('6 characters');
  });

  it('ignores VibeBoard’s own documents — the gate must not judge its own output', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'CLAUDE.md'), PROSE, 'utf8');
    await writeFile(join(root, 'AGENTS.md'), PROSE, 'utf8');
    await mkdir(join(root, '.vibeboard', 'foundation'), { recursive: true });
    await writeFile(join(root, '.vibeboard', 'foundation', 'STACK.md'), PROSE, 'utf8');
    expect((await readmeGate(root)).ok).toBe(false);
  });

  // Both spellings of the same file is an ordinary thing to find in an adopted repo.
  it('picks one deterministically when a project has more than one', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'README'), PROSE, 'utf8');
    await writeFile(join(root, 'README.md'), PROSE, 'utf8');
    expect(await readmeGate(root)).toEqual({ ok: true, path: 'README' });
  });

  it('does not mistake a directory named README for a description', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'README'));
    expect(await readmeGate(root)).toEqual({ ok: false, reason: 'README could not be read.' });
  });
});

// `README` sorts before `README.md`, so committing to the first candidate meant a directory of that
// name hid a perfectly good file behind it. Docs repos with a `README/` folder are uncommon, not
// invented.
describe('when more than one thing is named like a README', () => {
  it('falls through a README directory to the real file', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'README'));
    await writeFile(join(root, 'README.md'), `# Thing\n\n${PROSE}\n`, 'utf8');
    expect(await readmeGate(root)).toEqual({ ok: true, path: 'README.md' });
  });

  it('still refuses when every candidate is unreadable, naming the first', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'README'));
    await mkdir(join(root, 'readme.txt'));
    expect(await readmeGate(root)).toEqual({ ok: false, reason: 'README could not be read.' });
  });

  // The thin one is still judged on its own content — falling through must not mean "keep looking
  // until something passes", or a stub beside a directory would sneak through on the wrong file.
  it('judges the first readable candidate rather than the best one', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'README'), '# Thing\n', 'utf8');
    await writeFile(join(root, 'README.md'), `# Thing\n\n${PROSE}\n`, 'utf8');
    const gate = await readmeGate(root);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain('README is 6 characters');
  });
});
