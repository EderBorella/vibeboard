import { describe, expect, it } from 'vitest';
import type { TickAction } from '../src/core/actions.js';
import { decideTick } from '../src/core/lifecycle/tick.js';
import { phase } from '../src/core/phases.js';
import { type RunRecord, withVerification } from '../src/core/runs.js';
import type { Card } from '../src/core/types.js';
import { card, input, task } from './tick-fixtures.js';

// WHAT ONE HEALTHY STORY COSTS, counted in dispatches rather than argued about. Every other tick test asks
// what a single board state answers; this one walks a story from its first task to its close and records the
// phases it paid for, because the thing D1 changes is the LENGTH of that sequence and no single-state
// assertion can see it.
//
// THE DRIVER READS THE PHASE TABLE AND NOTHING ELSE. It is deliberately not a copy of `service/act`: it
// applies the entry stamp, the exit stamp and — for a review-bounded phase — the verdict onto the run named
// as `previous`, all of them off `PHASES`. That is the whole of what the executor does on the happy path, and
// keeping it table-driven is what lets the same driver characterise the machine before and after the change.

interface Step {
  cards: Card[];
  runs: RunRecord[];
  phases: string[];
}

const move = (cards: Card[], id: string, to: string): Card[] =>
  cards.map((c) => (c.id === id ? { ...c, columnSlug: to } : c));

// One agent run, as the server would have written it. `started` climbs with the sequence number so
// `latest` in bounds.ts orders these the way they really happened.
function dispatched(n: number, from: Card, skill: string): RunRecord {
  return {
    run: `${String(n).padStart(4, '0')}-${from.id}-${skill}`,
    card: from.id,
    board: from.board,
    skill,
    status: 'success',
    started: `2026-08-05T10:${String(n).padStart(2, '0')}:00Z`,
    backend: 'test',
    model: 'test',
    effort: 'medium',
    mode: 'skill',
    report: '',
  };
}

type Dispatch = Extract<TickAction, { kind: 'dispatch' }>;

// What one dispatch leaves behind: the run on the record, the verdict a judgement writes onto the run it
// judged, and the entry and exit stamps the table names. `passed` is the judgement's answer, and `true` for
// every phase that is not one.
function applyDispatch(
  at: { cards: Card[]; runs: RunRecord[] },
  action: Dispatch,
  on: Card,
  n: number,
  passed: boolean,
): { cards: Card[]; runs: RunRecord[] } {
  const p = phase(action.phase);
  const run = dispatched(n, on, action.skill);
  const judged = action.previous;
  const runs = [...at.runs, run].map((r) =>
    p.bounded === 'review' && r.run === judged
      ? withVerification(r, { mode: 'review', passed, at: 'T', by: run.run })
      : r,
  );
  const exit = passed ? p.exitPass : p.exitFail;
  let cards = p.entry === undefined ? at.cards : move(at.cards, on.id, p.entry);
  if (exit !== undefined) cards = move(cards, on.id, exit);
  return { cards, runs };
}

// One tick at a time, until the card named settles or the machine stops. `verdicts` is what each judgement
// answers, in order, defaulting to a pass once the queue runs out — so a send-back is described by the one
// fact that differs rather than by a second driver.
//
// The step cap is a guard rather than a bound on the scenario: a machine that re-stamps a card to where it
// already is would otherwise hang the suite instead of failing it.
function walk(start: Card[], runs: RunRecord[], until: string, verdicts: boolean[] = []): Step {
  let at = { cards: start, runs: [...runs] };
  const answers = [...verdicts];
  const phases: string[] = [];
  for (let n = 1; n <= 20; n += 1) {
    const settled = at.cards.find((c) => c.id === until);
    if (settled && (settled.columnSlug === 'done' || settled.columnSlug === 'blocked')) break;
    const action = decideTick(input(at));
    if (action.kind === 'stop') {
      phases.push(`stop:${action.reason}`);
      break;
    }
    if (action.kind === 'wait') break;
    if (action.kind === 'stamp') {
      at = { ...at, cards: move(at.cards, action.card.id, action.to) };
      continue;
    }
    const on = action.card;
    if (!on) break;
    phases.push(action.phase);
    // The queue is consumed only by a judgement, so a scenario naming one verdict does not silently spend
    // it on the implement run that came first.
    const passed = phase(action.phase).bounded !== 'review' || (answers.shift() ?? true);
    at = applyDispatch(at, action, on, n, passed);
  }
  return { ...at, phases };
}

// A story already broken down: two tasks in the backlog and the break-down run that made them. Two and not
// one, because "every task settled" and "any task settled" are the same answer with one.
const broken = (): Card[] => [
  card('F-001', 'features', 'in-progress', 10, ['P-001']),
  card('P-001', 'product', 'todo', 10, ['F-001', 'E-001', 'E-002']),
  task('E-001', 'backlog', 10),
  task('E-002', 'backlog', 20),
];

const brokeDown = (): RunRecord[] => [dispatched(0, broken()[1] as Card, 'break-down')];

describe('what one healthy story costs', () => {
  it('judges the story once, after its tasks are done, and closes it', () => {
    const walked = walk(broken(), brokeDown(), 'P-001');
    // THREE, where it was five before decision 80: implement, implement, one judgement. The two task
    // reviews and the story checkup were four cold starts asking one question twice.
    expect(walked.phases).toEqual(['task-implement', 'task-implement', 'story-review']);
  });

  it('leaves the story in done and both tasks in done', () => {
    const walked = walk(broken(), brokeDown(), 'P-001');
    const at = (id: string): string | undefined => walked.cards.find((c) => c.id === id)?.columnSlug;
    expect(at('P-001')).toBe('done');
    expect(at('E-001')).toBe('done');
    expect(at('E-002')).toBe('done');
  });
});

// A SEND-BACK HAS A DESTINATION AND THE CYCLE ENDS. The first judgement refuses, and what the machine does
// with that refusal — where the card goes, what it dispatches next, and that it closes rather than looping —
// is the half of the review loop no happy-path walk reaches.
const oneTask = (): Card[] => [
  card('F-001', 'features', 'in-progress', 10, ['P-001']),
  card('P-001', 'product', 'in-progress', 10, ['F-001', 'E-001']),
  task('E-001', 'backlog', 10),
];

describe('what a story that is sent back once costs', () => {
  it('fixes what the judgement refused and judges it again', () => {
    const walked = walk(oneTask(), brokeDown(), 'P-001', [false]);
    expect(walked.phases).toEqual(['task-implement', 'story-review', 'story-fix', 'story-review']);
  });

  it('closes the story rather than judging it for ever', () => {
    const walked = walk(oneTask(), brokeDown(), 'P-001', [false]);
    expect(walked.cards.find((c) => c.id === 'P-001')?.columnSlug).toBe('done');
  });
});
