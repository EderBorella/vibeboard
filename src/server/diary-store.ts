import { appendFile, type FileHandle, mkdir, open, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DIARY_HEADER, type DiaryEntry, entryBlock, parseDiary } from '../core/diary.js';
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
  const tail = await lastByte(path);
  // The heading belongs to creating the file, not to appending to it. An empty file — including a zero-byte
  // one somebody made by hand — gets one.
  const head = tail === undefined ? DIARY_HEADER : '';
  // A newline FIRST when the file does not end in one. Our own writes always do, which is why deciding on
  // size alone looked correct: the missing newline comes from a person annotating the file, which this store
  // explicitly supports. Without this the append continues their line and the result parses as neither
  // event — written, acknowledged with a 200, pushed to every tab, and unreadable for ever.
  const gap = tail === undefined || tail === '\n' ? '' : '\n';
  await appendFile(path, `${head}${gap}${entryBlock(entry, false)}`, 'utf8');
}

// The file's last character, or `undefined` when there is nothing there yet — which is a different fact from
// "ends in a newline" and has to stay one, because it decides whether the heading is written.
async function lastByte(path: string): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    const { size } = await stat(path);
    if (size === 0) return undefined;
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, size - 1);
    return buffer.toString('utf8');
  } catch {
    return undefined; // no file yet, or nothing we may read — the append below will say so
  } finally {
    await handle?.close();
  }
}

// Oldest first, which is the order things happened and the order the file is written in. The UI reverses
// it for display; the checkup wants it forwards.
//
// ONLY a missing file answers `[]`. Every other failure throws, and the distinction is the whole point:
// this is the checkup's primary input, so reporting an unreadable diary as an empty one would tell the
// supervisor that nothing has happened in a project that may have done hundreds of things. Absence and
// damage are different facts — the same rule the auto-pilot state store applies, for the same reason.
export async function readDiary(root: string): Promise<DiaryEntry[]> {
  try {
    return parseDiary(await readFile(diaryPath(root), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
