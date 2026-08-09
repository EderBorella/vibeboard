import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_DIR } from './layout.js';

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
// them. `dist/core/seed-docs.js` and `src/core/seed-docs.ts` both sit two levels below the root.
function sourceDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs');
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
      content = await readFile(join(sourceDir(), doc.source), 'utf8');
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
