import { describe, expect, it } from 'vitest';
import * as coreAutopilot from '../src/core/autopilot.js';
import * as coreState from '../src/core/autopilot-state.js';
import * as coreBackends from '../src/core/backends.js';
import * as coreDiary from '../src/core/diary.js';
import * as coreGate from '../src/core/dispatch-gate.js';
import { skillRel } from '../src/core/layout.js';
import * as coreRuns from '../src/core/runs.js';
import * as coreSkills from '../src/core/skills.js';
import * as core from '../src/core/types.js';
import * as webApi from '../web/src/api.js';
import * as webRuns from '../web/src/runs/viewmodel.js';
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

  // Slice D hand-mirrored six types into web/src/api.ts and extended nothing here. `STOP_REASONS` gained
  // `unreadable` DURING that slice, which is precisely the change this guard exists to catch: the TopBar
  // renders an unknown reason as a raw word with neutral styling, so drift is silent on screen too.
  it('mirrors the auto-pilot state names and stop reasons', () => {
    expect([...webApi.AUTOPILOT_STATES]).toEqual([...coreState.AUTOPILOT_STATES]);
    expect([...webApi.STOP_REASONS]).toEqual([...coreGate.STOP_REASONS]);
  });

  // The rule, not just the list. It had two statements — the server's predicate with no caller, and the
  // TopBar spelling it inline — so the next reason added to the success side would have reached one.
  it('agrees which reasons are a success', () => {
    for (const reason of coreGate.STOP_REASONS) {
      expect(webApi.isSuccessReason(reason), reason).toBe(coreGate.isSuccessReason(reason));
    }
  });

  // The gap slice D's review found, one level in: `AutopilotConfig` is hand-mirrored and nothing
  // guarded its FIELD SET, so a key added on one side is a setting the UI silently cannot show or
  // save. An interface has no runtime keys, so the web side exports the list explicitly.
  it('mirrors the autopilot config keys', () => {
    expect([...web.AUTOPILOT_CONFIG_KEYS].sort()).toEqual(
      Object.keys(coreAutopilot.DEFAULT_AUTOPILOT).sort(),
    );
  });

  it('mirrors the verify modes', () => {
    expect([...web.VERIFY_MODES]).toEqual([...coreAutopilot.VERIFY_MODES]);
  });

  it('mirrors the diary kinds', () => {
    expect([...webApi.DIARY_KINDS]).toEqual([...coreDiary.DIARY_KINDS]);
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
      path: skillRel('x', 'SKILL.md'),
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

  it('agrees on which runs are still asking for a decision', () => {
    // Two sides of one fact: the server decides which runs a closing card resolves, the dashboard
    // decides which ones sit under "Requires attention". If they drift, either a run is cleared that
    // still needs reading, or one stays on the badge with nothing left to clear it.
    for (const status of coreRuns.RUN_STATUSES) {
      const record = { status } as Parameters<typeof coreRuns.needsResolution>[0];
      expect(webRuns.groupOf(status) === 'attention').toBe(coreRuns.needsResolution(record));
    }
  });
});
