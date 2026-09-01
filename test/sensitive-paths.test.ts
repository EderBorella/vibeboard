import { describe, expect, it } from 'vitest';
import { sensitivity } from '../src/core/sensitive-paths.js';

// WHICH FILES THE EXPLORER SAYS SOMETHING ABOUT BEFORE A SAVE — src/core/sensitive-paths.ts.
//
// The tab reaches every file in the project on purpose, so this is not a permission check and getting
// it wrong in the loud direction is worse than the quiet one: a warning on ordinary content is a dialog
// people learn to click through, and they then click through the deletion dialogs too.

describe('paths that are not the user’s content', () => {
  it('names a run’s scratch space, which a live run is writing to', () => {
    expect(sensitivity('.vibeboard/runs/20260901-120000-abcd.report.md')?.kind).toBe('run-scratch');
    expect(sensitivity('.vibeboard/runs')?.kind).toBe('run-scratch');
  });

  // BEFORE the board-state answer, and the order is the behaviour: `.vibeboard/runs` is inside
  // `.vibeboard`, and the run reason is the more specific and the more urgent of the two.
  it('prefers the run reason over the board one for a path that is both', () => {
    expect(sensitivity('.vibeboard/runs/x.log.jsonl')?.why).toContain('run');
  });

  it('names board state', () => {
    expect(sensitivity('.vibeboard/config.yaml')?.kind).toBe('board-state');
    expect(sensitivity('.vibeboard/autopilot-state.json')?.kind).toBe('board-state');
    expect(sensitivity('.vibeboard/boards/engineering/todo/E-001.md')?.kind).toBe('board-state');
  });

  it('names git’s own state, which runs code on the host', () => {
    expect(sensitivity('.git/hooks/pre-commit')?.kind).toBe('git-internal');
    expect(sensitivity('.git/config')?.kind).toBe('git-internal');
  });

  // THE PREFIX TRAP, and it is why `within` exists rather than a `startsWith`. `.gitignore` is an
  // ordinary file people edit constantly, and it begins with `.git`.
  it('says nothing about a file whose name merely starts the same way', () => {
    for (const path of ['.gitignore', '.gitattributes', '.vibeboardrc', '.github/workflows/ci.yml']) {
      expect(sensitivity(path)).toBeUndefined();
    }
  });

  it('says nothing about ordinary content, which is nearly everything', () => {
    for (const path of ['README.md', 'src/index.ts', 'docs/design.md', '', 'notes/todo.md']) {
      expect(sensitivity(path)).toBeUndefined();
    }
  });

  // Every reason is a sentence a person reads at the moment they press Save, so it has to say what it
  // costs rather than what category the file is in. Asserted as a floor rather than word by word.
  it('gives every kind a reason long enough to be a reason', () => {
    for (const path of ['.vibeboard/runs/x', '.vibeboard/config.yaml', '.git/config']) {
      expect(sensitivity(path)?.why.length).toBeGreaterThan(60);
    }
  });
});
