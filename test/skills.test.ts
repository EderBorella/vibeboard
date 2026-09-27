import { describe, expect, it } from 'vitest';
import { skillRel } from '../src/core/layout.js';
import {
  dedupeSkills,
  parseSkill,
  type Skill,
  type SkillParse,
  serializeSkill,
  skillPath,
  skillsForCard,
} from '../src/core/skills.js';
import { defaultConfig } from '../src/store/project/config.js';

const config = defaultConfig('T');

const file = (fm: string, body = 'Do the thing.'): string => `---\n${fm}\n---\n${body}\n`;

describe('parseSkill', () => {
  it('reads a valid skill, deriving its path from the folder', () => {
    const r = parseSkill('execute', file('name: Execute\ndescription: Implement the card'), config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skill).toEqual({
      slug: 'execute',
      path: skillRel('execute', 'SKILL.md'),
      name: 'Execute',
      description: 'Implement the card',
      boards: [],
      columns: [],
      prompt: 'Do the thing.',
      autopilotOnly: false,
      movesCard: true,
    });
  });

  it('states the path a slug lives at', () => {
    expect(skillPath('break-down')).toBe(skillRel('break-down', 'SKILL.md'));
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
    // `review` is configured on engineering only (src/store/project/config.ts DEFAULT_COLUMNS), so a
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
      'autopilotOnly',
      'boards',
      'columns',
      'description',
      'movesCard',
      'name',
      'path',
      'prompt',
      'slug',
    ]);
  });
});

describe('the two running flags', () => {
  const flags = (slug: string, fm = '') => {
    const r = parseSkill(slug, file(`name: N\ndescription: D${fm}`), config);
    return r.ok ? { autopilotOnly: r.skill.autopilotOnly, movesCard: r.skill.movesCard } : r.invalid.reason;
  };

  // An older project's files carry neither key, so what they mean comes from the slug.
  it.each([
    ['fix', { autopilotOnly: true, movesCard: true }],
    ['scan-project', { autopilotOnly: true, movesCard: true }],
    ['checkup-story', { autopilotOnly: true, movesCard: true }],
    ['execute', { autopilotOnly: false, movesCard: true }],
    ['research', { autopilotOnly: false, movesCard: true }],
  ])('gives %s its slug default when the file says nothing', (slug, expected) => {
    expect(flags(slug)).toEqual(expected);
  });

  it('lets the file overrule the default either way', () => {
    expect(flags('fix', '\nautopilotOnly: false\nmovesCard: false')).toEqual({
      autopilotOnly: false,
      movesCard: false,
    });
    expect(flags('execute', '\nautopilotOnly: true')).toEqual({ autopilotOnly: true, movesCard: true });
  });

  it('refuses a flag that is not true or false', () => {
    expect(flags('execute', '\nautopilotOnly: sometimes')).toBe('autopilotOnly must be true or false');
    expect(flags('execute', '\nmovesCard: 1')).toBe('movesCard must be true or false');
  });
});

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: 'execute',
  path: skillRel('execute', 'SKILL.md'),
  name: 'Execute',
  description: 'd',
  boards: [],
  columns: [],
  prompt: 'p',
  autopilotOnly: false,
  movesCard: true,
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
        reason: `duplicate name "Execute" (already used by ${skillRel('execute', 'SKILL.md')})`,
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
  // Two columns, both configured on the board this skill claims: parseSkill validates `columns:`
  // against that board's config, so a scope naming a column engineering does not have would come
  // back invalid and test the rejection path instead of the round trip.
  it('round-trips through parseSkill', () => {
    const text = serializeSkill('execute', {
      name: 'Execute',
      description: 'Implement the card',
      boards: ['engineering'],
      columns: ['in-progress', 'review'],
      prompt: 'Do the work.\n\nCarefully.',
      autopilotOnly: false,
      movesCard: true,
    });
    const parsed = parseSkill('execute', text, config);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skill).toEqual({
      slug: 'execute',
      path: skillRel('execute', 'SKILL.md'),
      name: 'Execute',
      description: 'Implement the card',
      boards: ['engineering'],
      columns: ['in-progress', 'review'],
      prompt: 'Do the work.\n\nCarefully.',
      autopilotOnly: false,
      movesCard: true,
    });
  });

  it('omits an empty scope rather than writing an empty list', () => {
    // "Every board" is the absence of a restriction; `boards: []` reads like a mistake, and a reader
    // of the file should not have to know they mean the same thing.
    const text = serializeSkill('x', {
      name: 'N',
      description: 'D',
      boards: [],
      columns: [],
      prompt: 'P',
      autopilotOnly: false,
      movesCard: true,
    });
    expect(text).toBe('---\nname: N\ndescription: D\n---\nP\n');
  });

  it('trims what it is given', () => {
    const text = serializeSkill('x', {
      name: '  N  ',
      description: '  D  ',
      boards: [],
      columns: [],
      prompt: '\n  P  \n',
      autopilotOnly: false,
      movesCard: true,
    });
    expect(text).toBe('---\nname: N\ndescription: D\n---\nP\n');
  });

  // Written only where it differs from the slug's default, so an untouched skill saves byte for byte.
  it.each([
    ['fix', true, true, ''],
    ['fix', false, true, 'autopilotOnly: false\n'],
    ['execute', true, false, 'autopilotOnly: true\nmovesCard: false\n'],
  ])('writes %s with autopilotOnly %s and movesCard %s', (slug, autopilotOnly, movesCard, keys) => {
    const text = serializeSkill(slug, {
      name: 'N',
      description: 'D',
      boards: [],
      columns: [],
      prompt: 'P',
      autopilotOnly,
      movesCard,
    });
    expect(text).toBe(`---\nname: N\ndescription: D\n${keys}---\nP\n`);
  });
});
