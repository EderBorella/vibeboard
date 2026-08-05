import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { boardColumnSlugs, readBoard } from '../src/core/board.js';
import { readConfig } from '../src/core/config.js';
import { parseDiary } from '../src/core/diary.js';
import {
  ARCHIVE_SLUG,
  boardRel,
  CONVENTIONS_FILE,
  POINTER_FILES,
  PROJECT_LOG_FILE,
} from '../src/core/layout.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { appendEntry, readDiary } from '../src/server/diary-store.js';
import { tempDir } from './helpers.js';

const TODAY = '2026-07-23';
const [CLAUDE_MD] = POINTER_FILES;

async function git(root: string, ...args: string[]): Promise<string> {
  return (await promisify(execFile)('git', args, { cwd: root })).stdout;
}

describe('scaffoldProject', () => {
  it('greenfield: initialises a git repository', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'greenfield', today: TODAY });
    await expect(access(join(root, '.git'))).resolves.toBeUndefined();
  });

  it('brownfield: initialises one too, because everything downstream commits', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'brownfield', today: TODAY });
    await expect(access(join(root, '.git'))).resolves.toBeUndefined();
  });

  it('does not create a nested repo inside one it is already part of', async () => {
    // Adopting /monorepo/packages/app is ordinary. Its own .git would shadow the parent, which
    // then sees an embedded repository and stops tracking the subtree's history.
    const outer = await tempDir();
    await git(outer, 'init');
    const inner = join(outer, 'packages', 'app');
    await mkdir(inner, { recursive: true });
    await scaffoldProject(inner, { name: 'Inner', mode: 'brownfield', today: TODAY });
    expect(existsSync(join(inner, '.git'))).toBe(false);
  });

  it('leaves an existing repository alone', async () => {
    const root = await tempDir();
    await git(root, 'init');
    await git(root, 'config', 'vibeboard.marker', 'original');
    // The mtime of .git/config, NOT a config value: re-running `git init` on a repo preserves
    // config values and history, so a marker assertion passes whether the guard is there or not.
    // Measured, after review pointed out the first version of this test could not fail. What
    // re-init does change is the file — it rewrites it.
    const before = statSync(join(root, '.git', 'config')).mtimeMs;
    await new Promise((r) => setTimeout(r, 20)); // coarse filesystem timestamps
    await scaffoldProject(root, { name: 'Demo', mode: 'brownfield', today: TODAY });

    expect(statSync(join(root, '.git', 'config')).mtimeMs).toBe(before);
    expect((await git(root, 'config', '--get', 'vibeboard.marker')).trim()).toBe('original');
  });

  it('greenfield: writes config, folders, docs, sample cards, and a fresh CLAUDE.md', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'greenfield', today: TODAY });

    const config = await readConfig(root);
    expect(config.name).toBe('Demo');
    await expect(access(join(root, boardRel('product', ARCHIVE_SLUG)))).resolves.toBeUndefined();
    await expect(access(join(root, boardRel('engineering', ARCHIVE_SLUG)))).resolves.toBeUndefined();
    await expect(access(join(root, CONVENTIONS_FILE))).resolves.toBeUndefined();

    const claude = await readFile(join(root, CLAUDE_MD), 'utf8');
    expect(claude).toContain(CONVENTIONS_FILE);

    const product = await readBoard(root, 'product', config);
    const engineering = await readBoard(root, 'engineering', config);
    expect(product.length).toBeGreaterThan(0);
    expect(engineering[0].links).toContain(product[0].id);
  });

  // The sample cards are the first thing a new user reads, and they are also the worked example
  // of the three-board hierarchy — so their wording is behaviour, not decoration.
  it('greenfield: seeds one sample card per board, each explaining its own level', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'greenfield', today: TODAY });
    const config = await readConfig(root);

    const expected = {
      features: {
        title: 'Sample feature',
        description: 'A high-level capability. Delete me once you get going.',
        body: 'Describe the capability and its goal here.',
      },
      product: {
        title: 'Sample product card',
        description: 'A product outcome. Delete me once you get going.',
        body: 'Describe the what/why here.',
      },
      engineering: {
        title: 'Sample engineering card',
        description: 'An implementation task. Delete me once you get going.',
        body: 'Describe the how here.',
      },
    } as const;

    for (const board of ['features', 'product', 'engineering'] as const) {
      const cards = await readBoard(root, board, config);
      expect(cards, board).toHaveLength(1);
      expect(cards[0].title, board).toBe(expected[board].title);
      expect(cards[0].description, board).toBe(expected[board].description);
      expect(cards[0].body?.trim(), board).toBe(expected[board].body);
      // The board's own first column, not a named one: `toHaveLength(1)` above already proves the
      // card is in a column the board reads at all, so what is left to pin is which. Naming 'todo'
      // here is what let the scaffolder drift past engineering's defaults unnoticed.
      expect(cards[0].columnSlug, board).toBe(boardColumnSlugs(config, board)[0]);
    }
  });

  it('greenfield: links the product sample to both the feature and the engineering card', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'greenfield', today: TODAY });
    const config = await readConfig(root);

    const [feature] = await readBoard(root, 'features', config);
    const [product] = await readBoard(root, 'product', config);
    const [engineering] = await readBoard(root, 'engineering', config);
    expect(product.links).toEqual(expect.arrayContaining([feature.id, engineering.id]));
    // Symmetric: each end points back at the middle.
    expect(feature.links).toContain(product.id);
    expect(engineering.links).toContain(product.id);
  });

  it('writes the card conventions doc the CLIs are pointed at', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Demo', mode: 'greenfield', today: TODAY });
    const doc = await readFile(join(root, CONVENTIONS_FILE), 'utf8');
    expect(doc).toContain('# VibeBoard card conventions');
    expect(doc).toContain('**Board and column come from the file path**, never from frontmatter.');
  });

  it('brownfield: preserves an existing CLAUDE.md, appending only a pointer', async () => {
    const root = await tempDir();
    await writeFile(join(root, CLAUDE_MD), '# Existing Project\n\nImportant rules here.\n', 'utf8');
    await scaffoldProject(root, { name: 'Adopted', mode: 'brownfield', today: TODAY });

    const claude = await readFile(join(root, CLAUDE_MD), 'utf8');
    expect(claude).toContain('Important rules here.');
    expect(claude).toContain(CONVENTIONS_FILE);
    await expect(access(join(root, CONVENTIONS_FILE))).resolves.toBeUndefined();
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
    await expect(access(join(root, boardRel('product', 'todo')))).resolves.toBeUndefined();
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# My real repo\n');
  });

  it('brownfield: does not duplicate the pointer on re-run', async () => {
    const root = await tempDir();
    await writeFile(join(root, CLAUDE_MD), '# X\n', 'utf8');
    await scaffoldProject(root, { name: 'A', mode: 'brownfield', today: TODAY });
    await scaffoldProject(root, { name: 'A', mode: 'brownfield', today: TODAY });
    const claude = await readFile(join(root, CLAUDE_MD), 'utf8');
    expect(claude.split(`@${CONVENTIONS_FILE}`).length - 1).toBe(1);
  });
});

// The diary. Load-bearing rather than decorative: it is the checkup's primary input, and unlike every
// other file here its contents cannot be re-derived — the board comes from its folders, a run's cost from
// its record, what changed from git, but a narrative comes from nowhere else.
describe('the project log', () => {
  it('starts with one lifecycle entry, whichever mode the project was created in', async () => {
    for (const mode of ['greenfield', 'brownfield'] as const) {
      const root = await tempDir();
      await scaffoldProject(root, { name: 'A', mode, today: TODAY });
      const entries = parseDiary(await readFile(join(root, PROJECT_LOG_FILE), 'utf8'));
      expect(entries, mode).toHaveLength(1);
      expect(entries[0]?.kind, mode).toBe('lifecycle');
      expect(entries[0]?.text, mode).toContain('created');
    }
  });

  it('names the project it is about, so a diary read on its own says whose it is', async () => {
    const root = await tempDir();
    // Two words with a space, because a single-token name cannot tell "the name was used" from "some other
    // string happened to match". Deliberately not a real project's name: nothing in this repo's committed
    // files names anything outside it.
    await scaffoldProject(root, { name: 'Second Project', mode: 'brownfield', today: TODAY });
    expect((await readDiary(root))[0]?.text).toContain('Second Project');
  });

  it('has a heading, so the file reads as a document when opened directly', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'A', mode: 'brownfield', today: TODAY });
    expect(await readFile(join(root, PROJECT_LOG_FILE), 'utf8')).toMatch(/^# /);
  });

  // Scaffolding is idempotent everywhere else here, and this is the one file where getting that wrong is
  // unrecoverable: re-scaffolding an adopted project would erase its whole history.
  it('leaves an existing diary alone', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'A', mode: 'greenfield', today: TODAY });
    await appendEntry(root, {
      at: '2026-08-05T12:00:00.000Z',
      kind: 'run',
      text: 'something that happened',
    });
    await scaffoldProject(root, { name: 'A', mode: 'greenfield', today: '2026-08-06' });

    const texts = (await readDiary(root)).map((e) => e.text);
    expect(texts).toContain('something that happened');
    // And no second "created" line: the project was created once.
    expect(texts.filter((t) => t.includes('created'))).toHaveLength(1);
  });

  // The guard must not conflate "nothing here" with "something here I may not read": a write-only diary was
  // silently overwritten, which is the single loss this guard exists to prevent.
  it('leaves a diary it cannot read alone, rather than overwriting it', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'A', mode: 'brownfield', today: TODAY });
    await appendEntry(root, { at: '2026-08-05T12:00:00.000Z', kind: 'run', text: 'history worth keeping' });
    const diary = join(root, PROJECT_LOG_FILE);
    await chmod(diary, 0o200); // writable, not readable

    await scaffoldProject(root, { name: 'A', mode: 'brownfield', today: '2026-08-06' });
    await chmod(diary, 0o600);
    expect((await readDiary(root)).map((e) => e.text)).toContain('history worth keeping');
  });

  // The next append must start a new line rather than continuing the one scaffold wrote.
  it('is left ready for the next append', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'A', mode: 'brownfield', today: TODAY });
    await appendEntry(root, { at: '2026-08-05T12:00:00.000Z', kind: 'run', text: 'next' });
    expect((await readDiary(root)).map((e) => e.text)).toEqual([expect.stringContaining('created'), 'next']);
  });
});
