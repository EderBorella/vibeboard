import type { FastifyInstance } from 'fastify';
import {
  autopilotOnlyByDefault,
  moveOnSuccessByDefault,
  type SkillFields,
  serializeSkill,
  skillPath,
} from '../../core/skills.js';
import { type BoardName, isBoard } from '../../core/types.js';
import { writeControlFile } from '../../store/project/control-files.js';
import { readSkills } from '../../store/project/skill-catalogue.js';
import { type AppCtx, ensureOpen } from '../route-context.js';

// The fields an editor sends. Validated here rather than trusted: this writes a file that decides
// what the rail offers, and a bad board name would make the skill vanish from it.
function toFields(body: unknown, slug: string): SkillFields | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (name === '') return 'A skill needs a name';
  if (description === '') return 'A skill needs a description';
  if (prompt === '') return 'A skill needs a prompt';
  const asList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((v) => String(v).trim()).filter((v) => v !== '') : [];
  const boards = asList(b.boards);
  const unknown = boards.find((x) => !isBoard(x));
  if (unknown !== undefined) return `Unknown board "${unknown}"`;
  // Absent keeps the slug's default, so a caller that knows nothing of the flags changes neither.
  const autopilotOnly = b.autopilotOnly ?? autopilotOnlyByDefault(slug);
  const moveOnSuccess = b.moveOnSuccess ?? moveOnSuccessByDefault(slug);
  if (typeof autopilotOnly !== 'boolean' || typeof moveOnSuccess !== 'boolean') {
    return 'autopilotOnly and moveOnSuccess must be true or false';
  }
  const columns = asList(b.columns);
  return { name, description, boards: boards as BoardName[], columns, prompt, autopilotOnly, moveOnSuccess };
}

// The skill catalogue. Read from disk per request rather than cached: the user (or an agent) can
// write a SKILL.md at any moment, and a stale rail is worse than a readdir.
export async function registerSkillRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/skills', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return readSkills(ctx.session.root, ctx.session.config);
  });

  // Write a skill from its fields. The YAML is serialised here, never in the browser, so there is one
  // place that knows the file format — and it goes through the control-file sandbox, so a slug can
  // never escape the skills folder.
  api.put('/skills/:slug', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { slug } = req.params as { slug: string };
    const fields = toFields(req.body, slug);
    if (typeof fields === 'string') return reply.code(400).send({ error: fields });
    const ok = await writeControlFile(ctx.session.root, skillPath(slug), serializeSkill(slug, fields));
    if (!ok) return reply.code(400).send({ error: 'Path not allowed' });
    // The catalogue back, so the caller sees the skill as the server now reads it — including a
    // validation failure the fields alone could not predict, like a column that does not exist.
    return readSkills(ctx.session.root, ctx.session.config);
  });
}
