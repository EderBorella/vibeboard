import { describe, expect, it } from 'vitest';
import * as coreBackends from '../src/core/backends.js';
import * as coreSkills from '../src/core/skills.js';
import * as core from '../src/core/types.js';
import * as web from '../web/src/shared.js';
import * as webSkills from '../web/src/skills/filter.js';

// web/src/shared.ts hand-mirrors the server's wire contract across the tsc/Vite boundary
// (the two sides need different module resolution — see the cleanup plan, section E).
// The mirror is deliberate; silent drift is not. These assertions are the guard rail.
describe('web/shared mirrors src/core', () => {
  it('mirrors the board list and labels', () => {
    expect([...web.BOARDS]).toEqual([...core.BOARDS]);
    expect(web.BOARD_LABELS).toEqual(core.BOARD_LABELS);
  });

  it('mirrors the backend defaults', () => {
    expect(web.DEFAULT_BACKEND).toBe(coreBackends.DEFAULT_BACKEND);
    expect(web.BACKEND_DEFAULTS).toEqual(coreBackends.BACKEND_DEFAULTS);
  });

  it('resolves an unknown backend the same way on both sides', () => {
    expect(web.backendDefaults('nonsense')).toEqual(coreBackends.backendDefaults('nonsense'));
    expect(web.backendDefaults(undefined)).toEqual(coreBackends.backendDefaults(undefined));
  });

  it('filters skills to a card identically on both sides', () => {
    // The web bundle cannot import server core, so the scoping rule exists twice. This is what
    // stops the copies drifting: one table of cases, both implementations, same answers.
    const s = (over: Partial<coreSkills.Skill>): coreSkills.Skill => ({
      slug: 'x',
      path: '.claude/skills/x/SKILL.md',
      name: 'X',
      description: 'd',
      boards: [],
      columns: [],
      prompt: 'p',
      ...over,
    });
    const all = [
      s({ slug: 'anywhere' }),
      s({ slug: 'eng', boards: ['engineering'] }),
      s({ slug: 'todo', columns: ['todo'] }),
      s({ slug: 'both', boards: ['engineering'], columns: ['todo'] }),
      s({ slug: 'multi', boards: ['product', 'features'], columns: ['backlog', 'todo'] }),
    ];
    for (const board of core.BOARDS) {
      for (const column of ['todo', 'backlog', 'in-progress', 'review', 'done', 'nonsense']) {
        expect(webSkills.skillsForCard(all, board, column).map((x) => x.slug)).toEqual(
          coreSkills.skillsForCard(all, board, column).map((x) => x.slug),
        );
      }
    }
  });
});
