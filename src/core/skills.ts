import matter from 'gray-matter';
import { boardColumnSlugs } from './board/columns.js';
import { skillRel } from './layout.js';
import { LIFECYCLE_SKILLS } from './phases.js';
import { slugify } from './slug.js';
import { BOARDS, type BoardName, isBoard, type ProjectConfig } from './types.js';

// A skill is a file: `<skills dir>/<slug>/SKILL.md` (core/layout.ts), frontmatter plus a prompt body.
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
  autopilotOnly: boolean; // hidden from a card's skills
  moveOnSuccess: boolean; // a person's run that succeeds moves its card on
}

// The skills setup starts, as project runs with no card.
export const WIZARD_SKILLS: readonly string[] = ['scan-project', 'suggest-stack'];

// Retired seeds an older project still holds: nothing dispatches them and nothing rewrites a skills folder.
const RETIRED_SKILLS = ['implement', 'review', 'checkup-story'];
const READING_SKILLS = ['research', 'summarise'];

// Defaults by slug rather than keys in every file (decision 94), so a project seeded before the flags existed
// hides the machine's skills with no file rewritten, and a file only carries a flag a person changed.
export function autopilotOnlyByDefault(slug: string): boolean {
  return LIFECYCLE_SKILLS.includes(slug) || WIZARD_SKILLS.includes(slug) || RETIRED_SKILLS.includes(slug);
}

// A reading task changes nothing about where its card stands.
export function moveOnSuccessByDefault(slug: string): boolean {
  return !READING_SKILLS.includes(slug);
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
  return skillRel(slug, 'SKILL.md');
}

// Predicates, not booleans: they narrow, so the caller needs no cast to BoardName. The array form
// is what lets one guard narrow the whole list — filtering afterwards would be a second pass that
// can never remove anything, since the guard has already returned.
function areBoards(values: string[]): values is BoardName[] {
  return values.every(isBoard);
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function asFlag(value: unknown, fallback: boolean): boolean | undefined {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'boolean' ? value : undefined;
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

  const autopilotOnly = asFlag(data.autopilotOnly, autopilotOnlyByDefault(slug));
  if (autopilotOnly === undefined) return bad('autopilotOnly must be true or false');
  const moveOnSuccess = asFlag(data.moveOnSuccess, moveOnSuccessByDefault(slug));
  if (moveOnSuccess === undefined) return bad('moveOnSuccess must be true or false');

  return {
    ok: true,
    skill: { slug, path, name, description, boards, columns, prompt, autopilotOnly, moveOnSuccess },
  };
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
      !s.autopilotOnly &&
      (s.boards.length === 0 || s.boards.includes(board)) &&
      (s.columns.length === 0 || s.columns.includes(columnSlug)),
  );
}

// The fields a skill is authored from. What the editor sends; the file is derived from it, so the
// YAML is written in exactly one place.
export interface SkillFields {
  name: string;
  description: string;
  boards: BoardName[];
  columns: string[];
  prompt: string;
  autopilotOnly: boolean;
  moveOnSuccess: boolean;
}

// Write a skill file from its fields. Empty scoping lists are omitted rather than written as `[]`:
// "every board" is the absence of a restriction, and an empty list reads like a mistake. A flag is written
// only where it differs from its slug's default, so saving an untouched skill leaves its file as it was.
export function serializeSkill(slug: string, fields: SkillFields): string {
  const lines = [`name: ${fields.name.trim()}`, `description: ${fields.description.trim()}`];
  if (fields.boards.length > 0) lines.push(`boards: [${fields.boards.join(', ')}]`);
  if (fields.columns.length > 0) lines.push(`columns: [${fields.columns.join(', ')}]`);
  if (fields.autopilotOnly !== autopilotOnlyByDefault(slug))
    lines.push(`autopilotOnly: ${fields.autopilotOnly}`);
  if (fields.moveOnSuccess !== moveOnSuccessByDefault(slug))
    lines.push(`moveOnSuccess: ${fields.moveOnSuccess}`);
  return `---\n${lines.join('\n')}\n---\n${fields.prompt.trim()}\n`;
}
