import { describe, expect, it } from 'vitest';
import * as coreAutopilot from '../src/core/autopilot.js';
import * as coreState from '../src/core/autopilot-state.js';
import * as coreBackends from '../src/core/backends.js';
import * as coreDiary from '../src/core/diary.js';
import * as coreGate from '../src/core/dispatch-gate.js';
import { skillRel } from '../src/core/layout.js';
import * as coreRuns from '../src/core/runs.js';
import * as coreSkills from '../src/core/skills.js';
import * as coreSuggestions from '../src/core/suggestions.js';
import * as core from '../src/core/types.js';
import * as serverSnapshot from '../src/server/boards/snapshot.js';
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

  // The Settings hint names these boards on screen, and it named the wrong set for as long as engineering
  // was the only one: a claim a person reads is exactly where drift is least visible and least forgivable.
  it('mirrors which boards a card can be left blocked on', () => {
    expect([...web.BLOCKED_BOARDS]).toEqual([...coreAutopilot.BLOCKED_BOARDS]);
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

  // The drift this slice shipped and nothing caught: the server's RunRecord gained `verification`,
  // `score` and `overshoot`, and the hand-mirror gained none — so the verdict decision 18 wants
  // reviewable existed on disk and in no UI type. Exact rather than "web ⊆ core": a field the UI
  // deliberately does not carry has to SAY so, or the next one slips through as deliberate too.
  it('mirrors every run-record field, or declares why not', () => {
    expect([...webApi.RUN_RECORD_KEYS, ...webApi.RUN_RECORD_NOT_MIRRORED].sort()).toEqual(
      [...coreRuns.RUN_RECORD_KEYS].sort(),
    );
  });

  // A NEW guard, and it CREATES cover rather than extending it: there was no card-frontmatter mirror at
  // all, so `setup` had already reached the wire with the web type carrying it only by luck. Exact rather
  // than "web ⊆ core", for the same reason as the run record: a field the UI deliberately does not carry
  // has to SAY so, or the next one slips through as deliberate too.
  it('mirrors every card frontmatter field, or declares why not', () => {
    expect([...web.CARD_FIELDS, ...web.CARD_FIELDS_NOT_MIRRORED].sort()).toEqual(
      [...core.CARD_FRONTMATTER_KEYS].sort(),
    );
  });

  // A NEW guard: there was no snapshot mirror at all, and the snapshot is what every tile renders from.
  // It DECLARES the pre-existing drift rather than failing on it — `problems` has never been on the web
  // side — because a gate that must be bypassed on the day it is written teaches everyone to bypass it.
  // Same shape as RUN_RECORD_NOT_MIRRORED: the absent fields are listed, so the next omission still fails.
  it('mirrors every snapshot field, or declares why not', () => {
    expect([...web.SNAPSHOT_FIELDS, ...web.SNAPSHOT_NOT_MIRRORED].sort()).toEqual(
      [...serverSnapshot.SNAPSHOT_KEYS].sort(),
    );
  });

  // NEW, like the snapshot guard above it: nothing in the browser could read a suggestion at all, so the
  // web side carried no `Suggestion` type — only the per-card count on the snapshot.
  it('mirrors the suggestion states', () => {
    expect([...web.SUGGESTION_STATES]).toEqual([...coreSuggestions.SUGGESTION_STATES]);
  });

  it('mirrors every suggestion field, or declares why not', () => {
    expect([...web.SUGGESTION_FIELDS, ...web.SUGGESTION_NOT_MIRRORED].sort()).toEqual(
      [...coreSuggestions.SUGGESTION_KEYS].sort(),
    );
  });

  it('declares problems as not mirrored, with a reason', () => {
    expect([...web.SNAPSHOT_NOT_MIRRORED]).toContain('problems');
  });

  it('mirrors the diary entry bound', () => {
    expect(web.MAX_ENTRY_TEXT).toBe(coreDiary.MAX_ENTRY_TEXT);
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
