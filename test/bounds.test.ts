import { describe, expect, it } from 'vitest';
import { creatingRoundSpent, inconclusiveReviews, outstandingVerdict } from '../src/core/bounds.js';
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

// Ids ascend with creation order, because run ids are sortable stamps and the whole codebase reads
// "latest" off them (src/server/run-store.ts:116-122,172).
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
