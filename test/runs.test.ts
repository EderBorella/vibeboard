import { describe, expect, it } from 'vitest';
import { DOCS_DIR } from '../src/core/layout.js';
import {
  isInFlight,
  isRunId,
  needsResolution,
  parseAgentReport,
  parseRun,
  producedNothing,
  RUN_STATUSES,
  type RunRecord,
  runId,
  serializeRun,
  withFilesChanged,
  withoutReport,
  withReport,
  withResolution,
  withUsage,
} from '../src/core/runs.js';

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: '20260726-143012-a1b2',
  card: 'E-010',
  board: 'engineering',
  skill: 'execute',
  status: 'running',
  started: '2026-07-26T14:30:12.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

describe('runId', () => {
  it('is a sortable stamp plus the caller-supplied suffix', () => {
    expect(runId(new Date('2026-07-26T14:30:12.345Z'), 'a1b2')).toBe('20260726-143012-a1b2');
  });

  // The boundary, not a format check: this id becomes a filename, and it arrives from a URL segment
  // that Fastify decodes only AFTER the route has matched — so `%2F` was a `/` by the time the store
  // saw it. Every rejected case below is a separator or a parent reference.
  it('recognises what may become a filename, and refuses what could leave the folder', () => {
    expect(isRunId(runId(new Date('2026-07-26T14:30:12Z'), 'a1b2'))).toBe(true);
    expect(isRunId('r-asking')).toBe(true); // the fixtures' readable shape
    for (const bad of [
      '../../secret',
      '..',
      '.',
      'a/b',
      'a\\b',
      'a.md',
      '',
      'a b',
      '20260726-143012-a1b2/../x',
    ]) {
      expect(isRunId(bad), bad).toBe(false);
    }
  });

  it('sorts chronologically as a plain string, which is how the store orders a card history', () => {
    const ids = [
      runId(new Date('2026-07-26T14:30:12Z'), 'zz'),
      runId(new Date('2026-07-26T09:05:00Z'), 'aa'),
      runId(new Date('2026-07-25T23:59:59Z'), 'mm'),
    ];
    expect([...ids].sort()).toEqual([ids[2], ids[1], ids[0]]);
  });
});

describe('serializeRun / parseRun', () => {
  it('round-trips a full record', () => {
    const full = record({
      status: 'attention',
      outcome: 'attention',
      finished: '2026-07-26T14:41:55.000Z',
      previous: '20260726-141000-9f3e',
      prompt: 'focus on the token store',
      attached: [`${DOCS_DIR}/api.md`],
      summary: 'bigger than one card',
      options: ['split it', 'do the store only'],
      created: ['E-041', 'E-042'],
      usage: { costUsd: 0.0421, durationMs: 62431, turns: 7, contextTokens: 48210, outputTokens: 1832 },
      report: '## What I found\n\nThree cards, not one.',
    });
    expect(parseRun(serializeRun(full))).toEqual(full);
  });

  it('round-trips a minimal record without inventing fields', () => {
    const min = record();
    const parsed = parseRun(serializeRun(min));
    expect(parsed).toEqual(min);
    expect(Object.keys(parsed ?? {})).not.toContain('summary');
  });

  it('writes identity and state before the rest, so a diff reads top-down', () => {
    const text = serializeRun(record({ outcome: 'success', status: 'success' }));
    const keys = text
      .split('---')[1]
      .trim()
      .split('\n')
      .map((l) => l.split(':')[0]);
    expect(keys.slice(0, 6)).toEqual(['run', 'card', 'board', 'skill', 'status', 'outcome']);
  });

  it('keeps the report body verbatim, blank line and all', () => {
    const body = 'line one\n\n    indented\n- bullet';
    const parsed = parseRun(serializeRun(record({ report: body })));
    expect(parsed?.report).toBe(body);
  });

  it.each([
    ['no frontmatter at all', '# just a note\n'],
    ['missing run id', '---\ncard: E-1\nskill: x\nboard: engineering\nstatus: running\n---\n'],
    ['missing card', '---\nrun: r\nskill: x\nboard: engineering\nstatus: running\n---\n'],
    ['missing skill', '---\nrun: r\ncard: E-1\nboard: engineering\nstatus: running\n---\n'],
    ['missing board', '---\nrun: r\ncard: E-1\nskill: x\nstatus: running\n---\n'],
    ['unknown status', '---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\nstatus: dunno\n---\n'],
    ['no status', '---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\n---\n'],
  ])('refuses %s rather than inventing a run', (_case, content) => {
    // A results folder is ordinary disk. A stray file there must not become a phantom run.
    expect(parseRun(content)).toBeNull();
  });

  it('refuses malformed YAML instead of throwing', () => {
    expect(parseRun('---\nrun: [unclosed\n---\nbody\n')).toBeNull();
  });

  it('drops blank entries from a list rather than carrying empty strings', () => {
    const parsed = parseRun(
      '---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\nstatus: success\nattached: ["a.md", "  ", ""]\n---\nb\n',
    );
    expect(parsed?.attached).toEqual(['a.md']);
  });

  it('treats an all-blank list as absent', () => {
    const parsed = parseRun(
      '---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\nstatus: success\noptions: ["", " "]\n---\nb\n',
    );
    expect(parsed?.options).toBeUndefined();
  });
});

describe('withUsage', () => {
  it('attaches what the turn spent', () => {
    const spent = withUsage(record(), { costUsd: 0.01, turns: 2 });
    expect(spent.usage).toEqual({ costUsd: 0.01, turns: 2 });
  });

  it('leaves the record alone when the backend said nothing', () => {
    // Not `usage: {}` — a turn that never reported is different from one that reported zeros, and
    // the record should not claim otherwise.
    const before = record();
    expect(withUsage(before, undefined)).toBe(before);
  });

  it('does not mutate the record it is given', () => {
    const before = record();
    withUsage(before, { costUsd: 1 });
    expect(before.usage).toBeUndefined();
  });
});

describe('parseRun usage', () => {
  const withUsageYaml = (yaml: string): RunRecord | null =>
    parseRun(`---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\nstatus: success\n${yaml}---\nb\n`);

  it('keeps a zero cost, because a free model really did cost nothing', () => {
    // The trap this exists for: `if (usage.costUsd)` anywhere on the read or render path turns a
    // genuine zero into "unknown", and free models are the common case on OpenCode.
    const parsed = withUsageYaml('usage:\n  costUsd: 0\n  turns: 3\n');
    expect(parsed?.usage).toEqual({ costUsd: 0, turns: 3 });
  });

  it.each([
    ['a string', 'usage:\n  costUsd: "0.04"\n'],
    ['a negative', 'usage:\n  costUsd: -1\n'],
    ['not a number at all', 'usage:\n  costUsd: yesterday\n'],
    ['null', 'usage:\n  costUsd: null\n'],
    ['a nested object', 'usage:\n  costUsd:\n    amount: 4\n'],
  ])('drops %s rather than rendering it', (_case, yaml) => {
    expect(withUsageYaml(yaml)?.usage).toBeUndefined();
  });

  it('keeps the good fields when only some are junk', () => {
    expect(withUsageYaml('usage:\n  costUsd: bogus\n  durationMs: 1500\n')?.usage).toEqual({
      durationMs: 1500,
    });
  });

  it('ignores keys it does not know', () => {
    // Frontmatter is hand-editable, and a stray key must not reach the UI as a mystery row.
    expect(withUsageYaml('usage:\n  turns: 2\n  bananas: 9\n')?.usage).toEqual({ turns: 2 });
  });

  it.each([
    ['usage is a scalar', 'usage: 4\n'],
    ['usage is a string', 'usage: expensive\n'],
    ['usage is absent', ''],
    ['usage is an empty map', 'usage: {}\n'],
  ])('treats %s as no usage at all', (_case, yaml) => {
    expect(withUsageYaml(yaml)?.usage).toBeUndefined();
  });

  it('writes no usage key for a record that has none', () => {
    // An empty `usage: {}` in every old run file would be noise in a diff for no information.
    expect(serializeRun(record())).not.toContain('usage');
  });
});

describe('parseAgentReport', () => {
  it('reads the agent contract', () => {
    const text = [
      '---',
      'outcome: attention',
      'summary: Auth refactor is 3 cards, not 1',
      'options:',
      '  - Split into E-041/E-042 and close this',
      '  - Do just the token store now',
      'created: [E-041]',
      '---',
      '## What I found',
    ].join('\n');
    expect(parseAgentReport(text)).toEqual({
      outcome: 'attention',
      summary: 'Auth refactor is 3 cards, not 1',
      options: ['Split into E-041/E-042 and close this', 'Do just the token store now'],
      created: ['E-041'],
      body: '## What I found',
    });
  });

  it('defaults to attention when the agent claims no outcome', () => {
    // Silence is not success: an agent that did not say it succeeded gets looked at.
    expect(parseAgentReport('---\nsummary: did stuff\n---\nbody\n').outcome).toBe('attention');
  });

  it('defaults to attention for an outcome it does not recognise', () => {
    expect(parseAgentReport('---\noutcome: probably-fine\n---\nbody\n').outcome).toBe('attention');
  });

  it('keeps the body of a report with no frontmatter, still as attention', () => {
    expect(parseAgentReport('I did the thing.\n')).toEqual({
      outcome: 'attention',
      body: 'I did the thing.',
    });
  });

  it('keeps the whole text when the frontmatter is malformed', () => {
    const bad = '---\noutcome: [unclosed\n---\nstill worth reading\n';
    const report = parseAgentReport(bad);
    expect(report.outcome).toBe('attention');
    expect(report.body).toBe(bad.trim());
  });

  it('accepts success only when the agent says so exactly', () => {
    expect(parseAgentReport('---\noutcome: success\n---\ndone\n').outcome).toBe('success');
    expect(parseAgentReport('---\noutcome: Success\n---\ndone\n').outcome).toBe('attention');
  });
});

describe('withReport', () => {
  it('takes the agent verdict and body but keeps VibeBoard timings and dispatch', () => {
    const folded = withReport(
      record({ prompt: 'mine', attached: [`${DOCS_DIR}/a.md`] }),
      { outcome: 'success', summary: 'done', created: ['E-041'], body: '## Did it' },
      '2026-07-26T15:00:00.000Z',
    );
    expect(folded.status).toBe('success');
    expect(folded.outcome).toBe('success');
    expect(folded.finished).toBe('2026-07-26T15:00:00.000Z');
    expect(folded.summary).toBe('done');
    expect(folded.created).toEqual(['E-041']);
    expect(folded.report).toBe('## Did it');
    // The record's own fields survive an agent that rewrote its file wholesale.
    expect(folded.started).toBe('2026-07-26T14:30:12.000Z');
    expect(folded.model).toBe('opus');
    expect(folded.prompt).toBe('mine');
    expect(folded.attached).toEqual([`${DOCS_DIR}/a.md`]);
  });

  it('leaves optional agent fields absent when the report omits them', () => {
    const folded = withReport(record(), { outcome: 'success', body: 'x' }, 'T');
    expect(folded.summary).toBeUndefined();
    expect(folded.options).toBeUndefined();
    expect(folded.created).toBeUndefined();
  });

  it('sets status to attention for an attention report', () => {
    const folded = withReport(record(), { outcome: 'attention', body: 'x' }, 'T');
    expect(folded.status).toBe('attention');
  });
});

describe('withoutReport', () => {
  it('records the status the caller decided, with a note in place of a report', () => {
    const ended = withoutReport(record(), 'failed', 'exited with 1', 'T', '  tail of output  ');
    expect(ended.status).toBe('failed');
    expect(ended.note).toBe('exited with 1');
    expect(ended.finished).toBe('T');
    expect(ended.report).toBe('tail of output');
    expect(ended.outcome).toBeUndefined();
  });

  it('leaves an empty report when there is no transcript to show', () => {
    expect(withoutReport(record(), 'cancelled', 'you stopped it', 'T').report).toBe('');
  });
});

describe('isInFlight', () => {
  it('is true only for queued and running', () => {
    expect(RUN_STATUSES.filter(isInFlight)).toEqual(['queued', 'running']);
  });
});

describe('needsResolution', () => {
  it('is true for exactly the endings a person has to answer', () => {
    // Not `success` (finished work) and not `cancelled` (a decision already taken). Not queued or
    // running either: those have not ended, and stopping one is cancel, not a resolution.
    const asking = RUN_STATUSES.filter((status) => needsResolution(record({ status })));
    expect(asking).toEqual(['attention', 'failed', 'interrupted']);
  });

  it('is false once the run carries a resolution, whatever it says it was', () => {
    // The bug this exists for: without this field, an attention run asks for ever.
    for (const status of ['attention', 'failed', 'interrupted'] as const) {
      expect(needsResolution(record({ status, resolved: '2026-07-26T21:30:00.000Z' }))).toBe(false);
    }
  });
});

describe('withResolution', () => {
  it('stamps the record and changes nothing else', () => {
    const asking = record({ status: 'attention', outcome: 'attention', summary: 'bigger than one card' });
    expect(withResolution(asking, 'T')).toEqual({ ...asking, resolved: 'T' });
  });

  it('survives a round trip through the file, so a reload does not forget', () => {
    const resolved = withResolution(record({ status: 'attention' }), '2026-07-26T21:30:00.000Z');
    expect(parseRun(serializeRun(resolved))?.resolved).toBe('2026-07-26T21:30:00.000Z');
  });
});

// Asked before a card's work is verified: verifying nothing is how a card advances over work that never
// happened. Every clause must hold, so the tests below are mostly the ways it must answer NO.
describe('a run that produced nothing', () => {
  const empty = { status: 'failed' as const, filesChanged: 0 };

  it('is a failed run that delivered no report and changed no files', () => {
    expect(producedNothing(record(empty))).toBe(true);
  });

  // THE REAL COMPOSITION, and the reason this test exists rather than only the hand-built ones below. A review
  // found the predicate reading `record.report` — which `withoutReport` fills with the TRANSCRIPT TAIL exactly
  // when there is no agent report, so the answer was false for the one run it must catch. Every hand-built
  // fixture said `report: ''`, a shape the runner never writes, and all of them passed. Build the record the
  // way production builds it.
  it('is true for the record `withoutReport` actually writes for a dead run', () => {
    const dead = withFilesChanged(
      withoutReport(
        record({ status: 'running' }),
        'failed',
        'The agent exited with code 1 and wrote no report.',
        'T',
        '{"kind":"text","text":"\\n[opencode failed: fetch failed]"}',
      ),
      0,
    );
    // The transcript really is sitting in `report` — the premise of the bug, asserted so this test cannot
    // quietly stop being about it.
    expect(dead.report).not.toBe('');
    expect(producedNothing(dead)).toBe(true);
  });

  // And the other half of the same composition: a run that DID deliver a report is verifiable, whatever the
  // clock did to it afterwards. `withReport` is the only producer of `outcome`, which is what the predicate reads.
  it('is false for a run that delivered a report and was then failed by the clock', () => {
    const claimed = withReport(
      record({ status: 'running' }),
      { outcome: 'success', summary: 'did the work', body: '## What I did' },
      'T',
    );
    const killed = withFilesChanged({ ...claimed, status: 'failed' }, 0);
    expect(killed.outcome).toBe('success');
    expect(producedNothing(killed)).toBe(false);
  });

  it('is not a run that changed files, however it ended', () => {
    expect(producedNothing(record({ ...empty, filesChanged: 1 }))).toBe(false);
  });

  // Absent is not zero. A measurement that could not be taken says nothing about what changed, and reading it
  // as "nothing changed" would skip verification on a run that may have done the work.
  it('is not a run whose file count could not be taken', () => {
    expect(producedNothing(record({ status: 'failed', report: '' }))).toBe(false);
  });

  // `attention` FINISHED and said it could not do the work: it has a report, and a verdict is exactly what
  // should judge it. Only an outright failure with nothing behind it is unverifiable.
  it('is not a run that finished and said it could not do the work', () => {
    expect(producedNothing(record({ ...empty, status: 'attention', outcome: 'attention' }))).toBe(false);
  });

  it('is not a run still in flight', () => {
    expect(producedNothing(record({ ...empty, status: 'running' }))).toBe(false);
  });

  // The successful shape of every CARD-PRODUCING skill, and the reason `createdNothing` had to be a second
  // predicate rather than a clause added here: cards are created through the API, so a real derivation
  // legitimately changes no files and reports success. Not one of the three clauses holds, and it must not —
  // this run left plenty behind. Composed through withReport, not hand-built.
  it('is false for a run that created cards and changed no files', () => {
    const derived = withFilesChanged(
      withReport(
        record({ status: 'running', skill: 'derive-features', card: undefined, board: undefined }),
        { outcome: 'success', summary: 'five features', created: ['F-001', 'F-002'], body: '## What I did' },
        'T',
      ),
      0,
    );
    expect(derived.created).toEqual(['F-001', 'F-002']);
    expect(producedNothing(derived)).toBe(false);
  });
});

// The RECORD half of the review verdict. Moved here from Task 11 by the ruling of 2026-08-13, because
// core/bounds.ts counts inconclusive reviews and could not compile without it: a data field lands before
// its readers.
describe('a review run verdict', () => {
  it('parses a verdict of done and of sent-back', () => {
    for (const verdict of ['done', 'sent-back'] as const) {
      expect(parseRun(serializeRun(record({ skill: 'review', verdict })))?.verdict, verdict).toBe(verdict);
    }
  });

  it('drops a verdict that is neither', () => {
    // `verdict: maybe` is not an answer, and guessing at `done` would advance a card on a word nobody
    // defined. Absent is what an inconclusive review looks like, which is exactly the fact the bound counts.
    const raw = serializeRun(record({ skill: 'review' })).replace(
      'skill: review',
      'skill: review\nverdict: maybe',
    );
    expect(parseRun(raw)?.verdict).toBeUndefined();
  });

  it('round-trips verdict through serializeRun and parseRun', () => {
    const judged = record({ skill: 'review', status: 'success', outcome: 'success', verdict: 'sent-back' });
    expect(parseRun(serializeRun(judged))?.verdict).toBe('sent-back');
  });

  it('is absent from the file when the review reported none', () => {
    expect(parseRun(serializeRun(record({ skill: 'review' })))).not.toHaveProperty('verdict');
  });

  it("folds the agent's verdict onto the record through withReport", () => {
    const settled = withReport(
      record({ skill: 'review', status: 'running' }),
      { outcome: 'success', summary: 'does what the card asked', verdict: 'done', body: '## Judgement' },
      'T',
    );
    // `outcome` and `verdict` are DIFFERENT facts: the review's own turn went fine, and its answer is
    // about somebody else's work. A review that ran perfectly and sent the work back is success/sent-back.
    expect(settled.outcome).toBe('success');
    expect(settled.verdict).toBe('done');
  });

  it('leaves verdict absent when the report carried none', () => {
    const settled = withReport(
      record({ skill: 'review', status: 'running' }),
      { outcome: 'success', body: 'I had a look' },
      'T',
    );
    expect(settled.verdict).toBeUndefined();
  });
});

describe('the suggestion count on a run record', () => {
  it('survives a round trip through the file', () => {
    const withCount = { ...record(), suggestions: 3 };
    expect(parseRun(serializeRun(withCount))?.suggestions).toBe(3);
  });

  it('is absent, not zero, when the run filed none', () => {
    expect(parseRun(serializeRun(record()))).not.toHaveProperty('suggestions');
  });

  it('drops a value that is not a count', () => {
    // A hand-edited or half-written file can put anything here, and a NaN reaching the checkup's
    // arithmetic is worse than no number at all.
    for (const bad of ['-1', 'many', 'null']) {
      const text = serializeRun(record()).replace('---\n', `---\nsuggestions: ${bad}\n`);
      expect(parseRun(text), bad).not.toHaveProperty('suggestions');
    }
    // Zero IS a count, and is kept when written by hand.
    const zero = serializeRun(record()).replace('---\n', '---\nsuggestions: 0\n');
    expect(parseRun(zero)?.suggestions).toBe(0);
  });
});

// A judging run's report — the critic's. It carries a SCORE rather than a bare verdict (S9): a binary
// pass yields no distribution, and the promise to judge the critic itself from data later needs the
// numbers to have been written down.
describe('a judging run’s report', () => {
  it('carries a score and any overshoot it noticed', () => {
    const report = parseAgentReport(
      [
        '---',
        'outcome: success',
        'summary: Meets the criterion.',
        'score: 0.8',
        'overshoot: Also built a settings screen.',
        '---',
        'Body.',
      ].join('\n'),
    );
    expect(report.score).toBe(0.8);
    expect(report.overshoot).toBe('Also built a settings screen.');
  });

  // Zero is a judgement: the critic read the work and thought it worthless. Absence is not, and
  // neither is 4 — which would clear every threshold there is.
  it('keeps a zero score and drops one that is not a fraction', () => {
    expect(parseAgentReport('---\nscore: 0\n---\nx').score).toBe(0);
    expect(parseAgentReport('---\nscore: 4\n---\nx').score).toBeUndefined();
    expect(parseAgentReport('---\nscore: high\n---\nx').score).toBeUndefined();
    expect(parseAgentReport('---\noutcome: success\n---\nx').score).toBeUndefined();
  });

  it('folds both onto the record, so the critic’s own run keeps what it answered', () => {
    const folded = withReport(
      record(),
      parseAgentReport('---\noutcome: success\nscore: 0.7\novershoot: extra\n---\nx'),
      'AT',
    );
    expect(folded).toMatchObject({ score: 0.7, overshoot: 'extra' });
  });

  // The review's false gate. The folding test above uses 0.7, and the zero-score tests build the record
  // literal directly — so the guard on the one path that WRITES a critic's answer was unconstrained, and
  // a critic reporting 0 lost it exactly where Principle 3 matters most.
  it('folds a score of ZERO, which is a critic that judged the work worthless', () => {
    const folded = withReport(record(), parseAgentReport('---\noutcome: success\nscore: 0\n---\nx'), 'AT');
    expect(folded.score).toBe(0);
  });

  it('leaves an ordinary report with neither', () => {
    const folded = withReport(record(), parseAgentReport('---\noutcome: success\n---\nx'), 'AT');
    expect(folded.score).toBeUndefined();
    expect(folded.overshoot).toBeUndefined();
  });
});
