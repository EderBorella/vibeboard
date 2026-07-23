import { describe, it, expect, afterEach } from 'vitest';
import { tempDir } from './helpers.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { createCard } from '../src/core/mutations.js';
import { ProjectSession } from '../src/server/session.js';
import type { ProjectSnapshot } from '../src/server/snapshot.js';

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
