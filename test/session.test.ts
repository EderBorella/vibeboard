import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boardColumnSlugs } from '../src/core/board.js';
import {
  AUTOPILOT_STATE_FILE,
  boardRel,
  CHAT_DIR,
  CONFIG_DIR,
  CONFIG_FILE,
  DOCS_DIR,
  POINTER_FILES,
  PROJECT_LOG_FILE,
  RESULTS_DIR,
  RUNS_DIR,
} from '../src/core/layout.js';
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
    // The column comes from the config the session just handed back: a card written to a folder no
    // column maps to is not on the board, so the broadcast would never carry it and the only
    // symptom would be this test timing out.
    const [column] = boardColumnSlugs(cfg, 'engineering');
    await createCard(root, cfg, { board: 'engineering', columnSlug: column, title: 'Watched task' }, TODAY);

    const snap = await received;
    expect(snap.boards.engineering.some((c) => c.title === 'Watched task')).toBe(true);
  }, 5000);
});

// The watcher's ignore list, tested directly: driving it through chokidar is slow and racy, and
// the distinction that matters is subtle — the chat and run stores are ignored so their constant
// writes do not churn the board, but almost everything else now lives under `.vibeboard/` too
// (cards included), so ignoring the folder wholesale would stop the board updating at all.
describe('isIgnored', () => {
  it.each([
    '/p/node_modules/x/index.js',
    '/p/.git/HEAD',
    `/p/${CHAT_DIR}/abc.json`,
    `/p/${CHAT_DIR}`,
    `/p/${RUNS_DIR}/r1.log.jsonl`,
    `/p/${PROJECT_LOG_FILE}`,
    `/p/${AUTOPILOT_STATE_FILE}`,
  ])('ignores %s', (p) => {
    expect(isIgnored(p)).toBe(true);
  });

  it.each([
    `/p/${CONFIG_DIR}/${CONFIG_FILE}`,
    `/p/${boardRel('product', 'todo', 'P-001.md')}`,
    `/p/${boardRel('product', RESULTS_DIR, 'P-001', 'r1.md')}`,
    `/p/${DOCS_DIR}/notes.md`,
    `/p/${POINTER_FILES[0]}`,
    '/p/my-node_modules-notes.md',
    // Same filename, a real file of the user's, one level down: the diary is one exact path.
    `/p/docs/${PROJECT_LOG_FILE.split('/').pop()}`,
    // Same again for the state file: one exact path, not a filename anywhere in the tree.
    `/p/docs/${AUTOPILOT_STATE_FILE.split('/').pop()}`,
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
      join(root, boardRel('product', 'todo', 'P-900.md')),
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
      await writeFile(join(root, boardRel('product', 'todo', `${id}.md`)), card(id), 'utf8');
    }
    await new Promise((r) => setTimeout(r, 400));

    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.length).toBeLessThan(3); // debounced, not one per write
    await s.close();
  }, 10000);
});
