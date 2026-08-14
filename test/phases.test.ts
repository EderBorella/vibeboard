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

  it('stamps a task into in-progress before implement and review after it', () => {
    expect(phase('task-implement')).toMatchObject({
      board: 'engineering',
      entry: 'in-progress',
      exitPass: 'review',
      skill: 'implement',
    });
    // No `creates`: an implement run has no board to create cards on, and the endpoint reads this.
    expect(phase('task-implement').creates).toBeUndefined();
  });

  it('sends a task back to in-progress and forward to done from review', () => {
    expect(phase('task-review')).toMatchObject({
      board: 'engineering',
      exitPass: 'done',
      exitFail: 'in-progress',
      skill: 'review',
      bounded: 'review',
    });
    // No entry stamp: it is already in review, and a move to where it is would be a write for nothing.
    expect(phase('task-review').entry).toBeUndefined();
  });

  it('has no skill for the phases the loop carries out alone', () => {
    for (const name of ['feature-breakdown-skip', 'story-breakdown-skip', 'task-review-remove'] as const) {
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
      'checkup-story',
      'derive-features',
      'fix',
      'implement',
      'review',
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
    expect(phaseForRun('checkup-story', 'product')?.name).toBe('story-checkup');
    expect(phaseForRun('checkup-feature', 'features')?.name).toBe('feature-checkup');
  });
});
