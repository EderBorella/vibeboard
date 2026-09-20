import { describe, expect, it } from 'vitest';
import { creatingRoundSpent, inconclusiveReviews, latestWorkRun, reviewsRun } from '../src/core/bounds.js';
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
// (`producedNothing` in src/core/runs/predicates.ts, whose comment records the whole failure).

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

// A run that did the work and delivered a report. ON PRODUCT, and that is decision 83 rather than a
// fixture preference: `isWorkRun` reads the phase table, and since the work moved up to the story the runs
// a verdict can land on are a story's break-down, its implement and its fix. A run on engineering is in no
// phase at all.
const work = (skill: 'break-down' | 'implement-story' | 'fix', card = 'P-001'): RunRecord =>
  withReport(
    base({ skill, card, board: 'product' }),
    { outcome: 'success', summary: 'did it', body: '## What I did' },
    'T',
  );

// A run that DIED: no report at all, which is exactly the shape that must not clear an earlier verdict.
const died = (skill: string, card = 'P-001'): RunRecord =>
  withoutReport(
    base({ skill, card, board: 'product' }),
    'failed',
    'The agent exited with code 1 and wrote no report.',
    'T',
  );

const gates = (passed: boolean): Verification =>
  passed
    ? { mode: 'gates', passed: true, at: 'T' }
    : { mode: 'gates', passed: false, at: 'T', command: 'npm test', output: '1 failed' };

// THE JUDGEMENT, which is a STORY's since decision 80: `review-story` on product, and `isReviewRun` reads
// the phase table, so a run recorded on any other board is not one.
const rev = (verdict: ReviewVerdict, card = 'P-001'): RunRecord =>
  withReport(
    base({ skill: 'review-story', card, board: 'product' }),
    { outcome: 'success', verdict, body: '## Judgement' },
    'T',
  );

// A judgement that ended and answered nothing.
const judgeDied = (card = 'P-001'): RunRecord =>
  withoutReport(
    base({ skill: 'review-story', card, board: 'product' }),
    'failed',
    'The agent exited with code 1 and wrote no report.',
    'T',
  );

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

// `outstandingVerdict` HAD A SUITE HERE, and it went with the lookup (decision 83). It answered "the
// latest work run that CARRIES a verdict", which is how a task in `in-progress` told a fix from an
// implement — a question no card is asked now that the work and the judgement are both the story's.
// What survives of it is the ordering suite below, which is where the bug it was written around lives.
describe('latestWorkRun', () => {
  it('is absent for a story with no runs', () => {
    expect(latestWorkRun([], 'P-001')).toBeUndefined();
  });

  // THE RUN UNDER JUDGEMENT, whether or not it has been judged: that is the difference from the lookup
  // that went, and it is what lets a story that was sent back and fixed pass.
  it('answers with the latest work run even when it carries no verdict', () => {
    const judged = withVerification(work('implement-story'), gates(false));
    const fix = work('fix');
    expect(latestWorkRun([judged, fix], 'P-001')?.skill).toBe('fix');
    expect(latestWorkRun([judged, fix], 'P-001')?.verification).toBeUndefined();
  });

  it('ignores a review run — a reviewer does not judge itself', () => {
    const judged = withVerification(work('implement-story'), gates(false));
    expect(latestWorkRun([judged, rev('done')], 'P-001')?.skill).toBe('implement-story');
  });

  // A TASK HAS NO WORK RUN OF ITS OWN. Every phase on engineering has gone, so a run recorded there is in
  // no phase — which is what stops a hand-dispatched `fix` on a task becoming a run a verdict lands on.
  it('is absent for a run on the engineering board, which is in no phase at all', () => {
    const byHand = withReport(
      base({ skill: 'fix', card: 'E-001', board: 'engineering' }),
      { outcome: 'success', summary: 'did it', body: '## What I did' },
      'T',
    );
    expect(latestWorkRun([byHand], 'E-001')).toBeUndefined();
  });

  it('is scoped to the card', () => {
    expect(latestWorkRun([work('implement-story', 'P-002')], 'P-001')).toBeUndefined();
  });
});

// TWO RUNS INSIDE ONE SECOND, which is the ordinary case rather than a corner: a run id is
// `YYYYMMDD-HHMMSS-` plus a random four-character suffix, so an implement run and the fix that followed
// it seconds later have the same stamp and a suffix that decides nothing. Ordered by id alone, the fix
// here sorts FIRST, its predecessor's failed verdict stays outstanding, and the task is sent back to be
// fixed again and again until the cap blocks it.
describe('latest, when two runs share a second', () => {
  const inOneSecond = (
    skill: 'implement-story' | 'fix',
    id: string,
    started: string,
    over: Partial<RunRecord> = {},
  ): RunRecord =>
    withReport(
      { ...base({ skill, card: 'P-001', board: 'product', ...over }), run: `20260813-100000-${id}`, started },
      { outcome: 'success', summary: 'did it', body: '## What I did' },
      'T',
    );

  it('answers with the run that started later, not the one whose id sorts higher', () => {
    const implement = inOneSecond('implement-story', 'uzpn', '2026-08-13T10:00:00.536Z');
    const fix = inOneSecond('fix', 'oigs', '2026-08-13T10:00:00.616Z');
    expect(latestWorkRun([implement, fix], 'P-001')?.skill).toBe('fix');
    expect(latestWorkRun([fix, implement], 'P-001')?.skill).toBe('fix');
  });

  it('leaves no verdict outstanding when the later fix carries none', () => {
    // The whole failure in one assertion: the implement run's failed gates verdict must not be what the
    // card stands under once a fix has run, or the loop re-stamps it back to `in-progress` for ever. Found
    // at task level and moved up with the machine — the lookup is the same and so is the bug.
    const implement = withVerification(
      inOneSecond('implement-story', 'uzpn', '2026-08-13T10:00:00.536Z'),
      gates(false),
    );
    const fix = inOneSecond('fix', 'oigs', '2026-08-13T10:00:00.616Z');
    expect(latestWorkRun([implement, fix], 'P-001')?.verification).toBeUndefined();
  });

  it('falls back to the id when neither run says when it started', () => {
    const first = inOneSecond('implement-story', 'aaaa', '');
    const second = inOneSecond('fix', 'zzzz', '');
    expect(latestWorkRun([second, first], 'P-001')?.skill).toBe('fix');
  });
});

describe('inconclusiveReviews', () => {
  it('counts a failed review run', () => {
    expect(inconclusiveReviews([judgeDied()], 'P-001')).toBe(1);
  });

  it('counts a review that finished and reported no verdict', () => {
    // `attention` FINISHED — it has a report — but a report with no `verdict:` decided nothing.
    const silent = withReport(
      base({ skill: 'review-story', card: 'P-001', board: 'product' }),
      { outcome: 'attention', body: 'I am unsure' },
      'T',
    );
    expect(silent.status).toBe('attention');
    expect(inconclusiveReviews([silent], 'P-001')).toBe(1);
  });

  // THE ONE THAT MATTERS. Three healthy reviews must not stop the loop: `BURNS.success` is true, so a cap
  // over every review run would stall a perfectly healthy task at three — while the spec's own arithmetic
  // expects `attemptCap + 1` review runs per task.
  it('counts none of three completed reviews that each answered', () => {
    expect(inconclusiveReviews([rev('done'), rev('sent-back'), rev('done')], 'P-001')).toBe(0);
  });

  // THE E-022 CASE, closed 2026-09-01. A review whose report the SERVER could not read is not the work
  // failing, and it must not sit in the count for ever: the bound reads records off disk, so three of
  // these left the card at its cap even after the parsing bug behind them was fixed and the server
  // rebuilt. The only way back was moving files out of `results/` by hand.
  it('does not count a review whose report the server could not read', () => {
    const unreadable = withReport(
      base({ skill: 'review-story', card: 'P-001', board: 'product' }),
      { outcome: 'attention', body: 'judged', unreadable: 'its verdict reads "maybe"' },
      'T',
    );
    expect(unreadable.fault).toBe('unreadable-report');
    expect(unreadable.verdict).toBeUndefined(); // so the OLD rule would have counted it
    expect(inconclusiveReviews([unreadable], 'P-001')).toBe(0);
  });

  it('does not count a cancelled review — you stopped it', () => {
    // `burnsAttempt` is false for a cancellation, and a decision you took is not an attempt the agent had.
    const stopped = withoutReport(
      base({ skill: 'review-story', card: 'P-001', board: 'product' }),
      'cancelled',
      'You stopped it.',
      'T',
    );
    expect(inconclusiveReviews([stopped], 'P-001')).toBe(0);
  });

  it('does not count a work run that carries no verdict', () => {
    // Only a REVIEW is inconclusive for want of one: an implement run is never asked for a verdict, and
    // counting it would exhaust the review bound before a review had ever run.
    expect(inconclusiveReviews([work('implement-story'), died('fix')], 'P-001')).toBe(0);
  });

  it('is scoped to the card', () => {
    expect(inconclusiveReviews([judgeDied('P-002')], 'P-001')).toBe(0);
  });
});

// EVERY REVIEW A STORY HAS COST, which is the total the spec's arithmetic row states and which
// `inconclusiveReviews` deliberately does not count. It exists for the reviews that ANSWERED and still left
// the card open — a verdict the endpoint refused, for instance.
describe('reviewsRun', () => {
  it('counts the reviews that answered, which the inconclusive bound does not', () => {
    const runs = [rev('done'), rev('sent-back'), rev('done')];
    expect(reviewsRun(runs, 'P-001')).toBe(3);
    expect(inconclusiveReviews(runs, 'P-001')).toBe(0);
  });

  it('counts an inconclusive review too, because it is still a review the card paid for', () => {
    expect(reviewsRun([judgeDied(), rev('done')], 'P-001')).toBe(2);
  });

  it('does not count a cancelled review — you stopped it', () => {
    const stopped = withoutReport(
      base({ skill: 'review-story', card: 'P-001', board: 'product' }),
      'cancelled',
      'You stopped it.',
      'T',
    );
    expect(reviewsRun([stopped], 'P-001')).toBe(0);
  });

  it('does not count the work runs, or another card’s reviews', () => {
    expect(reviewsRun([work('implement-story'), work('fix'), rev('done', 'P-002')], 'P-001')).toBe(0);
  });
});

describe('creatingRoundSpent', () => {
  const story = card('product', 'P-001', { columnSlug: 'in-progress' });

  it('is false when no judgement has run at this point', () => {
    expect(creatingRoundSpent([story], [], 'P-001', 'review-story')).toBe(false);
  });

  it("is true once a card on the board names one of this card's checkup runs as its creator", () => {
    // `createdBy`, stamped by the endpoint from the credential — NOT `created`, which the agent wrote.
    const checkup = withReport(
      base({ skill: 'review-story', card: 'P-001', board: 'product' }),
      { outcome: 'success', created: ['P-002'], body: '## Missing' },
      'T',
    );
    const cards = [story, card('product', 'P-002', { createdBy: checkup.run })];
    expect(creatingRoundSpent(cards, [checkup], 'P-001', 'review-story')).toBe(true);
  });

  it('is false when the checkup run CLAIMED a card it did not create', () => {
    // A run reporting `created: ['P-004']` with no such card on the board has spent no round. Finding F:
    // the report is the agent's claim about itself, and this is the second of the four places it applies.
    const boastful = withReport(
      base({ skill: 'review-story', card: 'P-001', board: 'product' }),
      { outcome: 'success', created: ['P-004'], body: '## Missing' },
      'T',
    );
    expect(creatingRoundSpent([story], [boastful], 'P-001', 'review-story')).toBe(false);
  });

  it('is false when the checkup ran and created nothing', () => {
    // Its ordinary CLOSING case (decision 47) — getting this the other way round refuses every close.
    const closed = withReport(
      base({ skill: 'review-story', card: 'P-001', board: 'product' }),
      { outcome: 'success', summary: 'nothing missing', body: '## Composed' },
      'T',
    );
    expect(creatingRoundSpent([story], [closed], 'P-001', 'review-story')).toBe(false);
  });

  it('is scoped to the skill, so a story judgement does not spend a feature checkup round', () => {
    const checkup = withReport(
      base({ skill: 'review-story', card: 'P-001', board: 'product' }),
      { outcome: 'success', created: ['P-002'], body: '## Missing' },
      'T',
    );
    const cards = [story, card('product', 'P-002', { createdBy: checkup.run })];
    expect(creatingRoundSpent(cards, [checkup], 'P-001', 'review-story')).toBe(true);
    expect(creatingRoundSpent(cards, [checkup], 'P-001', 'checkup-feature')).toBe(false);
  });

  it("is scoped to the card, so another story's judgement does not spend this one's round", () => {
    const elsewhere = withReport(
      base({ skill: 'review-story', card: 'P-009', board: 'product' }),
      { outcome: 'success', created: ['P-010'], body: '## Missing' },
      'T',
    );
    const cards = [story, card('product', 'P-010', { createdBy: elsewhere.run })];
    expect(creatingRoundSpent(cards, [elsewhere], 'P-001', 'review-story')).toBe(false);
  });
});
