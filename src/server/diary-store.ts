import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type DiaryEntry, entryBlock, parseDiary } from '../core/diary.js';
import { PROJECT_LOG_FILE } from '../core/layout.js';
import { serialise } from './write-queue.js';

// The diary on disk. Append-only, and the only module allowed to write it.
//
// Append-only is the property worth defending rather than asserting once: everything else in a project
// can be re-derived — the board from its folders, a run's cost from its record, what changed from git —
// but the narrative cannot. So this module has no update, no delete and no truncate, and there is no
// route that offers one.
//
// `appendFile` rather than the read-modify-write the run store uses, and not because it is shorter: a
// diary read and rewritten in full would lose whatever a person typed into it between the two, and would
// turn every event into an O(n) write of a file that only grows.

export function diaryPath(root: string): string {
  return join(root, PROJECT_LOG_FILE);
}

// Serialised per project. `O_APPEND` already makes each write land whole, so nothing is lost or torn
// without this — what it buys is ORDER, and the diary IS the sequence: a checkup reading it out of order
// would see a project circling that was not, or miss one that was.
export async function appendEntry(root: string, entry: DiaryEntry): Promise<void> {
  await serialise(`diary:${root}`, () => write(diaryPath(root), entry));
}

async function write(path: string, entry: DiaryEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // The heading belongs to creating the file, not to appending to it. Size rather than existence, so a
  // zero-byte file somebody made by hand still gets one. The trailing newline is in `entryBlock`, with
  // the heading, because forgetting either corrupts the file in the same way.
  await appendFile(path, entryBlock(entry, (await size(path)) === 0), 'utf8');
}

async function size(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0; // no file yet
  }
}

// Oldest first, which is the order things happened and the order the file is written in. The UI reverses
// it for display; the checkup wants it forwards.
export async function readDiary(root: string): Promise<DiaryEntry[]> {
  try {
    return parseDiary(await readFile(diaryPath(root), 'utf8'));
  } catch {
    // No file yet is not an error: a project simply has no narrative before its first event.
    return [];
  }
}
