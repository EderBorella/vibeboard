import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_SLUG,
  BOARDS_DIR,
  boardRel,
  CHAT_DIR,
  CONFIG_DIR,
  CONFIG_FILE,
  CONVENTIONS_FILE,
  DOCS_DIR,
  INSTRUCTIONS_FILE,
  POINTER_FILES,
  RESOURCES_DIR,
  RESOURCES_YAML,
  RESULTS_DIR,
  RUNS_DIR,
  SKILLS_DIR,
  skillRel,
} from '../src/core/layout.js';

// The one place the layout is written down twice on purpose.
//
// Every other test in this suite builds its paths from these constants, so a wrong constant would
// move the whole suite with it and nothing would fail. That is the trade: it buys one edit per
// layout change instead of forty-one, and it costs the independent evidence that the strings are
// what we intended. This file is that evidence — literal, exact-equality, and the only file that
// has to change when the layout genuinely moves.
describe('layout', () => {
  it('puts everything VibeBoard owns under one folder at the project root', () => {
    expect(CONFIG_DIR).toBe('.vibeboard');
    expect(CONFIG_FILE).toBe('config.yaml');
    expect(BOARDS_DIR).toBe('.vibeboard/boards');
    expect(SKILLS_DIR).toBe('.vibeboard/skills');
    expect(DOCS_DIR).toBe('.vibeboard/docs');
    expect(RESOURCES_DIR).toBe('.vibeboard/resources');
    expect(RESOURCES_YAML).toBe('.vibeboard/resources.yaml');
    expect(CHAT_DIR).toBe('.vibeboard/chat');
    expect(RUNS_DIR).toBe('.vibeboard/runs');
  });

  it('keeps the two moved documents inside the folder, named as they were', () => {
    expect(CONVENTIONS_FILE).toBe('.vibeboard/VIBEBOARD.md');
    expect(INSTRUCTIONS_FILE).toBe('.vibeboard/INSTRUCTIONS.md');
  });

  // Both CLIs auto-discover these by name in the working directory. Moving either one inside
  // `.vibeboard/` means the agent reads nothing at all, which is a silent failure — hence a
  // literal assertion rather than a derived one.
  it('leaves the CLI pointer files at the project root', () => {
    expect(POINTER_FILES).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });

  // Peers of a column inside a board, not children of the config folder.
  it('keeps archive and results inside a board', () => {
    expect(ARCHIVE_SLUG).toBe('archive');
    expect(RESULTS_DIR).toBe('results');
  });

  it('joins a board, a column and a card file', () => {
    expect(boardRel('engineering')).toBe('.vibeboard/boards/engineering');
    expect(boardRel('engineering', 'todo')).toBe('.vibeboard/boards/engineering/todo');
    expect(boardRel('engineering', 'todo', 'E-001.md')).toBe('.vibeboard/boards/engineering/todo/E-001.md');
    expect(boardRel('features', ARCHIVE_SLUG)).toBe('.vibeboard/boards/features/archive');
    expect(boardRel('product', RESULTS_DIR, 'P-007')).toBe('.vibeboard/boards/product/results/P-007');
  });

  it('joins a skill folder and its SKILL.md', () => {
    expect(skillRel('execute')).toBe('.vibeboard/skills/execute');
    expect(skillRel('break-down', 'SKILL.md')).toBe('.vibeboard/skills/break-down/SKILL.md');
  });
});
