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

  it('stamps a task into in-progress before implement and done after it', () => {
    expect(phase('task-implement')).toMatchObject({
      board: 'engineering',
      entry: 'in-progress',
      exitPass: 'done',
      skill: 'implement',
    });
    // No `creates`: an implement run has no board to create cards on, and the endpoint reads this.
    expect(phase('task-implement').creates).toBeUndefined();
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

  // A SEND-BACK NEEDS SOMEWHERE TO GO. Without this row a refused story sits settled in `in-progress`
  // carrying a failed verdict, and every later tick re-stamps it to where it already is.
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
      'implement',
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
  // AND `fix` IS THE SECOND OF THEM since decision 80 — one skill, a task's phase and a story's, which is
  // what keeps `isWorkRun` in bounds.ts able to tell a story's fix from a task's.
  it('resolves fix on engineering to task-fix, and on product to story-fix', () => {
    expect(phaseForRun('fix', 'engineering')?.name).toBe('task-fix');
    expect(phaseForRun('fix', 'product')?.name).toBe('story-fix');
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
    expect(phaseForRun('implement', 'engineering')?.name).toBe('task-implement');
    expect(phaseForRun('review-story', 'product')?.name).toBe('story-review');
    expect(phaseForRun('checkup-feature', 'features')?.name).toBe('feature-checkup');
  });
});
