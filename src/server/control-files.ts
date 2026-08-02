import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  CONFIG_DIR,
  CONVENTIONS_FILE,
  DOCS_DIR,
  FOUNDATION_FILES,
  foundationRel,
  INSTRUCTIONS_FILE,
  POINTER_FILES,
  RESOURCES_DIR,
  RESOURCES_YAML,
  SKILLS_DIR,
  skillRel,
} from '../core/layout.js';
import { slugify } from '../core/slug.js';
import { resolveInRoot } from './fs-sandbox.js';

// The Project Control tab's file controller. It exposes ONLY the documents that steer the
// models — instructions, skills, docs, resources — behind a hard path sandbox + allow-list so
// a client can never read or write cards, machine state, or anything outside root.

export type ControlCategory = 'instructions' | 'foundation' | 'skills' | 'docs' | 'resources';

export interface ControlFile {
  path: string; // project-root-relative, POSIX
  name: string; // basename for display
  category: ControlCategory;
  managed: boolean; // VibeBoard-managed (copilot-blocked; user edits behind a disclaimer)
  deletable: boolean; // a fixed-name file is never deletable
  renameable: boolean; // nor renameable — the server owns the name, so the UI must not offer to change it
}

export interface ControlGroup {
  key: ControlCategory;
  label: string;
  files: ControlFile[];
  // Whether "+ new" belongs on this group. From the server, because the server is what decides
  // where a new file of each kind goes — the UI used to hardcode `key !== 'instructions'`, which
  // silently offered a + on the next fixed-name category anyone added.
  creatable: boolean;
}

export interface ResourceLink {
  title: string;
  url: string;
  note?: string;
}

// The four fixed instruction files: the two documents inside the config folder, plus the two CLI
// pointer files that must stay at the project root. The instructions document is freely editable;
// the other three are VibeBoard-managed (soft-blocked for the copilot, user-editable behind a
// disclaimer).
const INSTRUCTION_FILES: string[] = [INSTRUCTIONS_FILE, ...POINTER_FILES, CONVENTIONS_FILE];

// The five documents a run is bound by (core/layout.ts). A fixed set like the instruction files, and
// unlike them they are listed whether or not they exist: a missing foundation document is exactly
// what a person needs to click on, and the OS denies this folder to every agent — the chat copilot
// included — so this editor is the only way one gets written by hand.
const FOUNDATION_PATHS: string[] = FOUNDATION_FILES.map((f) => foundationRel(f.name));

// Managed means the copilot is soft-blocked and the user edits behind a disclaimer. The foundation
// documents qualify twice over: they hold the gates a run is judged against, so a model able to
// amend one could lower the bar until its own work passed.
const MANAGED = new Set<string>([...POINTER_FILES, CONVENTIONS_FILE, ...FOUNDATION_PATHS]);

const GROUP_LABELS: Record<ControlCategory, string> = {
  instructions: 'Instructions',
  foundation: 'Foundation',
  skills: 'Skills',
  docs: 'Docs',
  resources: 'Resources',
};

// Classify a root-relative POSIX path into a control category, or null if it is not a control-plane
// path. A pure allow-list: the named subtrees inside the config folder are the content the tab
// steers, and everything else — cards, `config.yaml`, the chat and run stores, the rest of the
// project — falls through to null.
function categoryOf(rel: string): ControlCategory | null {
  if (INSTRUCTION_FILES.includes(rel)) return 'instructions';
  // Enumerated, not `startsWith(FOUNDATION_DIR)`: the set is fixed, so a stray file someone drops in
  // that folder is not a foundation document and must not become editable by being in the right place.
  if (FOUNDATION_PATHS.includes(rel)) return 'foundation';
  if (rel === RESOURCES_YAML) return 'resources';
  if (rel.startsWith(`${SKILLS_DIR}/`)) return 'skills';
  if (rel.startsWith(`${RESOURCES_DIR}/`)) return 'resources';
  if (rel.startsWith(`${DOCS_DIR}/`) && rel.endsWith('.md')) return 'docs';
  return null;
}

// The slug in `<skills dir>/<slug>/…`, or '' for a path that names no skill folder. One home for
// the parsing, so the depth of the skills root is never counted by hand.
function skillSlug(rel: string): string {
  if (!rel.startsWith(`${SKILLS_DIR}/`)) return '';
  return rel.slice(SKILLS_DIR.length + 1).split('/')[0];
}

// A skill is identified by its folder, so the folder is its display name — every skill's file is
// literally called SKILL.md and would be indistinguishable.
function displayName(rel: string, category: ControlCategory): string {
  if (category === 'skills') return skillSlug(rel) || basename(rel);
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
    // Both from the same predicate: a category whose paths the server owns has no user-chosen name
    // to change and no file the user may remove.
    deletable: isCreatable(category),
    renameable: isCreatable(category),
  };
}

// Resolve a client path to an absolute path inside the project root AND an allowed category, or
// null on any violation. The sandbox half (traversal, absolute paths, symlinks escaping the root)
// lives in fs-sandbox.ts and is shared with the Explorer; the allow-list half is this module's own
// and is what keeps Project Control to the documents that steer the models.
export async function resolveControlPath(
  root: string,
  rel: unknown,
): Promise<{ abs: string; file: ControlFile } | null> {
  const resolved = await resolveInRoot(root, rel);
  if (!resolved) return null;
  const file = descriptor(resolved.rel);
  if (!file) return null;
  return { abs: resolved.abs, file };
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
    let entries: Dirent[];
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

export async function listControlFiles(root: string): Promise<ControlGroup[]> {
  const instructions: ControlFile[] = [];
  for (const name of INSTRUCTION_FILES) {
    const file = descriptor(name);
    if (file && (await exists(join(root, name)))) instructions.push(file);
  }
  const toFiles = (rels: string[]): ControlFile[] =>
    rels.map(descriptor).filter((f): f is ControlFile => f !== null);

  // Every one of the five, existing or not — see FOUNDATION_PATHS above.
  const foundation = toFiles(FOUNDATION_PATHS);

  const skills = toFiles(await walk(root, SKILLS_DIR));
  const docs = toFiles(await walk(root, DOCS_DIR));
  const resources = toFiles(await walk(root, RESOURCES_DIR)); // resources.yaml handled separately

  const group = (key: ControlCategory, files: ControlFile[]): ControlGroup => ({
    key,
    label: GROUP_LABELS[key],
    files,
    creatable: isCreatable(key),
  });
  return [
    group('instructions', instructions),
    group('foundation', foundation),
    group('skills', skills),
    group('docs', docs),
    group('resources', resources),
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

// Keyed by the categories a client may create in, so `isCreatable` derives from this table rather
// than from a second list that could drift. Both fixed-name categories are excluded here, and the
// compiler is what says so: adding one to ControlCategory fails this line until its answer is given.
const NEW_NAMES: Record<Exclude<ControlCategory, 'instructions' | 'foundation'>, string> = {
  skills: 'New skill',
  docs: 'New doc',
  resources: 'New resource',
};

type CreatableCategory = keyof typeof NEW_NAMES;

function isCreatable(c: unknown): c is CreatableCategory {
  return typeof c === 'string' && c in NEW_NAMES;
}

// Where a given display name lives, per category. Skills are a folder holding SKILL.md;
// docs and resources are a single markdown file.
function pathForName(category: CreatableCategory, name: string): string {
  // Tolerate a typed extension ("Design notes.md") so it doesn't end up slugged into the
  // filename as "design-notes-md".
  const slug = slugify(name.replace(/\.md$/i, '')) || 'untitled';
  if (category === 'skills') return skillRel(slug, 'SKILL.md');
  return category === 'docs' ? `${DOCS_DIR}/${slug}.md` : `${RESOURCES_DIR}/${slug}.md`;
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
export async function createControlFile(root: string, category: unknown): Promise<ControlFile | null> {
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
    const updated = body.replace(new RegExp(`^(name:\\s*)${oldSlug}\\s*$`, 'm'), `$1${newSlug}`);
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
  if (r.file.category === 'skills') await dropEmptySkillFolder(root, r.file.path);
  return 'ok';
}

// A skill IS its folder — renameControlFile moves the folder rather than SKILL.md for exactly that
// reason — so removing the file used to leave a folder behind that was no longer a skill.
//
// rmdir, not a recursive remove: a skill folder may hold scripts or templates the user put there,
// and deleting SKILL.md is not permission to delete those. A folder that survives because something
// else is in it is simply no longer a skill, and the catalogue ignores it (see skill-catalogue.ts).
async function dropEmptySkillFolder(root: string, rel: string): Promise<void> {
  // Only the skill's own SKILL.md, matched by reconstructing the path it would have: nothing deeper
  // qualifies, so deleting a nested file never removes a directory, and the skills root itself can
  // never be the target.
  const slug = skillSlug(rel);
  if (!slug || rel !== skillRel(slug, 'SKILL.md')) return;
  try {
    await rmdir(join(root, skillRel(slug)));
  } catch {
    /* not empty, or already gone — either way the folder stays and is not a skill */
  }
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
    const rawLinks = parsed?.links;
    const links = Array.isArray(rawLinks) ? rawLinks : [];
    return links.map(cleanLink).filter((l): l is ResourceLink => l !== null);
  } catch {
    return [];
  }
}

export async function writeResources(root: string, links: unknown[]): Promise<void> {
  const clean = Array.isArray(links) ? links.map(cleanLink).filter((l): l is ResourceLink => l !== null) : [];
  await mkdir(join(root, CONFIG_DIR), { recursive: true });
  await writeFile(join(root, RESOURCES_YAML), stringify({ links: clean }), 'utf8');
}
