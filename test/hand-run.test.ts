import { describe, expect, it } from 'vitest';
import { burnsAttempt } from '../src/core/accounting.js';
import { finishColumn, startColumn, waitingOnPerson } from '../src/core/hand-run.js';
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
  it('into in progress, from wherever it stands short of done', () => {
    expect(startColumn(config, card('backlog'), skill())).toBe('in-progress');
    expect(startColumn(config, card('blocked'), skill())).toBe('in-progress');
    expect(startColumn(config, card('backlog', 'features'), skill())).toBe('in-progress');
  });

  it('nowhere when it is already there, or the skill does not move cards', () => {
    expect(startColumn(config, card('in-progress'), skill())).toBeUndefined();
    expect(startColumn(config, card('done'), skill())).toBeUndefined();
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

// DECISION 99: what auto-pilot refuses to start over — a card a person's run left in blocked, and only that.
describe('the cards waiting on the person', () => {
  const at = (id: string, columnSlug: string, board: Card['board'] = 'engineering'): Card => ({
    ...card(columnSlug, board),
    id,
  });
  const on = (id: string, started: string, over: Partial<RunRecord> = {}): RunRecord =>
    record({ run: `${id}-${started}`, card: id, started, ...over });

  it('are the blocked cards whose last run a person started', () => {
    const cards = [
      at('E-001', 'blocked'),
      at('E-002', 'blocked'),
      at('E-003', 'blocked'),
      at('E-004', 'review'),
    ];
    const runs = [
      on('E-001', '2026-09-27T10:00:00Z'),
      // The loop gave up on this one after a person's run: its last word is the loop's.
      on('E-002', '2026-09-27T10:00:00Z'),
      on('E-002', '2026-09-27T11:00:00Z', { dispatchedBy: undefined }),
      on('E-003', '2026-09-27T10:00:00Z', { dispatchedBy: undefined }),
      on('E-004', '2026-09-27T10:00:00Z'),
    ];
    expect(waitingOnPerson(config, cards, runs).map((c) => c.id)).toEqual(['E-001']);
  });

  // DECISION 102: a Mini build parks its cards in blocked with no run of their own, and they wait on the person too.
  it('include what a Mini build parked there', () => {
    const parked = { ...at('E-005', 'blocked'), createdBy: 'build-1' };
    const loopBlocked = { ...at('E-006', 'blocked'), createdBy: 'break-down-1' };
    const runs = [
      record({
        run: 'build-1',
        card: undefined,
        board: undefined,
        skill: 'build-project',
        dispatchedBy: undefined,
      }),
      record({
        run: 'break-down-1',
        card: 'P-001',
        board: 'product',
        skill: 'break-down',
        dispatchedBy: undefined,
      }),
    ];
    expect(waitingOnPerson(config, [parked, loopBlocked], runs).map((c) => c.id)).toEqual(['E-005']);
  });
});
