import matter from 'gray-matter';
import { boardColumnSlugs } from './board.js';
import { slugify } from './slug.js';
import { BOARDS, type BoardName, type ProjectConfig } from './types.js';

// A skill is a file: `.claude/skills/<slug>/SKILL.md`, frontmatter plus a prompt body.
//
// It carries NO execution knobs — no backend, model, effort or permission mode. A model id
// belongs to exactly one backend (core/backends.ts), so a skill naming one would silently become
// a single-backend skill, and effort/mode are backend-specific enumerations that have already
// caused invalid-value bugs. A skill that wants read-only behaviour says so in its PROMPT: prose
// is portable, enum values are not. Backend, model, effort and mode are chosen per dispatch.

export interface Skill {
  slug: string; // folder name — the skill's id
  path: string; // root-relative POSIX path to its SKILL.md
  name: string;
  description: string;
  boards: BoardName[]; // empty = every board
  columns: string[]; // empty = every column; slugs
  prompt: string; // the body: what the agent is asked to do
}

// An invalid file is not a failure to report loudly — it is a skill that does not appear in the
// rail, with a reason Project Control can show.
export interface InvalidSkill {
  slug: string;
  path: string;
  reason: string;
}

export type SkillParse = { ok: true; skill: Skill } | { ok: false; invalid: InvalidSkill };

export function skillPath(slug: string): string {
  return `.claude/skills/${slug}/SKILL.md`;
}

// Predicates, not booleans: they narrow, so the caller needs no cast to BoardName. The array form
// is what lets one guard narrow the whole list — filtering afterwards would be a second pass that
// can never remove anything, since the guard has already returned.
function isBoard(value: string): value is BoardName {
  return (BOARDS as readonly string[]).includes(value);
}

function areBoards(values: string[]): values is BoardName[] {
  return values.every(isBoard);
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

// The column slugs a skill may name: those configured on the boards it claims, or on every board
// when it claims none.
function allowedColumns(config: ProjectConfig, boards: BoardName[]): string[] {
  const scope = boards.length > 0 ? boards : [...BOARDS];
  return scope.flatMap((board) => boardColumnSlugs(config, board));
}

export function parseSkill(slug: string, content: string, config: ProjectConfig): SkillParse {
  const path = skillPath(slug);
  const bad = (reason: string): SkillParse => ({ ok: false, invalid: { slug, path, reason } });
  const parsed = matter(content);
  const data = parsed.data as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const prompt = parsed.content.trim();
  if (name === '') return bad('needs a name');
  if (description === '') return bad('needs a description');
  if (prompt === '') return bad('needs a prompt — the body is empty');

  // Slugged before comparing, so "Engineering" and "In Progress" work as written.
  const boards = asStrings(data.boards).map(slugify);
  if (!areBoards(boards)) return bad(`unknown board "${boards.find((b) => !isBoard(b))}"`);

  const columns = asStrings(data.columns).map(slugify);
  const allowed = allowedColumns(config, boards);
  const unknownColumn = columns.find((c) => !allowed.includes(c));
  if (unknownColumn !== undefined) return bad(`unknown column "${unknownColumn}"`);

  return { ok: true, skill: { slug, path, name, description, boards, columns, prompt } };
}

// Two files may declare the same name; the path decides. The caller reads the folder in sorted
// order, so "first wins" is deterministic rather than filesystem-dependent.
export function dedupeSkills(parsed: SkillParse[]): { skills: Skill[]; invalid: InvalidSkill[] } {
  const skills: Skill[] = [];
  const invalid: InvalidSkill[] = [];
  const taken = new Map<string, string>(); // slugged name -> the path that claimed it
  for (const entry of parsed) {
    if (!entry.ok) {
      invalid.push(entry.invalid);
      continue;
    }
    const { slug, path, name } = entry.skill;
    const owner = taken.get(slugify(name));
    if (owner !== undefined) {
      invalid.push({ slug, path, reason: `duplicate name "${name}" (already used by ${owner})` });
      continue;
    }
    taken.set(slugify(name), path);
    skills.push(entry.skill);
  }
  return { skills, invalid };
}

// Which skills belong to a card. An empty list means "no restriction", so an unrestricted skill is
// offered everywhere — the common case for a skill the user has not scoped.
export function skillsForCard(skills: Skill[], board: BoardName, columnSlug: string): Skill[] {
  return skills.filter(
    (s) =>
      (s.boards.length === 0 || s.boards.includes(board)) &&
      (s.columns.length === 0 || s.columns.includes(columnSlug)),
  );
}
