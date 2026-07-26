import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { parseSkill, skillPath } from '../src/core/skills.js';

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
