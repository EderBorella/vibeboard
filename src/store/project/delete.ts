import { rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CONFIG_DIR, CONFIG_FILE } from '../../core/layout.js';

// REMOVING A PROJECT, and the part that matters is what it REFUSES.
//
// This is the only recursive delete in VibeBoard that a user can aim, and it is aimed with a path typed
// into a browser. The guard is therefore not a formality: without it a mistyped or malicious path is a
// `rm -rf` of anything the server can reach.
//
// THE GUARD IS THE PROJECT MARKER, not a prefix or an allow-list. A directory holding
// `.vibeboard/config.yaml` is a VibeBoard project by the same definition `discoverProjects` uses and
// `session.open` enforces; anything else is somebody's home directory, `/`, or a typo. A prefix rule
// would have to name a root, and there is no root — projects live wherever the user put them, which is
// the whole premise of the picker.

// What a delete removes, or why it will not. Callers report the refusal verbatim: it names the missing
// marker, which is the one fact that tells a person whether they meant this folder.
export type DeleteRefusal = { ok: false; reason: string };
export type Deleted = { ok: true; removed: string };

export async function deleteProjectTree(path: string): Promise<Deleted | DeleteRefusal> {
  const root = resolve(path);
  // Resolved first and used everywhere after, so the check and the delete cannot be about two different
  // strings — a trailing slash, a `..`, or a doubled separator would otherwise let them diverge.
  const marker = join(root, CONFIG_DIR, CONFIG_FILE);
  try {
    if (!(await stat(marker)).isFile()) throw new Error('not a file');
  } catch {
    return {
      ok: false,
      reason: `${root} has no ${CONFIG_DIR}/${CONFIG_FILE}, so it is not a VibeBoard project. Nothing was removed.`,
    };
  }
  await rm(root, { recursive: true, force: true });
  return { ok: true, removed: root };
}
