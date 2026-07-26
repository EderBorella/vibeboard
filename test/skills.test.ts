import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import {
  dedupeSkills,
  parseSkill,
  type Skill,
  type SkillParse,
  serializeSkill,
  skillPath,
  skillsForCard,
} from '../src/core/skills.js';

const config = defaultConfig('T');

const file = (fm: string, body = 'Do the thing.'): string => `---\n${fm}\n---\n${body}\n`;

describe('parseSkill', () => {
  it('reads a valid skill, deriving its path from the folder', () => {
    const r = parseSkill('execute', file('name: Execute\ndescription: Implement the card'), config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skill).toEqual({
      slug: 'execute',
      path: '.claude/skills/execute/SKILL.md',
      name: 'Execute',
      description: 'Implement the card',
      boards: [],
      columns: [],
      prompt: 'Do the thing.',
    });
  });

  it('states the path a slug lives at', () => {
    expect(skillPath('break-down')).toBe('.claude/skills/break-down/SKILL.md');
  });

  it.each([
    ['description: only', 'needs a name'],
    ['name: Execute', 'needs a description'],
    ['name: "   "\ndescription: x', 'needs a name'],
    ['name: Execute\ndescription: "  "', 'needs a description'],
  ])('rejects %s', (fm, reason) => {
    const r = parseSkill('execute', file(fm), config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.invalid).toEqual({ slug: 'execute', path: skillPath('execute'), reason });
  });

  it('rejects an empty prompt: a skill with no body dispatches nothing', () => {
    const r = parseSkill('execute', file('name: Execute\ndescription: x', '   \n'), config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.invalid.reason).toBe('needs a prompt — the body is empty');
  });

  it('names the offending board rather than failing vaguely', () => {
    const r = parseSkill('x', file('name: N\ndescription: D\nboards: [engineering, backlog]'), config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.invalid.reason).toBe('unknown board "backlog"');
  });

  it('names the offending column, checked against the boards the skill claims', () => {
    // `review` is configured on engineering only (src/core/config.ts DEFAULT_COLUMNS), so a
    // product-only skill asking for it is wrong even though the slug exists elsewhere.
    const r = parseSkill('x', file('name: N\ndescription: D\nboards: [product]\ncolumns: [review]'), config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.invalid.reason).toBe('unknown column "review"');
  });

  it('checks columns against every board when the skill claims none', () => {
    const r = parseSkill('x', file('name: N\ndescription: D\ncolumns: [review]'), config);
    expect(r.ok).toBe(true);
  });

  it('slugs what the user wrote, so display names work as written', () => {
    const r = parseSkill(
      'x',
      file('name: N\ndescription: D\nboards: [Engineering]\ncolumns: ["In Progress"]'),
      config,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skill.boards).toEqual(['engineering']);
    expect(r.skill.columns).toEqual(['in-progress']);
  });

  it('ignores a non-list boards value rather than crashing on it', () => {
    const r = parseSkill('x', file('name: N\ndescription: D\nboards: engineering'), config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skill.boards).toEqual([]);
  });

  it('keeps no execution knobs, even when the file names them', () => {
    // Decision 3 of the spec: a model id belongs to one backend, so a skill that carried one
    // would silently become a single-backend skill. Anything extra in the frontmatter is dropped.
    const r = parseSkill(
      'x',
      file('name: N\ndescription: D\nmodel: opus\neffort: high\nbackend: opencode'),
      config,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.skill).sort()).toEqual([
      'boards',
      'columns',
      'description',
      'name',
      'path',
      'prompt',
      'slug',
    ]);
  });
});

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: 'execute',
  path: '.claude/skills/execute/SKILL.md',
  name: 'Execute',
  description: 'd',
  boards: [],
  columns: [],
  prompt: 'p',
  ...over,
});
const ok = (s: Skill): SkillParse => ({ ok: true, skill: s });

describe('dedupeSkills', () => {
  it('keeps valid skills and collects invalid ones separately', () => {
    const a = skill();
    const bad = { slug: 'b', path: skillPath('b'), reason: 'needs a name' };
    const r = dedupeSkills([ok(a), { ok: false, invalid: bad }]);
    expect(r.skills).toEqual([a]);
    expect(r.invalid).toEqual([bad]);
  });

  it('lets the first of a duplicated name win, and says who took it', () => {
    const first = skill({ slug: 'execute' });
    const second = skill({ slug: 'run-it', path: skillPath('run-it') });
    const r = dedupeSkills([ok(first), ok(second)]);
    expect(r.skills).toEqual([first]);
    expect(r.invalid).toEqual([
      {
        slug: 'run-it',
        path: skillPath('run-it'),
        reason: 'duplicate name "Execute" (already used by .claude/skills/execute/SKILL.md)',
      },
    ]);
  });

  it('treats names that differ only in case or spacing as the same name', () => {
    const r = dedupeSkills([ok(skill()), ok(skill({ slug: 'b', path: skillPath('b'), name: 'execute' }))]);
    expect(r.skills).toHaveLength(1);
    expect(r.invalid).toHaveLength(1);
  });

  it('keeps two genuinely different names', () => {
    const r = dedupeSkills([
      ok(skill()),
      ok(skill({ slug: 'review', path: skillPath('review'), name: 'Review' })),
    ]);
    expect(r.skills.map((s) => s.name)).toEqual(['Execute', 'Review']);
    expect(r.invalid).toEqual([]);
  });
});

describe('skillsForCard', () => {
  const anywhere = skill({ slug: 'anywhere', name: 'Anywhere' });
  const engOnly = skill({ slug: 'eng', name: 'Eng', boards: ['engineering'] });
  const todoOnly = skill({ slug: 'todo', name: 'Todo', columns: ['todo'] });
  const engTodo = skill({ slug: 'both', name: 'Both', boards: ['engineering'], columns: ['todo'] });
  const all = [anywhere, engOnly, todoOnly, engTodo];

  it('offers an unrestricted skill everywhere', () => {
    expect(skillsForCard([anywhere], 'product', 'backlog')).toEqual([anywhere]);
  });

  it('restricts by board', () => {
    expect(skillsForCard(all, 'engineering', 'todo').map((s) => s.name)).toEqual([
      'Anywhere',
      'Eng',
      'Todo',
      'Both',
    ]);
    expect(skillsForCard(all, 'product', 'todo').map((s) => s.name)).toEqual(['Anywhere', 'Todo']);
  });

  it('restricts by column', () => {
    expect(skillsForCard(all, 'engineering', 'done').map((s) => s.name)).toEqual(['Anywhere', 'Eng']);
  });

  it('requires both to match when both are declared', () => {
    expect(skillsForCard([engTodo], 'product', 'todo')).toEqual([]);
    expect(skillsForCard([engTodo], 'engineering', 'done')).toEqual([]);
  });

  it('keeps the order it was given', () => {
    expect(skillsForCard([engOnly, anywhere], 'engineering', 'todo').map((s) => s.name)).toEqual([
      'Eng',
      'Anywhere',
    ]);
  });
});

describe('serializeSkill', () => {
  it('round-trips through parseSkill', () => {
    const text = serializeSkill({
      name: 'Execute',
      description: 'Implement the card',
      boards: ['engineering'],
      columns: ['todo', 'in-progress'],
      prompt: 'Do the work.\n\nCarefully.',
    });
    const parsed = parseSkill('execute', text, config);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skill).toEqual({
      slug: 'execute',
      path: '.claude/skills/execute/SKILL.md',
      name: 'Execute',
      description: 'Implement the card',
      boards: ['engineering'],
      columns: ['todo', 'in-progress'],
      prompt: 'Do the work.\n\nCarefully.',
    });
  });

  it('omits an empty scope rather than writing an empty list', () => {
    // "Every board" is the absence of a restriction; `boards: []` reads like a mistake, and a reader
    // of the file should not have to know they mean the same thing.
    const text = serializeSkill({
      name: 'N',
      description: 'D',
      boards: [],
      columns: [],
      prompt: 'P',
    });
    expect(text).toBe('---\nname: N\ndescription: D\n---\nP\n');
  });

  it('trims what it is given', () => {
    const text = serializeSkill({
      name: '  N  ',
      description: '  D  ',
      boards: [],
      columns: [],
      prompt: '\n  P  \n',
    });
    expect(text).toBe('---\nname: N\ndescription: D\n---\nP\n');
  });
});
