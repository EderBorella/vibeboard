import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SUGGESTIONS_DIR } from '../core/layout.js';
import {
  parseSuggestion,
  type Suggestion,
  type SuggestionState,
  serializeSuggestion,
} from '../core/suggestions.js';

// Suggestions on disk, one file each under `.vibeboard/suggestions/`.
//
// The agent never writes here — the profile denies it — so everything arrives through the endpoint
// and this module is the only writer. Same seam as run-store: what an agent says goes in a payload,
// and what is recorded is ours to stamp.

function dir(root: string): string {
  return join(root, SUGGESTIONS_DIR);
}

// Ids are generated here and only ever echoed back, but this module also takes one straight from a
// URL parameter — and Fastify decodes `%2f`, so `..%2f..%2fvictim` reached a file outside the
// folder and returned its contents. A filename is not a path.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

function path(root: string, id: string): string {
  if (!isSafeId(id)) throw new Error(`unsafe suggestion id: ${id}`);
  return join(dir(root), `${id}.md`);
}

export async function writeSuggestion(root: string, s: Suggestion): Promise<void> {
  await mkdir(dir(root), { recursive: true });
  await writeFile(path(root, s.id), serializeSuggestion(s), 'utf8');
  // Explicitly, because rewriting an existing file leaves the directory's mtime alone — triage
  // would otherwise keep reading the state it just changed.
  forgetSuggestions();
}

export async function readSuggestion(root: string, id: string): Promise<Suggestion | null> {
  try {
    return parseSuggestion(await readFile(path(root, id), 'utf8'));
  } catch {
    return null;
  }
}

// Every suggestion, parsed, cached on the folder's mtime.
//
// The cache is not premature. `buildSnapshot` calls this on every debounced watcher event, and
// suggestions are uncapped by design and never pruned — so without it a project with 500 findings
// re-read 500 files every time an agent touched a source file, and the only symptom would have
// been a board that got mysteriously laggy the longer a project ran.
//
// mtime of the DIRECTORY, which changes when a file is added or removed. An edit in place does not
// bump it, so triage — which rewrites a file — busts the cache explicitly below.
let cache: { root: string; mtimeMs: number; items: Suggestion[] } | undefined;

function forgetSuggestions(): void {
  cache = undefined;
}

async function allSuggestions(root: string): Promise<Suggestion[]> {
  let files: string[];
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(dir(root))).mtimeMs;
    if (cache && cache.root === root && cache.mtimeMs === mtimeMs) return cache.items;
    files = (await readdir(dir(root))).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
  // Parallel, like the board reads it sits beside in buildSnapshot — it was the one serial loop.
  const parsed = await Promise.all(
    files.map(async (file) => {
      try {
        return parseSuggestion(await readFile(join(dir(root), file), 'utf8'));
      } catch {
        return null; // vanished between readdir and read
      }
    }),
  );
  const items = parsed.filter((s): s is Suggestion => s !== null);
  cache = { root, mtimeMs, items };
  return items;
}

// Filtered here rather than by the caller, so the checkup can ask for the active ones and never
// scan the rest: with no state at all every checkup would re-read the whole history.
//
// Ids are sortable stamps, so filename order IS chronological order.
export async function listSuggestions(root: string, state?: SuggestionState): Promise<Suggestion[]> {
  const items = await allSuggestions(root);
  return state === undefined ? items : items.filter((s) => s.state === state);
}

// Triage. `reason` belongs to `dismissed` alone — an actioned suggestion explains itself through
// the card it became, and carrying a reason on it would invite two records of the same fact.
//
// An OPTIONS object rather than a fifth positional: four was already the limit of what reads at a call
// site, and `(root, id, state, undefined, 'P-004')` says nothing about which field is which.
export async function setSuggestionState(
  root: string,
  id: string,
  state: SuggestionState,
  what: { reason?: string; became?: string } = {},
): Promise<Suggestion | null> {
  const existing = await readSuggestion(root, id);
  if (!existing) return null;
  const { reason: _dropped, ...rest } = existing;
  const updated: Suggestion = {
    ...rest,
    ...(what.became ? { became: what.became } : {}),
    // The id we were ASKED for, not the one in the frontmatter. They are the same in every file
    // this module writes — but a hand-edited one where they disagree was read by filename and
    // written back by frontmatter id, which duplicated the suggestion instead of updating it.
    id,
    state,
    ...(state === 'dismissed' && what.reason ? { reason: what.reason } : {}),
  };
  await writeSuggestion(root, updated);
  return updated;
}

// How many this run filed. Counted from the store rather than taken from the agent's report: a
// self-reported number is one the agent can be wrong about, and this one is a diagnostic the
// checkup reads.
export async function countRunSuggestions(root: string, run: string): Promise<number> {
  return (await listSuggestions(root)).filter((s) => s.run === run).length;
}
