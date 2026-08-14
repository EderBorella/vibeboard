import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { FOUNDATION_FILES, foundationRel } from './layout.js';

// Reading the foundation documents. Three readers, one rule: **absence is never a pass.** A project
// whose test harness was never installed must not pass every card, which is what an empty gate list
// read as "nothing failed" would do.
//
// Gates and the smoke command live in frontmatter rather than in a fenced block, matching every
// other file VibeBoard reads: the prose above is for the human, the frontmatter is for the machine,
// and neither has to be parsed out of the other.
//
// Nothing here writes a template. A placeholder CODE-QUALITY.md would make readGates succeed over a
// project whose gates were never decided — a broken environment degrading into confidently-wrong
// output, rather than refusing.

export interface Gate {
  name: string;
  command: string;
}

export type GatesResult = { ok: true; gates: Gate[] } | { ok: false; reason: string };
export type SmokeResult = { ok: true; command: string } | { ok: false; reason: string };

export interface FoundationStatus {
  present: string[];
  missing: string[];
  ok: boolean;
}

// Empty counts as missing. A file created by saving an untouched editor is exactly the placeholder
// this module refuses to manufacture itself.
async function nonEmpty(root: string, name: string): Promise<boolean> {
  try {
    return (await readFile(join(root, foundationRel(name)), 'utf8')).trim() !== '';
  } catch {
    return false;
  }
}

export async function foundationStatus(root: string): Promise<FoundationStatus> {
  const checked = await Promise.all(
    FOUNDATION_FILES.map(async (f) => ({ name: f.name, there: await nonEmpty(root, f.name) })),
  );
  const present = checked.filter((c) => c.there).map((c) => c.name);
  const missing = checked.filter((c) => !c.there).map((c) => c.name);
  return { present, missing, ok: missing.length === 0 };
}

// gray-matter is called with an options object on purpose: with one argument it caches by input
// string and caches an EMPTY result after a throw, so the second read of the same broken file
// "succeeds" as {} (see core/card.ts).
//
// Three outcomes, not two: absent, unparseable, and parsed. Folding "will not parse" into "says
// nothing" told a user whose YAML had one bad quote that they had declared no gates — and it made
// the cache mitigation untestable, because both worlds then produced the same message.
const UNPARSEABLE = Symbol('unparseable frontmatter');

async function frontmatter(
  root: string,
  name: string,
): Promise<Record<string, unknown> | null | typeof UNPARSEABLE> {
  let raw: string;
  try {
    raw = await readFile(join(root, foundationRel(name)), 'utf8');
  } catch {
    return null; // absent, and the caller says so in its own words
  }
  try {
    return matter(raw, { language: 'yaml' }).data as Record<string, unknown>;
  } catch {
    return UNPARSEABLE;
  }
}

function readGate(entry: unknown): Gate | string {
  const o = (entry ?? {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const command = typeof o.command === 'string' ? o.command.trim() : '';
  if (!name) return 'foundation/CODE-QUALITY.md: a gate has no name.';
  if (!command) return `foundation/CODE-QUALITY.md: the gate "${name}" has no command.`;
  return { name, command };
}

export async function readGates(root: string): Promise<GatesResult> {
  const data = await frontmatter(root, 'CODE-QUALITY.md');
  if (data === null)
    return { ok: false, reason: 'foundation/CODE-QUALITY.md does not exist, so there are no gates to run.' };
  if (data === UNPARSEABLE) {
    return {
      ok: false,
      reason: 'foundation/CODE-QUALITY.md has frontmatter that will not parse, so its gates cannot be read.',
    };
  }
  const raw = Array.isArray(data.gates) ? data.gates : [];
  if (raw.length === 0) {
    return {
      ok: false,
      reason:
        'foundation/CODE-QUALITY.md declares no gates, and a card cannot pass a gate set that is empty.',
    };
  }
  const gates: Gate[] = [];
  for (const entry of raw) {
    const gate = readGate(entry);
    if (typeof gate === 'string') return { ok: false, reason: gate };
    gates.push(gate);
  }
  return { ok: true, gates };
}

export async function readSmokeCommand(root: string): Promise<SmokeResult> {
  const data = await frontmatter(root, 'TESTING.md');
  if (data === null) {
    return {
      ok: false,
      reason: 'foundation/TESTING.md does not exist, so there is no smoke test to close a feature.',
    };
  }
  if (data === UNPARSEABLE) {
    return {
      ok: false,
      reason:
        'foundation/TESTING.md has frontmatter that will not parse, so its smoke command cannot be read.',
    };
  }
  const command = typeof data.smoke === 'string' ? data.smoke.trim() : '';
  if (!command) return { ok: false, reason: 'foundation/TESTING.md declares no `smoke:` command.' };
  return { ok: true, command };
}

// WHAT THIS PROJECT DECLARES IT RUNS, as strings, for the one question that is about the commands rather than
// about their result: is the smoke command the same command as a gate (ruling 66)? The two readers above answer
// four states each, and a caller comparing commands needs neither the reason nor the verdict.
//
// A COMMAND SET THAT COULD NOT BE READ IS AN EMPTY ONE HERE, and that is the honest direction for this
// question alone: "absence is never a pass" is the rule for judging WORK, and every caller that judges work
// goes through `verifyGates`/`verifySmoke`, which still fail closed on the reader's own sentence. Nothing can
// collide with a gate a project never declared, so reporting a collision from an unreadable file would name a
// command nobody wrote.
export interface DeclaredCommands {
  gates: string[];
  smoke?: string;
}

export async function declaredCommands(root: string): Promise<DeclaredCommands> {
  const [gates, smoke] = await Promise.all([readGates(root), readSmokeCommand(root)]);
  return {
    gates: gates.ok ? gates.gates.map((g) => g.command) : [],
    ...(smoke.ok ? { smoke: smoke.command } : {}),
  };
}

// THE ONE WRITE INTO A FOUNDATION DOCUMENT THAT IS NOT A PERSON'S (ruling 67, and core/smoke-declaration.ts
// carries the argument). It sets `smoke:` and nothing else: the prose is read back out of the parsed file and
// re-emitted, and every other frontmatter key travels with it.
//
// READ-MODIFY-WRITE RATHER THAN A TEMPLATE, because TESTING.md is a document a person wrote about what
// testing means on this project, and replacing it with a generated file to change one scalar would delete
// their words to record a command. A file that will not parse is refused for the same reason — the safe move
// on an unreadable document is to leave it alone and say so, not to overwrite it with a guess.
export async function writeSmokeCommand(
  root: string,
  command: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const path = join(root, foundationRel('TESTING.md'));
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return {
      ok: false,
      reason: 'foundation/TESTING.md does not exist, so there is nothing to declare the smoke command in.',
    };
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw, { language: 'yaml' });
  } catch {
    return {
      ok: false,
      reason:
        'foundation/TESTING.md has frontmatter that will not parse, so the smoke command cannot be declared without discarding what is there.',
    };
  }
  const data = { ...(parsed.data as Record<string, unknown>), smoke: command };
  await writeFile(path, matter.stringify(parsed.content, data), 'utf8');
  return { ok: true };
}
