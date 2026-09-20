import { describe, expect, it } from 'vitest';
import { LIFECYCLE_SKILLS, PHASES, phase, phaseForRun } from '../src/core/phases.js';

describe('the phase table', () => {
  it('names every phase exactly once', () => {
    const names = PHASES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('stamps a feature into todo on entry and in-progress on exit', () => {
    expect(phase('feature-breakdown')).toMatchObject({
      board: 'features',
      entry: 'todo',
      exitPass: 'in-progress',
      skill: 'break-down',
      creates: 'product',
    });
  });

  // DECISION 83, AS THE TABLE STATES IT. The work is the STORY's: it runs on product, where the judgement
  // already is, and the tasks under it are what one run is asked for rather than what N runs are dispatched
  // against.
  it('runs the implement on the story, where the judgement already is', () => {
    expect(phase('story-implement')).toMatchObject({
      board: 'product',
      entry: 'in-progress',
      // The column the judgement reads. A story is already standing in it, so neither stamp is written —
      // both are declared for the day the derivation changes.
      exitPass: 'in-progress',
      skill: 'implement-story',
      bounded: 'skill',
    });
    // No `creates`: an implement run has no board to create cards on, and the endpoint reads this.
    expect(phase('story-implement').creates).toBeUndefined();
  });

  // The union is the load-bearing half, exactly as it was for the per-task judgement: a `task-implement`
  // left in the table would be a second place a task could be dispatched from, which is the cost this
  // removes. `phaseForRun` below is what would resolve it.
  it('has no per-task phase at all', () => {
    const names: string[] = PHASES.map((p) => p.name);
    expect(names).not.toContain('task-implement');
    expect(names).not.toContain('task-fix');
    expect(PHASES.filter((p) => p.board === 'engineering')).toEqual([]);
  });

  // DECISION 80, AS THE TABLE STATES IT. The union is the load-bearing half: a `task-review` left in it
  // would mean two judgements on one story's work, which is the cost this removes.
  it('has no per-task judgement at all', () => {
    const names: string[] = PHASES.map((p) => p.name);
    expect(names).not.toContain('task-review');
    expect(names).not.toContain('task-review-remove');
    expect(names).not.toContain('story-checkup');
    expect(PHASES.filter((p) => p.bounded === 'review').map((p) => p.name)).toEqual(['story-review']);
  });

  it('sends a story back to in-progress and forward to done from its judgement', () => {
    expect(phase('story-review')).toMatchObject({
      board: 'product',
      exitPass: 'done',
      exitFail: 'in-progress',
      skill: 'review-story',
      // It keeps the checkup's authority to write sibling stories (decision 47).
      creates: 'product',
      bounded: 'review',
    });
    // No entry stamp: it runs where the story already stands, and a move to where it is would be a write
    // for nothing.
    expect(phase('story-review').entry).toBeUndefined();
  });

  // A SEND-BACK NEEDS SOMEWHERE TO GO, and since decision 83 it is the only fix row there is. Without it a
  // refused story sits settled in `in-progress` carrying a failed verdict, and every later tick re-stamps
  // it to where it already is.
  it('answers a sent-back story with a fix that does not close it', () => {
    expect(phase('story-fix')).toMatchObject({ board: 'product', skill: 'fix', bounded: 'skill' });
    expect(phase('story-fix').exitPass).toBeUndefined();
    expect(phase('story-fix').entry).toBeUndefined();
  });

  it('has no skill for the phases the loop carries out alone', () => {
    for (const name of ['feature-breakdown-skip', 'story-breakdown-skip'] as const) {
      expect(phase(name).skill, name).toBeUndefined();
    }
  });

  it('gives the bootstrap no board and no stamps', () => {
    expect(phase('bootstrap')).toMatchObject({ skill: 'derive-features', creates: 'features' });
    expect(phase('bootstrap').board).toBeUndefined();
    expect(phase('bootstrap').entry).toBeUndefined();
  });

  it('bounds every dispatching phase', () => {
    for (const p of PHASES) {
      if (p.skill === undefined) expect(p.bounded, p.name).toBe('none');
      else expect(p.bounded, p.name).not.toBe('none');
    }
  });

  it('derives the lifecycle skill list from the table', () => {
    expect([...LIFECYCLE_SKILLS].sort()).toEqual([
      'break-down',
      'checkup-feature',
      'derive-features',
      'fix',
      'implement-story',
      'review-story',
    ]);
  });

  // A stamp naming a column that board does not have is a card moved into a folder no column maps to —
  // the phantom-folder class (`knownColumn` in src/store/cards/mutations.ts). Named by symbol: this cited
  // `src/core/mutations.ts:35-37`, and those lines had already drifted off the comment they meant.
  it('stamps only columns the default boards have', () => {
    const columns: Record<string, string[]> = {
      features: ['backlog', 'todo', 'in-progress', 'done'],
      product: ['backlog', 'todo', 'in-progress', 'done'],
      engineering: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
    };
    for (const p of PHASES) {
      if (!p.board) continue;
      for (const slug of [p.entry, p.exitPass, p.exitFail]) {
        if (slug !== undefined) expect(columns[p.board], `${p.name} ${slug}`).toContain(slug);
      }
    }
  });
});

describe('phaseForRun', () => {
  // THE ONE THAT MATTERS: one skill, two phases, two different `creates`.
  it('resolves break-down on features to feature-breakdown, and on product to story-breakdown', () => {
    expect(phaseForRun('break-down', 'features')?.creates).toBe('product');
    expect(phaseForRun('break-down', 'product')?.creates).toBe('engineering');
  });
  // AND `fix` ON ENGINEERING IS NOBODY'S PHASE since decision 83 took the per-task one out. The skill is
  // still seeded there for a person to dispatch by hand, and `isWorkRun` in bounds.ts reads this — so a
  // hand-run fix on a task is not a run any story's verdict can land on.
  it('resolves fix on product to story-fix, and on engineering to no phase at all', () => {
    expect(phaseForRun('fix', 'product')?.name).toBe('story-fix');
    expect(phaseForRun('fix', 'engineering')).toBeUndefined();
  });
  it('resolves a card-less run to the bootstrap', () => {
    expect(phaseForRun('derive-features')?.name).toBe('bootstrap');
  });
  it('is undefined for a skill no phase names', () => {
    // `execute`, `research`, `summarise` — hand-dispatch skills the lifecycle never uses. The endpoint
    // must not invent a `creates` for them.
    expect(phaseForRun('execute', 'engineering')).toBeUndefined();
  });
  it('is undefined for a lifecycle skill on a board its phase is not on', () => {
    expect(phaseForRun('break-down', 'engineering')).toBeUndefined();
  });
  it('resolves each single-board lifecycle skill', () => {
    expect(phaseForRun('implement-story', 'product')?.name).toBe('story-implement');
    expect(phaseForRun('review-story', 'product')?.name).toBe('story-review');
    expect(phaseForRun('checkup-feature', 'features')?.name).toBe('feature-checkup');
  });

  // `implement` IS A HAND SKILL NOW, and it is still seeded: the endpoint must not invent a `creates` for
  // it, exactly as it must not for `execute`.
  it('is undefined for the per-task implement the lifecycle no longer dispatches', () => {
    expect(phaseForRun('implement', 'engineering')).toBeUndefined();
  });
});
