import { describe, expect, it } from 'vitest';
import { burnsAttempt } from '../src/core/accounting.js';
import { handRunTarget, nextColumn } from '../src/core/hand-run.js';
import { parseRun, type RunRecord, serializeRun } from '../src/core/runs.js';
import type { Skill } from '../src/core/skills.js';
import type { Card } from '../src/core/types.js';
import { defaultConfig } from '../src/store/project/config.js';

const config = defaultConfig('T');

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: 'r1',
  card: 'E-001',
  board: 'engineering',
  skill: 'execute',
  status: 'success',
  started: '2026-09-27T10:00:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'default',
  report: '',
  dispatchedBy: 'person',
  ...over,
});

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: 'execute',
  path: '.vibeboard/skills/execute/SKILL.md',
  name: 'Execute',
  description: 'd',
  boards: [],
  columns: [],
  prompt: 'p',
  autopilotOnly: false,
  moveOnSuccess: true,
  ...over,
});

const card = (columnSlug: string, board: Card['board'] = 'engineering'): Card => ({
  id: 'E-001',
  title: 't',
  order: 10,
  tags: [],
  links: [],
  created: '2026-09-27',
  board,
  columnSlug,
  body: '',
  filePath: `/tmp/${columnSlug}/E-001.md`,
});

const target = (
  over: { record?: RunRecord; skill?: Skill; card?: Card; from?: string; running?: boolean } = {},
) =>
  handRunTarget({
    record: over.record ?? record(),
    skill: over.skill ?? skill(),
    card: 'card' in over ? over.card : card('in-progress'),
    dispatchedFrom: over.from ?? 'in-progress',
    config,
    autopilotRunning: over.running ?? false,
  });

describe('the column after this one', () => {
  it('walks board order and passes over blocked, into done', () => {
    expect(nextColumn(config, 'engineering', 'backlog')).toBe('in-progress');
    expect(nextColumn(config, 'engineering', 'review')).toBe('done');
    expect(nextColumn(config, 'product', 'in-progress')).toBe('done');
    expect(nextColumn(config, 'features', 'in-progress')).toBe('done');
    expect(nextColumn(config, 'engineering', 'done')).toBeUndefined();
    expect(nextColumn(config, 'engineering', 'nowhere')).toBeUndefined();
  });
});

describe("where a person's run moves its card", () => {
  it('moves it on when the run succeeded', () => {
    expect(target()).toBe('review');
  });

  it.each([
    ['the loop dispatched it', { record: record({ dispatchedBy: undefined }) }],
    ['it needs attention', { record: record({ status: 'attention' }) }],
    ['it failed', { record: record({ status: 'failed' }) }],
    ['the machine failed it', { record: record({ fault: 'infrastructure' }) }],
    ['it sent the card back', { record: record({ verdict: 'sent-back' }) }],
    ['the skill is for auto-pilot only', { skill: skill({ autopilotOnly: true }) }],
    ['the skill does not move', { skill: skill({ moveOnSuccess: false }) }],
    ['somebody moved the card meanwhile', { card: card('review') }],
    ['the card is gone', { card: undefined }],
    ['auto-pilot is running', { running: true }],
  ] as const)('leaves it where it is when %s', (_why, over) => {
    expect(target(over)).toBeUndefined();
  });
});

describe('a run a person started', () => {
  it('survives the round trip to disk, and a value that is not ours is dropped', () => {
    expect(parseRun(serializeRun(record()))?.dispatchedBy).toBe('person');
    const forged = serializeRun(record()).replace('dispatchedBy: person', 'dispatchedBy: loop');
    expect(parseRun(forged)?.dispatchedBy).toBeUndefined();
  });

  it('burns none of the loop’s attempts, where the same run of the loop’s would', () => {
    expect(burnsAttempt(record({ status: 'failed' }))).toBe(false);
    expect(burnsAttempt(record({ status: 'failed', dispatchedBy: undefined }))).toBe(true);
  });
});
