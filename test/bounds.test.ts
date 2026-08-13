import { describe, expect, it } from 'vitest';
import {
  creatingRoundSpent,
  inconclusiveReviews,
  latestWorkRun,
  outstandingVerdict,
  reviewsRun,
} from '../src/core/bounds.js';
import {
  type ReviewVerdict,
  type RunRecord,
  withoutReport,
  withReport,
  withVerification,
} from '../src/core/runs.js';
import type { BoardName, Card } from '../src/core/types.js';
import type { Verification } from '../src/core/verify.js';

// COMPOSED THROUGH THE REAL FUNCTIONS, never hand-built. A hand-built `report: ''` is a shape the runner
// never writes, and that is precisely how `producedNothing` shipped dead behind a green suite
// (src/core/runs.ts:532-537).

// Every run shares one `started`, so the ID is what decides "latest" here and it ascends with creation
// order. That is the TIE-BREAK rather than the ordering: `latest` ranks by `started` first, because a run
// id is only sortable to the second and its suffix is random — see the suite below, which is about
// exactly that.
let seq = 0;
function base(over: Partial<RunRecord> = {}): RunRecord {
  seq += 1;
  return {
    run: `20260813-1000${String(seq).padStart(2, '0')}`,
    card: 'E-001',
    board: 'engineering',
    skill: 'implement',
    status: 'running',
    started: '2026-08-13T10:00:00Z',
    backend: 'test',
    model: 'test',
    effort: 'medium',
    mode: 'skill',
    report: '',
    ...over,
  };
}

// A run that did the work and delivered a report.
const work = (skill: 'implement' | 'fix', card = 'E-001'): RunRecord =>
  withReport(base({ skill, card }), { outcome: 'success', summary: 'did it', body: '## What I did' }, 'T');

// A run that DIED: no report at all, which is exactly the shape that must not clear an earlier verdict.
const died = (skill: string, card = 'E-001'): RunRecord =>
  withoutReport(base({ skill, card }), 'failed', 'The agent exited with code 1 and wrote no report.', 'T');

const gates = (passed: boolean): Verification =>
  passed
    ? { mode: 'gates', passed: true, at: 'T' }
    : { mode: 'gates', passed: false, at: 'T', command: 'npm test', output: '1 failed' };

const rev = (verdict: ReviewVerdict, card = 'E-001'): RunRecord =>
  withReport(base({ skill: 'review', card }), { outcome: 'success', verdict, body: '## Judgement' }, 'T');

function card(board: BoardName, id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    title: id,
    order: 10,
    tags: [],
    links: [],
    created: '2026-08-13',
    board,
    columnSlug: 'backlog',
    body: '',
    filePath: `/tmp/${id}.md`,
    ...over,
  };
}

describe('outstandingVerdict', () => {
  it('is absent for a task with no runs', () => {
    expect(outstandingVerdict([], 'E-001')).toBeUndefined();
  });

  it('is absent when the only run carries no verification', () => {
    // Nothing has judged it yet, which is not the same fact as failing.
    expect(outstandingVerdict([work('implement')], 'E-001')).toBeUndefined();
  });

  it('is the verification on the latest settled implement or fix run that has one', () => {
    const first = withVerification(work('implement'), gates(false));
    const second = withVerification(work('fix'), gates(true));
    expect(outstandingVerdict([first, second], 'E-001')?.passed).toBe(true);
    // Order of the argument must not decide the answer.
    expect(outstandingVerdict([second, first], 'E-001')?.passed).toBe(true);
  });

  // A fix that DIED leaves the previous failed verdict outstanding — the task still needs fixing.
  it('keeps the earlier failed verdict when a later fix run carries none', () => {
    const judged = withVerification(work('implement'), gates(false));
    expect(outstandingVerdict([judged, died('fix')], 'E-001')?.passed).toBe(false);
    expect(outstandingVerdict([judged, died('fix')], 'E-001')?.command).toBe('npm test');
  });

  it('ignores a review run — a reviewer does not judge itself', () => {
    const judged = withVerification(work('implement'), gates(false));
    // A verdict sitting on the REVIEW run's own record, which is not a verdict about the task's work.
    const reviewJudged = withVerification(rev('done'), gates(true));
    expect(outstandingVerdict([judged, reviewJudged], 'E-001')?.passed).toBe(false);
  });

  it('is scoped to the card', () => {
    const other = withVerification(work('implement', 'E-002'), gates(false));
    expect(outstandingVerdict([other], 'E-001')).toBeUndefined();
  });
});

// TWO RUNS INSIDE ONE SECOND, which is the ordinary case rather than a corner: a run id is
// `YYYYMMDD-HHMMSS-` plus a random four-character suffix, so an implement run and the fix that followed
// it seconds later have the same stamp and a suffix that decides nothing. Ordered by id alone, the fix
// here sorts FIRST, its predecessor's failed verdict stays outstanding, and the task is sent back to be
// fixed again and again until the cap blocks it.
describe('latest, when two runs share a second', () => {
  const inOneSecond = (
    skill: 'implement' | 'fix',
    id: string,
    started: string,
    over: Partial<RunRecord> = {},
  ): RunRecord =>
    withReport(
      { ...base({ skill, ...over }), run: `20260813-100000-${id}`, started },
      { outcome: 'success', summary: 'did it', body: '## What I did' },
      'T',
    );

  it('answers with the run that started later, not the one whose id sorts higher', () => {
    const implement = inOneSecond('implement', 'uzpn', '2026-08-13T10:00:00.536Z');
    const fix = inOneSecond('fix', 'oigs', '2026-08-13T10:00:00.616Z');
    expect(latestWorkRun([implement, fix], 'E-001')?.skill).toBe('fix');
    expect(latestWorkRun([fix, implement], 'E-001')?.skill).toBe('fix');
  });

  it('leaves no verdict outstanding when the later fix carries none', () => {
    // The whole failure in one assertion: the implement run's failed gates verdict must not be what the
    // task stands under once a fix has run, or the loop re-stamps it back to `in-progress` for ever.
    const implement = withVerification(
      inOneSecond('implement', 'uzpn', '2026-08-13T10:00:00.536Z'),
      gates(false),
    );
    const fix = inOneSecond('fix', 'oigs', '2026-08-13T10:00:00.616Z');
    expect(latestWorkRun([implement, fix], 'E-001')?.verification).toBeUndefined();
  });

  it('falls back to the id when neither run says when it started', () => {
    const first = inOneSecond('implement', 'aaaa', '');
    const second = inOneSecond('fix', 'zzzz', '');
    expect(latestWorkRun([second, first], 'E-001')?.skill).toBe('fix');
  });
});

describe('inconclusiveReviews', () => {
  it('counts a failed review run', () => {
    expect(inconclusiveReviews([died('review')], 'E-001')).toBe(1);
  });

  it('counts a review that finished and reported no verdict', () => {
    // `attention` FINISHED — it has a report — but a report with no `verdict:` decided nothing.
    const silent = withReport(base({ skill: 'review' }), { outcome: 'attention', body: 'I am unsure' }, 'T');
    expect(silent.status).toBe('attention');
    expect(inconclusiveReviews([silent], 'E-001')).toBe(1);
  });

  // THE ONE THAT MATTERS. Three healthy reviews must not stop the loop: `BURNS.success` is true, so a cap
  // over every review run would stall a perfectly healthy task at three — while the spec's own arithmetic
  // expects `attemptCap + 1` review runs per task.
  it('counts none of three completed reviews that each answered', () => {
    expect(inconclusiveReviews([rev('done'), rev('sent-back'), rev('done')], 'E-001')).toBe(0);
  });

  it('does not count a cancelled review — you stopped it', () => {
    // `burnsAttempt` is false for a cancellation, and a decision you took is not an attempt the agent had.
    const stopped = withoutReport(base({ skill: 'review' }), 'cancelled', 'You stopped it.', 'T');
    expect(inconclusiveReviews([stopped], 'E-001')).toBe(0);
  });

  it('does not count a work run that carries no verdict', () => {
    // Only a REVIEW is inconclusive for want of one: an implement run is never asked for a verdict, and
    // counting it would exhaust the review bound before a review had ever run.
    expect(inconclusiveReviews([work('implement'), died('fix')], 'E-001')).toBe(0);
  });

  it('is scoped to the card', () => {
    expect(inconclusiveReviews([died('review', 'E-002')], 'E-001')).toBe(0);
  });
});

// EVERY REVIEW A TASK HAS COST, which is the total the spec's arithmetic row states and which
// `inconclusiveReviews` deliberately does not count. It exists for the reviews that ANSWERED and still left
// the task in review — a verdict the endpoint refused, for instance.
describe('reviewsRun', () => {
  it('counts the reviews that answered, which the inconclusive bound does not', () => {
    const runs = [rev('done'), rev('sent-back'), rev('done')];
    expect(reviewsRun(runs, 'E-001')).toBe(3);
    expect(inconclusiveReviews(runs, 'E-001')).toBe(0);
  });

  it('counts an inconclusive review too, because it is still a review the task paid for', () => {
    expect(reviewsRun([died('review'), rev('done')], 'E-001')).toBe(2);
  });

  it('does not count a cancelled review — you stopped it', () => {
    const stopped = withoutReport(base({ skill: 'review' }), 'cancelled', 'You stopped it.', 'T');
    expect(reviewsRun([stopped], 'E-001')).toBe(0);
  });

  it('does not count the work runs, or another card’s reviews', () => {
    expect(reviewsRun([work('implement'), work('fix'), rev('done', 'E-002')], 'E-001')).toBe(0);
  });
});

describe('creatingRoundSpent', () => {
  const story = card('product', 'P-001', { columnSlug: 'in-progress' });

  it('is false when no checkup has run at this point', () => {
    expect(creatingRoundSpent([story], [], 'P-001', 'checkup-story')).toBe(false);
  });

  it("is true once a card on the board names one of this card's checkup runs as its creator", () => {
    // `createdBy`, stamped by the endpoint from the credential — NOT `created`, which the agent wrote.
    const checkup = withReport(
      base({ skill: 'checkup-story', card: 'P-001', board: 'product' }),
      { outcome: 'success', created: ['P-002'], body: '## Missing' },
      'T',
    );
    const cards = [story, card('product', 'P-002', { createdBy: checkup.run })];
    expect(creatingRoundSpent(cards, [checkup], 'P-001', 'checkup-story')).toBe(true);
  });

  it('is false when the checkup run CLAIMED a card it did not create', () => {
    // A run reporting `created: ['P-004']` with no such card on the board has spent no round. Finding F:
    // the report is the agent's claim about itself, and this is the second of the four places it applies.
    const boastful = withReport(
      base({ skill: 'checkup-story', card: 'P-001', board: 'product' }),
      { outcome: 'success', created: ['P-004'], body: '## Missing' },
      'T',
    );
    expect(creatingRoundSpent([story], [boastful], 'P-001', 'checkup-story')).toBe(false);
  });

  it('is false when the checkup ran and created nothing', () => {
    // Its ordinary CLOSING case (decision 47) — getting this the other way round refuses every close.
    const closed = withReport(
      base({ skill: 'checkup-story', card: 'P-001', board: 'product' }),
      { outcome: 'success', summary: 'nothing missing', body: '## Composed' },
      'T',
    );
    expect(creatingRoundSpent([story], [closed], 'P-001', 'checkup-story')).toBe(false);
  });

  it('is scoped to the skill, so a story checkup does not spend a feature checkup round', () => {
    const checkup = withReport(
      base({ skill: 'checkup-story', card: 'P-001', board: 'product' }),
      { outcome: 'success', created: ['P-002'], body: '## Missing' },
      'T',
    );
    const cards = [story, card('product', 'P-002', { createdBy: checkup.run })];
    expect(creatingRoundSpent(cards, [checkup], 'P-001', 'checkup-story')).toBe(true);
    expect(creatingRoundSpent(cards, [checkup], 'P-001', 'checkup-feature')).toBe(false);
  });

  it("is scoped to the card, so another story's checkup does not spend this one's round", () => {
    const elsewhere = withReport(
      base({ skill: 'checkup-story', card: 'P-009', board: 'product' }),
      { outcome: 'success', created: ['P-010'], body: '## Missing' },
      'T',
    );
    const cards = [story, card('product', 'P-010', { createdBy: elsewhere.run })];
    expect(creatingRoundSpent(cards, [elsewhere], 'P-001', 'checkup-story')).toBe(false);
  });
});
