import { readFile, writeFile, readdir, mkdir, rm, rename, realpath } from 'node:fs/promises';
import { resolve, relative, join, dirname, basename, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import { CONFIG_DIR } from '../core/config.js';
import { slugify } from '../core/slug.js';

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

// A skill is identified by its folder (`.claude/skills/<name>/SKILL.md`), so the folder is its
// display name — every skill's file is literally called SKILL.md and would be indistinguishable.
function displayName(rel: string, category: ControlCategory): string {
  if (category === 'skills') {
    const parts = rel.split('/');
    return parts[2] ?? basename(rel); // .claude/skills/<name>/...
  }
  return basename(rel);
}

function descriptor(rel: string): ControlFile | null {
  const category = categoryOf(rel);
  if (!category) return null;
  return {
    path: rel,
    name: displayName(rel, category),
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

// --- Creating and renaming -------------------------------------------------
// The client never builds paths: it asks for "a new skill" or "rename this to X" and the server
// owns slugging, collision handling, and the per-category layout.

const NEW_NAMES: Record<Exclude<ControlCategory, 'instructions'>, string> = {
  skills: 'New skill',
  docs: 'New doc',
  resources: 'New resource',
};

export type CreatableCategory = keyof typeof NEW_NAMES;

export function isCreatable(c: unknown): c is CreatableCategory {
  return typeof c === 'string' && c in NEW_NAMES;
}

// Where a given display name lives, per category. Skills are a folder holding SKILL.md;
// docs and resources are a single markdown file.
function pathForName(category: CreatableCategory, name: string): string {
  // Tolerate a typed extension ("Design notes.md") so it doesn't end up slugged into the
  // filename as "design-notes-md".
  const slug = slugify(name.replace(/\.md$/i, '')) || 'untitled';
  if (category === 'skills') return `.claude/skills/${slug}/SKILL.md`;
  return category === 'docs' ? `docs/${slug}.md` : `resources/${slug}.md`;
}

// What a rename must not clobber: the skill's folder, or the file itself.
function occupiedPath(root: string, category: CreatableCategory, name: string): string {
  const rel = pathForName(category, name);
  return join(root, category === 'skills' ? dirname(rel) : rel);
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await readdir(abs);
    return true; // a directory
  } catch {
    try {
      await readFile(abs);
      return true; // a file
    } catch {
      return false;
    }
  }
}

// "New doc" -> "New doc 2" -> "New doc 3" … so clicking + repeatedly never collides.
async function freeName(root: string, category: CreatableCategory, base: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    if (!(await pathExists(occupiedPath(root, category, candidate)))) return candidate;
  }
  throw new Error('Could not find a free name');
}

function starterContent(category: CreatableCategory, name: string): string {
  if (category === 'skills') {
    // Frontmatter is what makes a skill discoverable by both CLIs; the name mirrors the folder.
    return `---\nname: ${slugify(name)}\ndescription: What this skill does and when to use it.\n---\n\n# ${name}\n\nDescribe the steps here.\n`;
  }
  return `# ${name}\n\n`;
}

// Create a new file with a default, collision-free name. The UI then lets the user rename it
// in place — no browser dialog, and the file exists immediately either way.
export async function createControlFile(
  root: string,
  category: unknown,
): Promise<ControlFile | null> {
  if (!isCreatable(category)) return null;
  const name = await freeName(root, category, NEW_NAMES[category]);
  const rel = pathForName(category, name);
  const r = await resolveControlPath(root, rel);
  if (!r) return null;
  await mkdir(dirname(r.abs), { recursive: true });
  await writeFile(r.abs, starterContent(category, name), 'utf8');
  return r.file;
}

// Rename by display name, staying inside the same category. Renames the skill's folder (not
// SKILL.md) so the skill keeps its identity. Returns null on a bad path, 'taken' on collision.
export async function renameControlFile(
  root: string,
  rel: unknown,
  newName: unknown,
): Promise<ControlFile | 'taken' | null> {
  const current = await resolveControlPath(root, rel);
  if (!current) return null;
  const category = current.file.category;
  if (!isCreatable(category)) return null; // instruction files are not renameable
  if (typeof newName !== 'string' || !slugify(newName.replace(/\.md$/i, ''))) return null;

  const targetRel = pathForName(category, newName);
  if (targetRel === current.file.path) return current.file; // unchanged
  const target = await resolveControlPath(root, targetRel);
  if (!target) return null;
  if (await pathExists(occupiedPath(root, category, newName))) return 'taken';

  if (category === 'skills') {
    await rename(dirname(current.abs), dirname(target.abs));
    // Keep the skill's frontmatter name in step, but only when it still matches the folder we
    // renamed away from — never overwrite a name the user chose themselves.
    await syncSkillName(target.abs, basename(dirname(current.abs)), basename(dirname(target.abs)));
  } else {
    await mkdir(dirname(target.abs), { recursive: true });
    await rename(current.abs, target.abs);
  }
  return target.file;
}

async function syncSkillName(abs: string, oldSlug: string, newSlug: string): Promise<void> {
  try {
    const body = await readFile(abs, 'utf8');
    const updated = body.replace(
      new RegExp(`^(name:\\s*)${oldSlug}\\s*$`, 'm'),
      `$1${newSlug}`,
    );
    if (updated !== body) await writeFile(abs, updated, 'utf8');
  } catch {
    /* no SKILL.md yet, or unreadable — the folder rename already succeeded */
  }
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
