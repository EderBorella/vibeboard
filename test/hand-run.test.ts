import { describe, expect, it } from 'vitest';
import { burnsAttempt } from '../src/core/accounting.js';
import { finishColumn, startColumn } from '../src/core/hand-run.js';
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
  movesCard: true,
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

const finish = (over: { record?: RunRecord; skill?: Skill; card?: Card; running?: boolean } = {}) =>
  finishColumn({
    record: over.record ?? record(),
    skill: over.skill ?? skill(),
    card: 'card' in over ? over.card : card('in-progress'),
    config,
    autopilotRunning: over.running ?? false,
  });

describe("where a person's run puts its card when it starts", () => {
  it('into in progress, from wherever it stands', () => {
    expect(startColumn(config, card('backlog'), skill())).toBe('in-progress');
    expect(startColumn(config, card('done'), skill())).toBe('in-progress');
    expect(startColumn(config, card('backlog', 'features'), skill())).toBe('in-progress');
  });

  it('nowhere when it is already there, or the skill does not move cards', () => {
    expect(startColumn(config, card('in-progress'), skill())).toBeUndefined();
    expect(startColumn(config, card('backlog'), skill({ movesCard: false }))).toBeUndefined();
    expect(startColumn(config, card('backlog'), skill({ autopilotOnly: true }))).toBeUndefined();
  });
});

describe("where a person's run puts its card when it ends", () => {
  it.each(['success', 'attention', 'failed', 'cancelled'] as const)(
    'into blocked when it ends %s',
    (status) => {
      expect(finish({ record: record({ status }) })).toBe('blocked');
    },
  );

  it.each([
    ['the loop dispatched it', { record: record({ dispatchedBy: undefined }) }],
    ['the skill does not move cards', { skill: skill({ movesCard: false }) }],
    ['the skill is for auto-pilot only', { skill: skill({ autopilotOnly: true }) }],
    ['the run moved it to done itself', { card: card('done') }],
    ['somebody moved it meanwhile', { card: card('review') }],
    ['the card is gone', { card: undefined }],
    ['auto-pilot is running', { running: true }],
    ['its board has no blocked column', { card: card('in-progress', 'features') }],
  ] as const)('leaves it where it is when %s', (_why, over) => {
    expect(finish(over)).toBeUndefined();
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
