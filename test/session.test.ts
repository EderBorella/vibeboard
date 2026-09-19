import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
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
  WIZARD_FILE,
} from '../src/core/layout.js';
import { isIgnored, ProjectSession } from '../src/server/boards/session.js';
import type { ProjectSnapshot } from '../src/server/boards/snapshot.js';
import { boardColumnSlugs } from '../src/store/cards/board.js';
import { createCard } from '../src/store/cards/mutations.js';
import { scaffoldProject } from '../src/store/project/scaffold.js';
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
    `/p/${WIZARD_FILE}`,
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
    // And for the wizard's scratch file — a project of somebody's own may hold a `wizard.yaml`.
    `/p/docs/${WIZARD_FILE.split('/').pop()}`,
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

// A REAL CRASH, from a real run. An agent building the "error handling and edge cases" feature wrote a
// fixture named `temp-unreadable.txt` with mode 000 — exactly the right way to test unreadable-file
// handling. chokidar tried to watch it, failed with EACCES, and emitted `error`; nothing was listening,
// so the EventEmitter threw, the rejection was unhandled, and the SERVER EXITED at iteration 67 of a
// project it was in the middle of building. The auto-pilot loop died with it.
//
// The shape of the bug is what makes it worth a test: a project's own agents, doing legitimate work
// inside the sandbox they were given, could kill the server that dispatched them — with nothing wrong
// on the board and nothing wrong in the config.
describe('a path the watcher cannot read', () => {
  it('does not take the process down, and the session stays open', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Unwatchable', mode: 'brownfield', today: TODAY });

    // A mode-000 DIRECTORY, not a mode-000 file, and the difference is the whole test. chmod 000 on a
    // file you own does not stop you watching it — the first version of this test used one, and it
    // passed with the fix removed. A directory with no `r` and no `x` genuinely denies its owner, so
    // chokidar's readdir fails and it emits `error` exactly as it did in the crash. Root is exempt
    // from both, so skip there rather than assert something that cannot happen.
    if (process.getuid?.() === 0) return;
    const shut = join(root, 'unreadable-dir');
    await mkdir(shut, { recursive: true });
    await writeFile(join(shut, 'f.txt'), 'x', 'utf8');
    await chmod(shut, 0o000);
    onTestFinished(async () => {
      await chmod(shut, 0o755).catch(() => {});
    });

    const rejections: unknown[] = [];
    const onRejection = (e: unknown): void => {
      rejections.push(e);
    };
    process.on('unhandledRejection', onRejection);
    onTestFinished(() => {
      process.off('unhandledRejection', onRejection);
    });

    session = new ProjectSession();
    await session.open(root);

    // The watcher reports asynchronously; give it a moment to fail if it is going to.
    await new Promise((r) => setTimeout(r, 300));

    expect(rejections).toEqual([]);
    expect(session.isOpen).toBe(true);
    // And the rest of the project is still watched — a card write still reaches a subscriber.
    const seen: ProjectSnapshot[] = [];
    session.subscribe((snap) => seen.push(snap));
    await writeFile(
      join(root, boardRel('product', 'todo', 'P-950.md')),
      '---\nid: P-950\ntitle: t\norder: 10\ntags: []\nlinks: []\ncreated: 2026-07-25\n---\n',
      'utf8',
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(seen.length).toBeGreaterThan(0);
  }, 15000);
});
