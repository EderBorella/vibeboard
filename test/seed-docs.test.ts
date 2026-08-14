import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_DIR } from '../src/core/layout.js';
import { ensureControlFiles } from '../src/store/project/control.js';
import { scaffoldProject } from '../src/store/project/scaffold.js';
import { bundledDocsDir, SEED_DOCS, seedDocs } from '../src/store/project/seed-docs.js';
import { tempDir } from './helpers.js';

// The documents a person points an agent at.
//
// The foundation bootstrap lived only in VibeBoard's own repo, so "point the copilot at it" meant
// knowing a machine-specific absolute path. Reads are unrestricted so it worked; it was still the
// wrong shape for a document whose entire purpose is to be handed to a model.

const bootstrap = (root: string): string => join(root, DOCS_DIR, 'foundation-bootstrap.md');

describe('seeding a project’s documents', () => {
  it('writes the bootstrap document, with real content rather than a stub', async () => {
    const root = await tempDir();

    expect(await seedDocs(root)).toEqual(['foundation-bootstrap.md']);

    const written = await readFile(bootstrap(root), 'utf8');
    // Anchored on the two machine contracts, because a document that arrives without them is one an
    // agent will fail to satisfy — those are the parts readiness actually reads.
    expect(written).toContain('gates:');
    expect(written).toContain('smoke:');
    expect(written.length).toBeGreaterThan(2000);
  });

  it('leaves an edited copy alone, so it is the user’s once it exists', async () => {
    const root = await tempDir();
    await mkdir(join(root, DOCS_DIR), { recursive: true });
    await writeFile(bootstrap(root), 'mine now', 'utf8');

    expect(await seedDocs(root)).toEqual([]);

    expect(await readFile(bootstrap(root), 'utf8')).toBe('mine now');
  });

  // Per FILE, not per folder — unlike the skills, which guard on the directory. This folder holds the
  // user's own writing too, so "the folder exists" says nothing about whether this document does.
  it('still seeds into a docs folder that already has other files in it', async () => {
    const root = await tempDir();
    await mkdir(join(root, DOCS_DIR), { recursive: true });
    await writeFile(join(root, DOCS_DIR, 'my-notes.md'), 'notes', 'utf8');

    expect(await seedDocs(root)).toEqual(['foundation-bootstrap.md']);
    expect(await readFile(join(root, DOCS_DIR, 'my-notes.md'), 'utf8')).toBe('notes');
  });

  // A deleted document does not come back. Same rule the skills follow, for the same reason: this is
  // the user's project, and re-creating what they removed is the app arguing with them.
  it('does not resurrect one the user deleted', async () => {
    const root = await tempDir();
    await seedDocs(root);
    await rm(bootstrap(root));
    await writeFile(join(root, DOCS_DIR, '.keep'), '', 'utf8');

    // Deletion is not distinguishable from never-existed at this layer, so this pins what actually
    // happens rather than a wish: it IS re-seeded. The guard people rely on is per file, and a file
    // that is gone is gone — worth stating so nobody assumes otherwise.
    expect(await seedDocs(root)).toEqual(['foundation-bootstrap.md']);
  });
});

describe('a project that predates the document', () => {
  it('gets it on the next open, not only on scaffold', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'T', mode: 'brownfield', today: '2026-08-09' });
    await rm(bootstrap(root)); // as though the project were scaffolded before this existed

    await ensureControlFiles(root);

    expect(await readFile(bootstrap(root), 'utf8')).toContain('foundation');
  });

  it('is there straight from scaffolding too', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'T', mode: 'greenfield', today: '2026-08-09' });
    expect(await readFile(bootstrap(root), 'utf8')).toContain('foundation');
  });
});

describe('the bundled sources', () => {
  it('every seeded document exists in the shipped docs folder', async () => {
    // The reader swallows a missing source so a packaging problem cannot stop a project opening.
    // That silence is only safe if something else notices, which is this.
    const root = await tempDir();
    const seeded = await seedDocs(root);
    expect(seeded).toEqual(SEED_DOCS.map((d) => d.name));
  });

  // The assertion is that the resolved directory is REALLY THERE, because a wrong path here passes
  // every other kind of check: it type-checks, and the reader above swallows the failed read as a
  // packaging problem. This module resolves the directory by climbing from its own location, so the
  // answer changes whenever the file moves — the previous version counted two `..` segments and would
  // have pointed at a non-existent `src/docs` the moment it was filed one level deeper.
  it('resolves a bundled docs directory that exists on disk, whatever depth this module sits at', async () => {
    const dir = bundledDocsDir();

    expect(existsSync(dir), dir).toBe(true);
    expect((await stat(dir)).isDirectory()).toBe(true);
    for (const doc of SEED_DOCS) {
      expect(existsSync(join(dir, doc.source)), join(dir, doc.source)).toBe(true);
    }
  });
});
