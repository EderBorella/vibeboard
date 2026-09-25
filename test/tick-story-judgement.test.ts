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
  // WHICH CARD each dispatch was about, alongside the phase. The phase list alone cannot see the thing D2
  // changes: three implement dispatches against three different tasks and three against one story read the
  // same there, and the unit of work is exactly what moves.
  on: string[];
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
// judged, the entry and exit stamps the table names, and — where the action carries them — the cards one
// level down that the run delivered, or that the judgement closed or re-opened. `passed` is the judgement's
// answer, and `true` for every phase that is not one.
//
// THE GROUP IS READ OFF THE ACTION, not off the table, because that is where it is: the tick decides which
// tasks and which columns, and this driver stays a reader of what the machine answered rather than a second
// copy of `service/act`.
function applyDispatch(
  at: { cards: Card[]; runs: RunRecord[] },
  action: Dispatch,
  on: Card,
  n: number,
  passed: boolean,
): { cards: Card[]; runs: RunRecord[] } {
  const p = phase(action.phase);
  // A JUDGEMENT'S OWN RECORD CARRIES ITS VERDICT, as `withReport` folds it in. Without it every review here
  // was inconclusive by `inconclusiveReviews`' measure, and a walk of three send-backs stopped on that bound
  // rather than on the fix budget it was written to reach.
  const verdict =
    p.bounded === 'review' ? { verdict: passed ? ('done' as const) : ('sent-back' as const) } : {};
  const run = { ...dispatched(n, on, action.skill), ...verdict };
  const judgedRun = action.previous;
  const runs = [...at.runs, run].map((r) =>
    p.bounded === 'review' && r.run === judgedRun
      ? withVerification(r, { mode: 'review', passed, at: 'T', by: run.run })
      : r,
  );
  const exit = passed ? p.exitPass : p.exitFail;
  let cards = p.entry === undefined ? at.cards : move(at.cards, on.id, p.entry);
  if (exit !== undefined) cards = move(cards, on.id, exit);
  for (const task of action.group?.cards ?? []) {
    cards = move(cards, task.id, action.group?.entry ?? '');
    // TOGETHER, and only because the run completed — which on this driver's happy path it always does.
    cards = move(cards, task.id, action.group?.delivered ?? '');
  }
  // AND WHAT THE JUDGEMENT DECIDES OF THEM (decision 87), off the action for the same reason as the group.
  for (const task of action.judged?.cards ?? []) {
    cards = move(cards, task.id, (passed ? action.judged?.passed : action.judged?.sentBack) ?? '');
  }
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
  const on: string[] = [];
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
    const about = action.card;
    if (!about) break;
    phases.push(action.phase);
    on.push(about.id);
    // The queue is consumed only by a judgement, so a scenario naming one verdict does not silently spend
    // it on the implement run that came first.
    const passed = phase(action.phase).bounded !== 'review' || (answers.shift() ?? true);
    at = applyDispatch(at, action, about, n, passed);
  }
  return { ...at, phases, on };
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
    // TWO, where it was five before decision 80 and three before decision 83: one implement doing both
    // tasks, one judgement. The two task reviews and the story checkup were four cold starts asking one
    // question twice; the second implement was a second cold start reading the same files again.
    expect(walked.phases).toEqual(['story-implement', 'story-review']);
  });

  it('leaves the story in done and both tasks in done', () => {
    const walked = walk(broken(), brokeDown(), 'P-001');
    const at = (id: string): string | undefined => walked.cards.find((c) => c.id === id)?.columnSlug;
    expect(at('P-001')).toBe('done');
    expect(at('E-001')).toBe('done');
    expect(at('E-002')).toBe('done');
  });
});

// AND WHAT THREE TASKS COST, which is the size the D2 experiment measured. Two cannot tell "one run per
// task" from "one run per story" by the LENGTH of the walk alone — a two-task story pays two implements
// either way if the second is a group of one — so the unit is pinned here at three, and `on` is what says
// which card each run was about.
const threeTasks = (): Card[] => [
  card('F-001', 'features', 'in-progress', 10, ['P-001']),
  card('P-001', 'product', 'todo', 10, ['F-001', 'E-001', 'E-002', 'E-003']),
  task('E-001', 'backlog', 10),
  task('E-002', 'backlog', 20),
  task('E-003', 'backlog', 30),
];

describe('what one story with three tasks costs', () => {
  it('pays one implement dispatch for all three, then one judgement', () => {
    const walked = walk(threeTasks(), brokeDown(), 'P-001');
    // TWO, where it was four. This is the arm the experiment measured: three tasks in one run, 18 turns
    // and 50k of context against 41 turns and 148k for the three runs it replaces.
    expect(walked.phases).toEqual(['story-implement', 'story-review']);
  });

  it('runs both dispatches against the story, and none against a task', () => {
    const walked = walk(threeTasks(), brokeDown(), 'P-001');
    expect(walked.on).toEqual(['P-001', 'P-001']);
  });

  it('leaves the story and all three tasks in done', () => {
    const walked = walk(threeTasks(), brokeDown(), 'P-001');
    const at = (id: string): string | undefined => walked.cards.find((c) => c.id === id)?.columnSlug;
    expect([at('P-001'), at('E-001'), at('E-002'), at('E-003')]).toEqual(['done', 'done', 'done', 'done']);
  });
});

// AND A STORY PAST THE CEILING PAYS ONE RUN PER GROUP, which is the whole of what the ceiling does: it
// bounds what one agent is asked for without refusing the story or bundling work nothing has costed. Seven
// tasks against a ceiling of five is two groups, so two implements and still one judgement.
const sevenTasks = (): Card[] => {
  const ids = Array.from({ length: 7 }, (_, i) => `E-00${i + 1}`);
  return [
    card('F-001', 'features', 'in-progress', 10, ['P-001']),
    card('P-001', 'product', 'todo', 10, ['F-001', ...ids]),
    ...ids.map((id, i) => task(id, 'backlog', (i + 1) * 10)),
  ];
};

describe('what a story past the ceiling costs', () => {
  it('pays one implement per group, and still judges once', () => {
    const walked = walk(sevenTasks(), brokeDown(), 'P-001');
    expect(walked.phases).toEqual(['story-implement', 'story-implement', 'story-review']);
  });

  it('leaves every one of the seven tasks in done', () => {
    const walked = walk(sevenTasks(), brokeDown(), 'P-001');
    const columns = walked.cards.filter((c) => c.board === 'engineering').map((c) => c.columnSlug);
    expect(columns).toEqual(Array.from({ length: 7 }, () => 'done'));
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
    expect(walked.phases).toEqual(['story-implement', 'story-review', 'story-fix', 'story-review']);
  });

  it('closes the story rather than judging it for ever', () => {
    const walked = walk(oneTask(), brokeDown(), 'P-001', [false]);
    expect(walked.cards.find((c) => c.id === 'P-001')?.columnSlug).toBe('done');
  });
});

// TERMINATION, ASSERTED RATHER THAN ARGUED (decision 87). A task whose story's implement completed waits in
// `review`, which is neither terminal nor blocked — so under `allSettled` alone the judgement never fires, the
// group is re-formed out of work the machine thinks is outstanding, and the implement is dispatched until its
// cap blocks a story that delivered. Both directions are driven here with nothing injected but the verdicts,
// and the walker's step bound is what turns a machine that loops into a failure rather than a hang.
describe('a story whose delivered tasks wait for its judgement', () => {
  const columnsOf = (walked: Step): string[] =>
    walked.cards.filter((c) => c.board === 'engineering').map((c) => c.columnSlug);

  it('closes, every task done, when every run completes and every judgement passes', () => {
    const walked = walk(threeTasks(), brokeDown(), 'P-001');
    expect(walked.phases).toEqual(['story-implement', 'story-review']);
    expect(walked.cards.find((c) => c.id === 'P-001')?.columnSlug).toBe('done');
    expect(columnsOf(walked)).toEqual(['done', 'done', 'done']);
  });

  it('blocks at its fix budget, no task done, when every judgement sends it back', () => {
    const walked = walk(
      threeTasks(),
      brokeDown(),
      'P-001',
      Array.from({ length: 20 }, () => false),
    );
    expect(walked.phases).toEqual([
      'story-implement',
      'story-review',
      'story-fix',
      'story-review',
      'story-fix',
      'story-review',
      'story-fix',
      'story-review',
    ]);
    expect(walked.cards.find((c) => c.id === 'P-001')?.columnSlug).toBe('blocked');
    // SENT BACK AND NEVER DELIVERED, which is what the board now says of them.
    expect(columnsOf(walked)).toEqual(['in-progress', 'in-progress', 'in-progress']);
  });

  // PAST THE CEILING, because the fix re-delivers every task the send-back re-opened rather than a group of
  // them: capped, the rest would stand in `in-progress` for an implement to read as its own.
  it('blocks a story past the ceiling at its fix budget, every task re-opened', () => {
    const walked = walk(
      sevenTasks(),
      brokeDown(),
      'P-001',
      Array.from({ length: 20 }, () => false),
    );
    expect(walked.phases).toEqual([
      'story-implement',
      'story-implement',
      'story-review',
      'story-fix',
      'story-review',
      'story-fix',
      'story-review',
      'story-fix',
      'story-review',
    ]);
    expect(walked.cards.find((c) => c.id === 'P-001')?.columnSlug).toBe('blocked');
    expect(columnsOf(walked)).toEqual(Array.from({ length: 7 }, () => 'in-progress'));
  });
});

// A FIX WHOSE DELIVERY WAS REFUSED leaves the tasks its send-back re-opened in `in-progress`. Read off the
// board alone, that story has landed nothing — so the implement's earned-back allowance, which three groups
// had grown to five, would fall back to three and block a story that never tried again.
describe('a story whose fix could not deliver', () => {
  const ids = Array.from({ length: 11 }, (_, i) => `E-${String(i + 1).padStart(3, '0')}`);
  const reopened = (): Card[] => [
    card('F-001', 'features', 'in-progress', 10, ['P-001']),
    card('P-001', 'product', 'in-progress', 10, ['F-001', ...ids]),
    ...ids.map((id, i) => task(id, 'in-progress', (i + 1) * 10)),
  ];

  it('is implemented again rather than blocked at a cap its send-back emptied', () => {
    const story = reopened()[1] as Card;
    const [a, b, c] = [1, 2, 3].map((n) => dispatched(n, story, phase('story-implement').skill ?? ''));
    const review = {
      ...dispatched(4, story, phase('story-review').skill ?? ''),
      verdict: 'sent-back' as const,
    };
    const runs = [
      ...brokeDown(),
      a as RunRecord,
      b as RunRecord,
      withVerification(c as RunRecord, { mode: 'review', passed: false, at: 'T', by: review.run }),
      review,
      dispatched(5, story, phase('story-fix').skill ?? ''),
    ];
    expect(decideTick(input({ cards: reopened(), runs }))).toMatchObject({
      kind: 'dispatch',
      phase: 'story-implement',
    });
  });
});
