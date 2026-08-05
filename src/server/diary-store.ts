import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DIARY_HEADER, type DiaryEntry, parseDiary, serializeEntry } from '../core/diary.js';
import { PROJECT_LOG_FILE } from '../core/layout.js';

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

// One promise chain per project, and that is the whole concurrency mechanism. Both writers reach this
// file through this process — the browser directly and slice C's service over HTTP — so serialising here
// is sufficient. Without it, fifty appends started together can interleave inside a line, which corrupts
// an event, or drop one, which loses it.
//
// Keyed by root so two projects cannot block each other. Nothing removes the entries: each holds one
// settled promise, and the count is bounded by how many distinct projects one server process ever opens.
const queues = new Map<string, Promise<unknown>>();

export async function appendEntry(root: string, entry: DiaryEntry): Promise<void> {
  const previous = queues.get(root) ?? Promise.resolve();
  const mine = previous.then(() => write(diaryPath(root), entry));
  // The stored link never rejects, so one failed append does not poison every append queued behind it.
  // The caller still sees its own failure, through the promise returned below.
  queues.set(
    root,
    mine.catch(() => undefined),
  );
  await mine;
}

async function write(path: string, entry: DiaryEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // The heading belongs to creating the file, not to appending to it. Size rather than existence, so a
  // zero-byte file somebody made by hand still gets one.
  const head = (await size(path)) > 0 ? '' : DIARY_HEADER;
  // A trailing newline every time: without one the NEXT append continues this line, and two events
  // become one unparseable one.
  await appendFile(path, `${head}${serializeEntry(entry)}\n`, 'utf8');
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
