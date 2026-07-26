import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCard } from '../src/core/mutations.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { isIgnored, ProjectSession } from '../src/server/session.js';
import type { ProjectSnapshot } from '../src/server/snapshot.js';
import { tempDir } from './helpers.js';

const TODAY = '2026-07-23';
let session: ProjectSession | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('ProjectSession', () => {
  it('rejects opening a non-project directory', async () => {
    session = new ProjectSession();
    const root = await tempDir();
    await expect(session.open(root)).rejects.toThrow();
    expect(session.isOpen).toBe(false);
  });

  it('opens a scaffolded project and reports open state', async () => {
    session = new ProjectSession();
    const root = await tempDir();
    await scaffoldProject(root, { name: 'S', mode: 'greenfield', today: TODAY });
    const snap = await session.open(root);
    expect(snap.name).toBe('S');
    expect(session.isOpen).toBe(true);
    expect(session.root).toBe(root);
  });

  it('broadcasts a fresh snapshot to subscribers when a card file appears', async () => {
    session = new ProjectSession();
    const root = await tempDir();
    await scaffoldProject(root, { name: 'S', mode: 'greenfield', today: TODAY });
    await session.open(root);

    const received = new Promise<ProjectSnapshot>((resolve) => {
      const off = session!.subscribe((s) => {
        if (s.boards.engineering.some((c) => c.title === 'Watched task')) {
          off();
          resolve(s);
        }
      });
    });

    const cfg = (await session.snapshot()).config;
    await createCard(root, cfg, { board: 'engineering', columnSlug: 'todo', title: 'Watched task' }, TODAY);

    const snap = await received;
    expect(snap.boards.engineering.some((c) => c.title === 'Watched task')).toBe(true);
  }, 5000);
});

// The watcher's ignore list, tested directly: driving it through chokidar is slow and racy, and
// the distinction that matters is subtle — .vibeboard/chat is ignored so the chat store's frequent
// writes do not churn the board, but config.yaml lives under .vibeboard too and IS watched, so a
// config edit still pushes a fresh snapshot.
describe('isIgnored', () => {
  it.each([
    '/p/node_modules/x/index.js',
    '/p/.git/HEAD',
    '/p/.vibeboard/chat/abc.json',
    '/p/.vibeboard/chat',
  ])('ignores %s', (p) => {
    expect(isIgnored(p)).toBe(true);
  });

  it.each([
    '/p/.vibeboard/config.yaml',
    '/p/product/todo/P-001.md',
    '/p/docs/notes.md',
    '/p/CLAUDE.md',
    '/p/my-node_modules-notes.md',
  ])('watches %s', (p) => {
    expect(isIgnored(p)).toBe(false);
  });
});

describe('ProjectSession lifecycle', () => {
  it('refuses to snapshot with no project open', async () => {
    const s = new ProjectSession();
    await expect(s.snapshot()).rejects.toThrow('No project open');
    await s.close();
  });

  it('reloadConfig is a no-op with no project open', async () => {
    const s = new ProjectSession();
    await expect(s.reloadConfig()).resolves.toBeUndefined();
    await s.close();
  });

  it('close() forgets the project, close(true) keeps it', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Keep', mode: 'brownfield', today: '2026-07-25' });

    const s = new ProjectSession();
    await s.open(root);
    expect(s.isOpen).toBe(true);

    await s.close(true); // the re-open path: watcher torn down, state retained
    expect(s.isOpen).toBe(true);
    expect(s.root).toBe(root);

    await s.close();
    expect(s.isOpen).toBe(false);
    expect(s.root).toBeUndefined();
  });

  it('stops notifying a listener that has unsubscribed', async () => {
    const s = new ProjectSession();
    const seen: unknown[] = [];
    const off = s.subscribe((snap) => seen.push(snap));
    off();
    // Nothing should reach it even once a project is open and the watcher fires.
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Un', mode: 'brownfield', today: '2026-07-25' });
    await s.open(root);
    await writeFile(
      join(root, 'product', 'todo', 'P-900.md'),
      '---\nid: P-900\ntitle: t\norder: 10\n---\n',
      'utf8',
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual([]);
    await s.close();
  });

  it('coalesces a burst of file changes into a single broadcast', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Debounce', mode: 'brownfield', today: '2026-07-25' });

    const s = new ProjectSession();
    const snaps: unknown[] = [];
    s.subscribe((snap) => snaps.push(snap));
    await s.open(root);

    const card = (id: string): string =>
      `---\nid: ${id}\ntitle: t\norder: 10\ntags: []\nlinks: []\ncreated: 2026-07-25\n---\n`;
    for (const id of ['P-901', 'P-902', 'P-903']) {
      await writeFile(join(root, 'product', 'todo', `${id}.md`), card(id), 'utf8');
    }
    await new Promise((r) => setTimeout(r, 400));

    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.length).toBeLessThan(3); // debounced, not one per write
    await s.close();
  }, 10000);
});
