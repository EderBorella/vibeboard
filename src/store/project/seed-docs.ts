import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_DIR } from '../../core/layout.js';

// Documents VibeBoard puts into a project so an agent can be POINTED AT one.
//
// The foundation bootstrap lived only in VibeBoard's own repo, which made "point the copilot at it"
// require knowing where VibeBoard is installed — a machine-specific absolute path, in a document whose
// whole purpose is to be handed to a model. Reads are unrestricted so it worked, and it was still the
// wrong shape.
//
// Seeded like the skills are, and for the same reasons: on scaffold AND on every project open, so a
// project that predates a document still gets it; per file rather than per folder, so a document the
// user deleted does not come back, and one they edited is never overwritten.
export const SEED_DOCS: { name: string; source: string }[] = [
  { name: 'foundation-bootstrap.md', source: 'foundation-bootstrap.md' },
];

// Resolved from this module rather than the working directory, so `npm start` from anywhere finds
// them — and by CLIMBING to the package root rather than counting `..` segments.
//
// The count was the bug. This module used to sit two levels below the root in both trees
// (`src/core/`, `dist/core/`) and hard-coded `'..', '..'`; moving it one level deeper made it read a
// `docs` folder that does not exist, and NOTHING would have caught that. There is no type error, and
// `seedDocs` treats an unreadable source as a packaging problem and carries on — so the only visible
// symptom is that projects quietly stop being given the bootstrap document. `src/` and `dist/` can
// also be at different depths from each other, which no single count can satisfy.
//
// `bundledDocsDir` is exported for `test/seed-docs.test.ts`, which asserts the resolved directory
// EXISTS ON DISK. That is the assertion this needs: a wrong path here satisfies every other kind of
// check.
export function bundledDocsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('no package.json above the seeded-documents module');
    dir = up;
  }
  return join(dir, 'docs');
}

export async function seedDocs(root: string): Promise<string[]> {
  const seeded: string[] = [];
  for (const doc of SEED_DOCS) {
    const target = join(root, DOCS_DIR, doc.name);
    try {
      await readFile(target, 'utf8');
      continue; // already there — theirs to edit or delete
    } catch {
      /* absent */
    }
    let content: string;
    try {
      content = await readFile(join(bundledDocsDir(), doc.source), 'utf8');
    } catch {
      // A packaging problem, not a project problem. Skipped rather than thrown: a missing bundled
      // document must not stop a project opening, and readiness never depends on one of these.
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    seeded.push(doc.name);
  }
  return seeded;
}
