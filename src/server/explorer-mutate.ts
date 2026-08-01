import { writeFile } from 'node:fs/promises';
import { readFileNode } from './explorer-list.js';
import { resolveInRoot } from './fs-sandbox.js';

// Changing the project from the Explorer tab. Same boundary as reading it (fs-sandbox.ts) and the
// same absence of an allow-list: any path under the root is fair game.

export type WriteResult = 'ok' | 'not-text' | 'invalid';

// Save a text file. Refuses to write over a file the app could not show — a binary or oversized file
// never reached the editor as text, so whatever is in the buffer is not a version of it.
export async function writeFileNode(root: string, rel: unknown, content: unknown): Promise<WriteResult> {
  const r = await resolveInRoot(root, rel);
  if (!r || typeof content !== 'string') return 'invalid';
  const existing = await readFileNode(root, rel);
  if (existing === 'not-a-file') return 'invalid'; // a directory
  if (existing !== null && existing.kind !== 'text') return 'not-text';
  try {
    // No mkdir: saving a file is not permission to build a path. A missing parent means the tree the
    // client is working from is stale, and inventing directories would hide that.
    await writeFile(r.abs, content, 'utf8');
  } catch {
    return 'invalid';
  }
  return 'ok';
}
