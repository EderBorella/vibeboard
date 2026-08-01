import { describe, expect, it } from 'vitest';
import { skillRel } from '../src/core/layout.js';
import type { Skill } from '../web/src/api.js';
import { skillsForCard } from '../web/src/skills/filter.js';

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: 's',
  path: skillRel('s', 'SKILL.md'),
  name: 'S',
  description: 'd',
  boards: [],
  columns: [],
  prompt: 'p',
  ...over,
});

describe('skillsForCard (web)', () => {
  it('offers an unrestricted skill on any card', () => {
    expect(skillsForCard([skill()], 'product', 'backlog')).toHaveLength(1);
  });

  it('restricts by board', () => {
    const s = [skill({ boards: ['engineering'] })];
    expect(skillsForCard(s, 'engineering', 'todo')).toHaveLength(1);
    expect(skillsForCard(s, 'product', 'todo')).toHaveLength(0);
  });

  it('restricts by column', () => {
    const s = [skill({ columns: ['todo'] })];
    expect(skillsForCard(s, 'product', 'todo')).toHaveLength(1);
    expect(skillsForCard(s, 'product', 'done')).toHaveLength(0);
  });

  it('requires both when both are declared', () => {
    const s = [skill({ boards: ['engineering'], columns: ['todo'] })];
    expect(skillsForCard(s, 'engineering', 'todo')).toHaveLength(1);
    expect(skillsForCard(s, 'engineering', 'done')).toHaveLength(0);
    expect(skillsForCard(s, 'product', 'todo')).toHaveLength(0);
  });
});
