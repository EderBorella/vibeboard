import { readFile, writeFile, readdir, mkdir, rm, realpath } from 'node:fs/promises';
import { resolve, relative, join, dirname, basename, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import { CONFIG_DIR } from '../core/config.js';

// The Project Control tab's file controller. It exposes ONLY the documents that steer the
// models — instructions, skills, docs, resources — behind a hard path sandbox + allow-list so
// a client can never read or write cards, `.vibeboard/` internals, or anything outside root.

export type ControlCategory = 'instructions' | 'skills' | 'docs' | 'resources';

export interface ControlFile {
  path: string;        // project-root-relative, POSIX
  name: string;        // basename for display
  category: ControlCategory;
  managed: boolean;    // VibeBoard-managed (copilot-blocked; user edits behind a disclaimer)
  deletable: boolean;  // instruction files are never deletable
}

export interface ControlGroup {
  key: ControlCategory;
  label: string;
  files: ControlFile[];
}

export interface ResourceLink {
  title: string;
  url: string;
  note?: string;
}

// The four fixed instruction files. INSTRUCTIONS.md is freely editable; the other three are
// VibeBoard-managed (soft-blocked for the copilot, user-editable with a disclaimer).
const INSTRUCTION_FILES = ['INSTRUCTIONS.md', 'CLAUDE.md', 'AGENTS.md', 'VIBEBOARD.md'];
const MANAGED = new Set(['CLAUDE.md', 'AGENTS.md', 'VIBEBOARD.md']);
const RESOURCES_YAML = `${CONFIG_DIR}/resources.yaml`;

const GROUP_LABELS: Record<ControlCategory, string> = {
  instructions: 'Instructions',
  skills: 'Skills',
  docs: 'Docs',
  resources: 'Resources',
};

// Classify a root-relative POSIX path into a control category, or null if it is not a
// control-plane path (cards, `config.yaml`, other `.vibeboard/**`, node_modules, …).
function categoryOf(rel: string): ControlCategory | null {
  if (rel === RESOURCES_YAML) return 'resources';
  if (rel.startsWith(`${CONFIG_DIR}/`)) return null; // everything else under .vibeboard is off-limits
  if (INSTRUCTION_FILES.includes(rel)) return 'instructions';
  if (rel.startsWith('.claude/skills/')) return 'skills';
  if (rel.startsWith('resources/')) return 'resources';
  if (rel.startsWith('docs/') && rel.endsWith('.md')) return 'docs';
  if (!rel.includes('/') && rel.endsWith('.md')) return 'docs'; // root-level markdown
  return null;
}

function descriptor(rel: string): ControlFile | null {
  const category = categoryOf(rel);
  if (!category) return null;
  return {
    path: rel,
    name: basename(rel),
    category,
    managed: MANAGED.has(rel),
    deletable: category !== 'instructions',
  };
}

// Resolve a client path to an absolute path inside the project root AND an allowed category,
// or null on any violation. Symlink-safe: the nearest existing ancestor is realpath-checked so
// a symlink inside the tree can't point outside it.
export async function resolveControlPath(
  root: string,
  rel: unknown,
): Promise<{ abs: string; file: ControlFile } | null> {
  if (typeof rel !== 'string' || rel === '') return null;
  const posix = rel.split(sep).join('/');
  if (posix.startsWith('/') || posix.split('/').includes('..')) return null;
  const file = descriptor(posix);
  if (!file) return null;
  const abs = resolve(root, posix);
  const back = relative(root, abs);
  if (back === '' || back.startsWith('..')) return null;
  if (!(await withinRootRealpath(root, abs))) return null;
  return { abs, file };
}

async function withinRootRealpath(root: string, abs: string): Promise<boolean> {
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return false;
  }
  let cur = abs;
  for (;;) {
    try {
      const real = await realpath(cur);
      return real === rootReal || real.startsWith(rootReal + sep);
    } catch {
      const parent = resolve(cur, '..');
      if (parent === cur) return false; // hit filesystem root without finding an existing ancestor
      cur = parent;
    }
  }
}

async function exists(abs: string): Promise<boolean> {
  try {
    await readFile(abs);
    return true;
  } catch {
    return false;
  }
}

// Recursively collect file paths (root-relative POSIX) under root/sub; [] if sub is missing.
async function walk(root: string, sub: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) await rec(abs);
      else if (e.isFile()) out.push(relative(root, abs).split(sep).join('/'));
    }
  }
  await rec(join(root, sub));
  return out.sort();
}

async function rootMarkdown(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !INSTRUCTION_FILES.includes(e.name))
    .map((e) => e.name)
    .sort();
}

export async function listControlFiles(root: string): Promise<ControlGroup[]> {
  const instructions: ControlFile[] = [];
  for (const name of INSTRUCTION_FILES) {
    if (await exists(join(root, name))) instructions.push(descriptor(name)!);
  }
  const toFiles = (rels: string[]): ControlFile[] =>
    rels.map(descriptor).filter((f): f is ControlFile => f !== null);

  const skills = toFiles(await walk(root, '.claude/skills'));
  const docs = toFiles([...(await rootMarkdown(root)), ...(await walk(root, 'docs'))]);
  const resources = toFiles(await walk(root, 'resources')); // resources.yaml handled separately

  return [
    { key: 'instructions', label: GROUP_LABELS.instructions, files: instructions },
    { key: 'skills', label: GROUP_LABELS.skills, files: skills },
    { key: 'docs', label: GROUP_LABELS.docs, files: docs },
    { key: 'resources', label: GROUP_LABELS.resources, files: resources },
  ];
}

export async function readControlFile(
  root: string,
  rel: unknown,
): Promise<(ControlFile & { content: string }) | null> {
  const r = await resolveControlPath(root, rel);
  if (!r) return null;
  let content = '';
  try {
    content = await readFile(r.abs, 'utf8');
  } catch {
    content = ''; // not yet created — treat as empty for the editor
  }
  return { ...r.file, content };
}

export async function writeControlFile(root: string, rel: unknown, content: string): Promise<boolean> {
  const r = await resolveControlPath(root, rel);
  if (!r) return false;
  await mkdir(dirname(r.abs), { recursive: true });
  await writeFile(r.abs, content, 'utf8');
  return true;
}

export async function deleteControlFile(
  root: string,
  rel: unknown,
): Promise<'ok' | 'not-allowed' | 'invalid'> {
  const r = await resolveControlPath(root, rel);
  if (!r) return 'invalid';
  if (!r.file.deletable) return 'not-allowed';
  try {
    await rm(r.abs);
  } catch {
    /* already gone */
  }
  return 'ok';
}

function cleanLink(l: unknown): ResourceLink | null {
  if (!l || typeof l !== 'object') return null;
  const o = l as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const url = typeof o.url === 'string' ? o.url.trim() : '';
  const note = typeof o.note === 'string' ? o.note.trim() : '';
  if (!title && !url) return null;
  return note ? { title, url, note } : { title, url };
}

export async function readResources(root: string): Promise<ResourceLink[]> {
  try {
    const raw = await readFile(join(root, RESOURCES_YAML), 'utf8');
    const parsed = parse(raw) as { links?: unknown[] } | null;
    const links = Array.isArray(parsed?.links) ? parsed!.links : [];
    return links.map(cleanLink).filter((l): l is ResourceLink => l !== null);
  } catch {
    return [];
  }
}

export async function writeResources(root: string, links: unknown[]): Promise<void> {
  const clean = Array.isArray(links)
    ? links.map(cleanLink).filter((l): l is ResourceLink => l !== null)
    : [];
  await mkdir(join(root, CONFIG_DIR), { recursive: true });
  await writeFile(join(root, RESOURCES_YAML), stringify({ links: clean }), 'utf8');
}
