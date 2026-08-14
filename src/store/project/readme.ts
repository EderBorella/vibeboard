import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The README is the prospect: auto-pilot derives the entire feature list from it, so a project
// without one has nothing to build. This is the cheap MECHANICAL half — it exists, and it is long
// enough to be a description rather than a title. Judging whether it is ADEQUATE is a later,
// substantive pass that reads it; this one only has to be honest about a stub.
//
// The repository's OWN README at the project root, never a .vibeboard document: the foundation
// documents are decided FROM the README, so gating on one would make the check judge its own output.

// Case-insensitive, and an extensionless README counts — a plain `README` is a real convention, and
// a gate that failed on the filename rather than on substance would be answering the wrong question.
const README = /^readme(\.md|\.markdown|\.txt)?$/i;

// About a paragraph, counted without whitespace. A stub says "# my-app" and nothing else; anything
// that actually describes what is being built clears this without trying.
const MIN_CHARS = 200;

export type ReadmeGate = { ok: true; path: string } | { ok: false; reason: string };

export async function readmeGate(root: string): Promise<ReadmeGate> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return { ok: false, reason: 'This project folder could not be read.' };
  }
  // Sorted, so a project holding both `README` and `README.md` resolves the same way every time
  // rather than by readdir order, which differs between filesystems.
  const candidates = entries.filter((e) => README.test(e)).sort();
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'This project has no README. Auto-pilot derives the whole feature list from it.',
    };
  }
  // Every candidate in turn, not just the first. `README` sorts before `README.md` ('' before '.'),
  // so a repo with a `README/` DIRECTORY beside a real `README.md` failed the gate without ever
  // opening the good file — the deterministic pick was committing to a name before knowing it read.
  let name = candidates[0];
  let content: string | undefined;
  for (const candidate of candidates) {
    try {
      content = await readFile(join(root, candidate), 'utf8');
      name = candidate;
      break;
    } catch {
      /* a directory of that name, or a permission problem — try the next spelling */
    }
  }
  if (content === undefined) {
    // Named like a README and not one of them readable. Says which was tried first, so it is fixable.
    return { ok: false, reason: `${name} could not be read.` };
  }
  const size = content.replace(/\s+/g, '').length;
  if (size < MIN_CHARS) {
    return {
      ok: false,
      reason: `${name} is ${size} characters long, which is too thin to derive features from. Describe what the project is for.`,
    };
  }
  return { ok: true, path: name };
}
