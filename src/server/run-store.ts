import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boardRel, RESULTS_DIR, RUNS_DIR } from '../core/layout.js';
import {
  isInFlight,
  needsResolution,
  parseAgentReport,
  parseRun,
  type RunRecord,
  serializeRun,
  withoutReport,
  withReport,
  withResolution,
} from '../core/runs.js';
import { BOARDS, type BoardName } from '../core/types.js';

// Run records on disk.
//
// `<board>/results/<CARD-ID>/<runId>.md` inside the boards folder — beside the card, so a card's
// history travels with it in git, and invisible to the board because readBoard only reads folders
// named by configured columns.
//
// The agent never writes here. It writes its report under `RUNS_DIR` and this module folds it in,
// because the record's frontmatter is ours: agents rewrite files wholesale, and a shared file would
// lose the timings. Anything in a results folder that does not parse as a run is ignored rather
// than trusted.

function cardDir(root: string, board: BoardName, card: string): string {
  return join(root, boardRel(board, RESULTS_DIR, card));
}

export function recordPath(root: string, board: BoardName, card: string, run: string): string {
  return join(cardDir(root, board, card), `${run}.md`);
}

// Where the agent is told to write. Under the runs folder so a chatty agent does not churn the
// board watcher, and so a half-written report never sits in a card's folder.
export function reportPath(root: string, run: string): string {
  return join(root, RUNS_DIR, `${run}.report.md`);
}

export function transcriptPath(root: string, run: string): string {
  return join(root, RUNS_DIR, `${run}.log.jsonl`);
}

export async function writeRun(root: string, record: RunRecord): Promise<void> {
  const path = recordPath(root, record.board, record.card, record.run);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, serializeRun(record), 'utf8');
}

export async function readRun(
  root: string,
  board: BoardName,
  card: string,
  run: string,
): Promise<RunRecord | null> {
  try {
    return parseRun(await readFile(recordPath(root, board, card, run), 'utf8'));
  } catch {
    return null;
  }
}

// Every run for one card, oldest first. Ids are sortable stamps, so the filename order IS
// chronological order and no file needs opening to sort.
export async function listCardRuns(root: string, board: BoardName, card: string): Promise<RunRecord[]> {
  let files: string[];
  try {
    files = (await readdir(cardDir(root, board, card))).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
  const runs: RunRecord[] = [];
  for (const file of files) {
    try {
      const record = parseRun(await readFile(join(cardDir(root, board, card), file), 'utf8'));
      if (record) runs.push(record);
    } catch {
      /* vanished between readdir and read */
    }
  }
  return runs;
}

// Every run in the project, newest first — the Execution dashboard's list. Walks each board's
// results folder; a project with no runs has no such folder and yields nothing.
export async function listRuns(root: string): Promise<RunRecord[]> {
  const all: RunRecord[] = [];
  for (const board of BOARDS) {
    let cards: string[];
    try {
      cards = (await readdir(join(root, boardRel(board, RESULTS_DIR)), { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue; // this board has never had a run
    }
    for (const card of cards) all.push(...(await listCardRuns(root, board, card)));
  }
  return all.sort((a, b) => b.run.localeCompare(a.run));
}

// Read and consume the agent's report. Consumed so a later run cannot pick up an earlier one's
// file, which would attach the wrong outcome to the wrong run.
export async function takeAgentReport(root: string, run: string): Promise<string | null> {
  const path = reportPath(root, run);
  try {
    const content = await readFile(path, 'utf8');
    await rm(path, { force: true });
    return content;
  } catch {
    return null;
  }
}

export async function appendTranscript(root: string, run: string, line: string): Promise<void> {
  const path = transcriptPath(root, run);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${line}\n`, { encoding: 'utf8', flag: 'a' });
}

// The last few lines of a transcript, for a run that ended without a report. Something to show
// beats an empty pane when the question is "what did it actually do".
export async function transcriptTail(root: string, run: string, lines = 40): Promise<string> {
  try {
    const content = await readFile(transcriptPath(root, run), 'utf8');
    return content.trim().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export function reportContract(run: string): string {
  return `${RUNS_DIR}/${run}.report.md`;
}

// Records still claiming to be queued or running when the project opens: their child processes died
// with the server that spawned them, so they are stale, not live. Marked interrupted so the
// dashboard never shows a run that will never finish.
// `live` is the runs this process still has in flight, and they are skipped. Without it, reopening
// a project while a run is going rewrites that run to `interrupted` — a status the record then keeps
// even as the agent finishes and writes its report, and one that burns no attempt.
export async function markInterrupted(root: string, at: string, live: string[] = []): Promise<number> {
  const running = new Set(live);
  const stale = (await listRuns(root)).filter((r) => isInFlight(r.status) && !running.has(r.run));
  for (const record of stale) {
    await writeRun(
      root,
      withoutReport(record, 'interrupted', 'VibeBoard restarted while this run was in flight', at),
    );
  }
  return stale.length;
}

// Mark one run dealt with. Returns the record either way: resolving one twice, or resolving a run
// that was never asking, is a no-op rather than an error — the dashboard and the card both offer the
// action, and two clicks must not mean two writes.
export async function resolveRun(
  root: string,
  board: BoardName,
  card: string,
  run: string,
  at: string,
): Promise<RunRecord | null> {
  const record = await readRun(root, board, card, run);
  if (!record) return null;
  if (!needsResolution(record)) return record;
  const resolved = withResolution(record, at);
  await writeRun(root, resolved);
  return resolved;
}

// Every unresolved run on one card, dealt with at once — what closing the card means. Returns how
// many were written, so a caller can tell "nothing was waiting" from "three were".
export async function resolveCardRuns(
  root: string,
  board: BoardName,
  card: string,
  at: string,
): Promise<number> {
  const pending = (await listCardRuns(root, board, card)).filter(needsResolution);
  for (const record of pending) await writeRun(root, withResolution(record, at));
  return pending.length;
}

// Fold a finished agent report into the record. Returns the updated record, or null when the agent
// wrote nothing — the caller decides what a report-less run means.
export async function foldReport(
  root: string,
  record: RunRecord,
  finished: string,
): Promise<RunRecord | null> {
  const content = await takeAgentReport(root, record.run);
  if (content === null) return null;
  const folded = withReport(record, parseAgentReport(content), finished);
  await writeRun(root, folded);
  return folded;
}
