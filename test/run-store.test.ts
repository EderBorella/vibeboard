import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attemptsUsed, burnsAttempt } from '../src/core/accounting.js';
import { boardRel, CONFIG_DIR, CONFIG_FILE, DOCS_DIR, RESULTS_DIR, RUNS_DIR } from '../src/core/layout.js';
import { type RunRecord, runId } from '../src/core/runs.js';
import { isIgnored } from '../src/server/boards/session.js';
import {
  appendTranscript,
  foldReport,
  forgiveCardRuns,
  forgiveProjectRuns,
  listCardRuns,
  listProjectRuns,
  listRuns,
  markInterrupted,
  projectRunPath,
  readRun,
  recordPath,
  reportContract,
  reportPath,
  resolveCardRuns,
  resolveRun,
  takeAgentReport,
  transcriptTail,
  writeRun,
} from '../src/store/run-store.js';
import { tempDir } from './helpers.js';

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

describe('run records on disk', () => {
  it('writes beside the card, in a results folder the board never reads', async () => {
    const root = await tempDir();
    await writeRun(root, record());
    expect(recordPath(root, 'engineering', 'E-010', '20260726-143012-a1b2')).toBe(
      join(root, boardRel('engineering', RESULTS_DIR, 'E-010', '20260726-143012-a1b2.md')),
    );
    // `results` is not a configured column, so readBoard cannot see it — this is the whole reason
    // the record can live next to the card.
    const { readBoard } = await import('../src/store/cards/board.js');
    const { defaultConfig } = await import('../src/store/project/config.js');
    expect(await readBoard(root, 'engineering', defaultConfig('T'))).toEqual([]);
  });

  it('reads back what it wrote', async () => {
    const root = await tempDir();
    const written = record({ prompt: 'do it', attached: [`${DOCS_DIR}/a.md`] });
    await writeRun(root, written);
    expect(await readRun(root, 'engineering', 'E-010', written.run)).toEqual(written);
  });

  it('is null for a run that does not exist', async () => {
    expect(await readRun(await tempDir(), 'engineering', 'E-404', 'nope')).toBeNull();
  });

  it('creates the card folder on first write rather than requiring one', async () => {
    const root = await tempDir();
    await writeRun(root, record({ card: 'P-001', board: 'product' }));
    expect(await readRun(root, 'product', 'P-001', record().run)).not.toBeNull();
  });
});

describe('listCardRuns', () => {
  it('lists a card history oldest first, by id alone', async () => {
    // Ids are sortable stamps, so filename order IS chronological order — no file is opened to sort.
    const root = await tempDir();
    const ids = [
      runId(new Date('2026-07-26T15:00:00Z'), 'c'),
      runId(new Date('2026-07-26T09:00:00Z'), 'a'),
      runId(new Date('2026-07-26T12:00:00Z'), 'b'),
    ];
    for (const id of ids) await writeRun(root, record({ run: id }));
    expect((await listCardRuns(root, 'engineering', 'E-010')).map((r) => r.run)).toEqual([...ids].sort());
  });

  it('is empty for a card that has never been run', async () => {
    expect(await listCardRuns(await tempDir(), 'engineering', 'E-001')).toEqual([]);
  });

  it('ignores a file in the results folder that is not a run record', async () => {
    // A results folder is ordinary disk: a note someone dropped there is not a phantom run.
    const root = await tempDir();
    await writeRun(root, record());
    const dir = join(root, boardRel('engineering', RESULTS_DIR, 'E-010'));
    await writeFile(join(dir, 'notes.md'), '# just my notes\n', 'utf8');
    await writeFile(join(dir, 'half.md'), '---\nrun: x\n---\nincomplete\n', 'utf8');
    expect((await listCardRuns(root, 'engineering', 'E-010')).map((r) => r.run)).toEqual([record().run]);
  });
});

describe('listRuns', () => {
  it('gathers every board newest first', async () => {
    const root = await tempDir();
    await writeRun(root, record({ run: '20260726-090000-a', card: 'E-1' }));
    await writeRun(root, record({ run: '20260726-150000-b', card: 'P-1', board: 'product' }));
    await writeRun(root, record({ run: '20260726-120000-c', card: 'F-1', board: 'features' }));
    expect((await listRuns(root)).map((r) => r.run)).toEqual([
      '20260726-150000-b',
      '20260726-120000-c',
      '20260726-090000-a',
    ]);
  });

  it('is empty for a project that has never run anything', async () => {
    expect(await listRuns(await tempDir())).toEqual([]);
  });

  it('ignores a loose file where card folders live', async () => {
    const root = await tempDir();
    await writeRun(root, record());
    await writeFile(join(root, boardRel('engineering', RESULTS_DIR, 'stray.md')), 'hello\n', 'utf8');
    expect(await listRuns(root)).toHaveLength(1);
  });
});

describe('the agent report handoff', () => {
  it('tells the agent a path under .vibeboard, never inside a card folder', async () => {
    // The record's frontmatter is ours. Agents rewrite files wholesale, so they get their own path.
    expect(reportContract('r1')).toBe(`${RUNS_DIR}/r1.report.md`);
    const root = await tempDir();
    expect(reportPath(root, 'r1')).toBe(join(root, RUNS_DIR, 'r1.report.md'));
  });

  it('is not watched, so a streaming run does not churn the board', () => {
    expect(isIgnored(`/p/${RUNS_DIR}/r1.report.md`)).toBe(true);
    expect(isIgnored(`/p/${RUNS_DIR}/r1.log.jsonl`)).toBe(true);
    // The record itself IS watched: writing one should refresh the card's reports. It now sits
    // inside the config folder like the runs scratch area, so "ignore .vibeboard" would break it.
    expect(isIgnored(`/p/${boardRel('engineering', RESULTS_DIR, 'E-010', 'r1.md')}`)).toBe(false);
    expect(isIgnored(`/p/${CONFIG_DIR}/${CONFIG_FILE}`)).toBe(false);
  });

  it('consumes the report, so a later run cannot inherit an earlier one', async () => {
    const root = await tempDir();
    await mkdir(join(root, RUNS_DIR), { recursive: true });
    await writeFile(reportPath(root, 'r1'), '---\noutcome: success\n---\ndone\n', 'utf8');
    expect(await takeAgentReport(root, 'r1')).toContain('outcome: success');
    expect(await takeAgentReport(root, 'r1')).toBeNull();
  });

  it('is null when the agent wrote nothing', async () => {
    expect(await takeAgentReport(await tempDir(), 'r1')).toBeNull();
  });

  it('folds a report into the record on disk, keeping our own fields', async () => {
    const root = await tempDir();
    const started = record({ prompt: 'mine' });
    await writeRun(root, started);
    await mkdir(join(root, RUNS_DIR), { recursive: true });
    await writeFile(
      reportPath(root, started.run),
      '---\noutcome: success\nsummary: all done\ncreated: [E-041]\n---\n## Did it\n',
      'utf8',
    );

    const folded = await foldReport(root, started, '2026-07-26T15:00:00.000Z');
    expect(folded?.status).toBe('success');
    const onDisk = await readRun(root, 'engineering', 'E-010', started.run);
    expect(onDisk?.status).toBe('success');
    expect(onDisk?.outcome).toBe('success');
    expect(onDisk?.summary).toBe('all done');
    expect(onDisk?.created).toEqual(['E-041']);
    expect(onDisk?.report).toBe('## Did it');
    expect(onDisk?.finished).toBe('2026-07-26T15:00:00.000Z');
    expect(onDisk?.prompt).toBe('mine'); // ours, not the agent's to lose
  });

  // DECISION 10, AS A FILE CHECK. A report that names a different run is not folded in — the run is
  // recorded, the agent's verdict is discarded, and the card is not charged for it.
  it('refuses a report that declares a different run, and does not charge the card', async () => {
    const root = await tempDir();
    const started = record();
    await writeRun(root, started);
    await mkdir(join(root, RUNS_DIR), { recursive: true });
    await writeFile(
      reportPath(root, started.run),
      '---\nrun: 20260101-000000-zzzz\noutcome: success\nverdict: done\ncreated: [E-999]\n---\n## Not mine\n',
      'utf8',
    );

    const warned: { run?: string; reason?: string }[] = [];
    const log = {
      debug() {},
      info() {},
      warn(obj: object) {
        warned.push(obj as { run?: string; reason?: string });
      },
      error() {},
      fatal() {},
      child() {
        return log;
      },
    };

    const folded = await foldReport(root, started, '2026-07-26T15:00:00.000Z', undefined, log);
    expect(folded?.fault).toBe('unreadable-report');
    // EVERY DECISION IN IT GOES, not only the verdict — a report that does not know which run it belongs
    // to cannot decide that run's outcome. Found in review: dropping the verdict alone left
    // `outcome: success` intact, so a foreign report was recorded as a successful run, and `created:`
    // brought another run's card ids into this one's record.
    expect(folded?.verdict).toBeUndefined();
    expect(folded?.status).toBe('attention');
    expect(folded?.outcome).toBe('attention');
    expect(folded?.created).toBeUndefined();
    // FREE, BUT NOT SILENT — the ruling's own condition. The record carries the fault and the log says so.
    expect(burnsAttempt(folded as RunRecord)).toBe(false);
    expect(warned).toHaveLength(1);
    expect(warned[0]?.reason).toContain('20260101-000000-zzzz');
  });

  it('folds a report that declares the RIGHT run, with no fault and no warning', async () => {
    const root = await tempDir();
    const started = record();
    await writeRun(root, started);
    await mkdir(join(root, RUNS_DIR), { recursive: true });
    await writeFile(
      reportPath(root, started.run),
      `---\nrun: ${started.run}\noutcome: success\n---\n## Mine\n`,
      'utf8',
    );
    const folded = await foldReport(root, started, '2026-07-26T15:00:00.000Z');
    expect(folded?.fault).toBeUndefined();
    expect(folded?.status).toBe('success');
  });

  it('reports null and leaves the record alone when there is no report', async () => {
    const root = await tempDir();
    await writeRun(root, record());
    expect(await foldReport(root, record(), 'T')).toBeNull();
    expect((await readRun(root, 'engineering', 'E-010', record().run))?.status).toBe('running');
  });
});

describe('transcripts', () => {
  it('appends lines and returns the tail', async () => {
    const root = await tempDir();
    for (const n of [1, 2, 3]) await appendTranscript(root, 'r1', `line ${n}`);
    expect(await transcriptTail(root, 'r1')).toBe('line 1\nline 2\nline 3');
  });

  it('keeps only the last N lines, since the tail exists to be read by a human', async () => {
    const root = await tempDir();
    for (let n = 1; n <= 10; n++) await appendTranscript(root, 'r1', `line ${n}`);
    expect(await transcriptTail(root, 'r1', 3)).toBe('line 8\nline 9\nline 10');
  });

  it('is empty for a run with no transcript', async () => {
    expect(await transcriptTail(await tempDir(), 'r1')).toBe('');
  });
});

describe('markInterrupted', () => {
  it('ends in-flight records on open, because their processes died with the server', async () => {
    const root = await tempDir();
    await writeRun(root, record({ run: 'r-running', status: 'running' }));
    await writeRun(root, record({ run: 'r-queued', status: 'queued' }));
    await writeRun(root, record({ run: 'r-done', status: 'success' }));

    expect(await markInterrupted(root, '2026-07-27T08:00:00.000Z')).toBe(2);
    const byId = new Map((await listCardRuns(root, 'engineering', 'E-010')).map((r) => [r.run, r]));
    expect(byId.get('r-running')?.status).toBe('interrupted');
    expect(byId.get('r-queued')?.status).toBe('interrupted');
    expect(byId.get('r-done')?.status).toBe('success');
    expect(byId.get('r-running')?.note).toBe('VibeBoard restarted while this run was in flight');
    expect(byId.get('r-running')?.finished).toBe('2026-07-27T08:00:00.000Z');
  });

  it('does nothing, and says so, for a project with no runs', async () => {
    expect(await markInterrupted(await tempDir(), 'T')).toBe(0);
  });

  // Reopening the project you already have open is an ordinary thing to do from the picker. Without
  // this, it rewrites the run in flight to `interrupted` — a status the record keeps even as the
  // agent finishes and writes its report, and one that burns no attempt against the cap.
  it('leaves a run this process is still running alone', async () => {
    const root = await tempDir();
    // Two in flight, one of them live: with a single record, "skip the live one" and "skip
    // everything" produce the same count.
    await writeRun(root, record({ run: 'r-live', status: 'running' }));
    await writeRun(root, record({ run: 'r-stale', status: 'running' }));

    expect(await markInterrupted(root, 'T', ['r-live'])).toBe(1);
    const byId = new Map((await listCardRuns(root, 'engineering', 'E-010')).map((r) => [r.run, r]));
    expect(byId.get('r-live')?.status).toBe('running');
    expect(byId.get('r-stale')?.status).toBe('interrupted');
  });

  it('leaves a finished record byte-identical', async () => {
    const root = await tempDir();
    const done = record({ status: 'success', outcome: 'success', finished: 'T0', report: 'ok' });
    await writeRun(root, done);
    const before = await readFile(recordPath(root, 'engineering', 'E-010', done.run), 'utf8');
    await markInterrupted(root, 'T1');
    expect(await readFile(recordPath(root, 'engineering', 'E-010', done.run), 'utf8')).toBe(before);
  });
});

describe('resolveRun', () => {
  it('stamps the record on disk, so a reload still knows it was dealt with', async () => {
    const root = await tempDir();
    await writeRun(root, record({ status: 'attention' }));
    const resolved = await resolveRun(root, 'engineering', 'E-010', record().run, 'T');
    expect(resolved?.resolved).toBe('T');
    expect((await readRun(root, 'engineering', 'E-010', record().run))?.resolved).toBe('T');
  });

  it('keeps the status it ended with — the decision is a second fact, not a replacement', async () => {
    const root = await tempDir();
    await writeRun(root, record({ status: 'attention', outcome: 'attention', summary: 'too big' }));
    const resolved = await resolveRun(root, 'engineering', 'E-010', record().run, 'T');
    expect(resolved?.status).toBe('attention');
    expect(resolved?.summary).toBe('too big');
  });

  it('is a no-op the second time, rather than restamping', async () => {
    // Both the dashboard and the card offer this, and a move into the last column does it too.
    const root = await tempDir();
    await writeRun(root, record({ status: 'attention' }));
    await resolveRun(root, 'engineering', 'E-010', record().run, 'FIRST');
    const again = await resolveRun(root, 'engineering', 'E-010', record().run, 'SECOND');
    expect(again?.resolved).toBe('FIRST');
  });

  it('leaves a run that was never asking byte-identical', async () => {
    const root = await tempDir();
    const done = record({ status: 'success', outcome: 'success', finished: 'T0', report: 'ok' });
    await writeRun(root, done);
    const before = await readFile(recordPath(root, 'engineering', 'E-010', done.run), 'utf8');
    expect((await resolveRun(root, 'engineering', 'E-010', done.run, 'T1'))?.resolved).toBeUndefined();
    expect(await readFile(recordPath(root, 'engineering', 'E-010', done.run), 'utf8')).toBe(before);
  });

  it('refuses to resolve a run that has not ended', async () => {
    // Stopping a live run is cancel. Resolving one would file a running process under history.
    const root = await tempDir();
    await writeRun(root, record({ status: 'running' }));
    expect((await resolveRun(root, 'engineering', 'E-010', record().run, 'T'))?.resolved).toBeUndefined();
  });

  it('answers null for a run that does not exist', async () => {
    expect(await resolveRun(await tempDir(), 'engineering', 'E-010', 'nope', 'T')).toBeNull();
  });
});

describe('resolveCardRuns', () => {
  it('resolves every run still asking, and counts them', async () => {
    const root = await tempDir();
    await writeRun(root, record({ run: 'r-attention', status: 'attention' }));
    await writeRun(root, record({ run: 'r-failed', status: 'failed' }));
    await writeRun(root, record({ run: 'r-interrupted', status: 'interrupted' }));
    await writeRun(root, record({ run: 'r-success', status: 'success' }));
    await writeRun(root, record({ run: 'r-already', status: 'attention', resolved: 'EARLIER' }));

    expect(await resolveCardRuns(root, 'engineering', 'E-010', 'T')).toBe(3);
    const byId = new Map((await listCardRuns(root, 'engineering', 'E-010')).map((r) => [r.run, r]));
    expect(byId.get('r-attention')?.resolved).toBe('T');
    expect(byId.get('r-failed')?.resolved).toBe('T');
    expect(byId.get('r-interrupted')?.resolved).toBe('T');
    expect(byId.get('r-success')?.resolved).toBeUndefined();
    expect(byId.get('r-already')?.resolved).toBe('EARLIER');
  });

  it('touches only the card it was asked about', async () => {
    const root = await tempDir();
    await writeRun(root, record({ status: 'attention' }));
    await writeRun(root, record({ card: 'E-011', status: 'attention' }));
    expect(await resolveCardRuns(root, 'engineering', 'E-011', 'T')).toBe(1);
    expect((await readRun(root, 'engineering', 'E-010', record().run))?.resolved).toBeUndefined();
  });

  it('says nothing was waiting for a card with no runs', async () => {
    expect(await resolveCardRuns(await tempDir(), 'engineering', 'E-010', 'T')).toBe(0);
  });
});

// The way out of a card the machine spent. Attempts are DERIVED by counting run records, so there is
// no counter to reset — a card that reached the cap stayed there for ever, and the only remedy was to
// move its result files out of the folder by hand, which destroys the history explaining why it was
// blocked. This stamps instead.
describe('forgiveCardRuns', () => {
  it('clears the endings the card is answerable for, and counts them', async () => {
    const root = await tempDir();
    await writeRun(root, record({ run: 'r-failed', status: 'failed' }));
    await writeRun(root, record({ run: 'r-attention', status: 'attention' }));
    await writeRun(root, record({ run: 'r-success', status: 'success' }));

    expect(await forgiveCardRuns(root, 'engineering', 'E-010', 'T')).toBe(2);
    const byId = new Map((await listCardRuns(root, 'engineering', 'E-010')).map((r) => [r.run, r]));
    expect(byId.get('r-failed')?.forgiven).toBe('T');
    // `attention` is the agent finishing and saying it could not do the work — a strike, and exactly
    // what a person clearing a stuck card means to clear.
    expect(byId.get('r-attention')?.forgiven).toBe('T');
    // A SUCCESS IS NOT A STRIKE, and this assertion was the other way round until it was measured
    // against the real card. Attempts are counted PER SKILL, so leaving a success alone does not keep
    // the failing skill's tally above zero — it only keeps the successful skill's, which is correct.
    // Clearing it re-opens work that already worked: on P-011 that was a `break-down` which had
    // produced E-013, and forgiving it would have let the loop break the card down again and hang a
    // second set of children off it.
    expect(byId.get('r-success')?.forgiven).toBeUndefined();
  });

  // THE ASSERTION THAT MATTERS, and it is made through `attemptsUsed` rather than by reading fields:
  // what the user needs is a card auto-pilot will dispatch again, and the only statement of that is
  // the number the gate compares against the cap. A test on `forgiven` alone would pass with the
  // counting side wired to nothing.
  it('takes a card at the attempt cap back to zero attempts used', async () => {
    const root = await tempDir();
    for (const n of [1, 2, 3]) await writeRun(root, record({ run: `r-${n}`, status: 'failed' }));
    expect(attemptsUsed(await listCardRuns(root, 'engineering', 'E-010'), 'E-010', 'execute')).toBe(3);

    await forgiveCardRuns(root, 'engineering', 'E-010', 'T');
    expect(attemptsUsed(await listCardRuns(root, 'engineering', 'E-010'), 'E-010', 'execute')).toBe(0);
  });

  // MEASURED ON THE REAL POISONED CARD, P-011 in tic-tac-toe: three failed `checkup-story` runs — the
  // strikes the user is clearing — and one `break-down` from hours earlier that SUCCEEDED and produced
  // E-013. Forgiving everything `burnsAttempt` accepts cleared all four and took the break-down tally to
  // zero, which frees the loop to break the card down a second time and hang another set of children off
  // it. A run that worked is history, not a strike.
  it('does not forgive a run that SUCCEEDED, only the failures', async () => {
    const root = await tempDir();
    await writeRun(root, record({ run: 'r-worked', skill: 'break-down', status: 'success' }));
    await writeRun(root, record({ run: 'r-failed', skill: 'execute', status: 'failed' }));

    expect(await forgiveCardRuns(root, 'engineering', 'E-010', 'T')).toBe(1);
    const runs = await listCardRuns(root, 'engineering', 'E-010');
    expect(runs.find((r) => r.run === 'r-worked')?.forgiven).toBeUndefined();
    expect(runs.find((r) => r.run === 'r-failed')?.forgiven).toBe('T');
    // The point of the distinction, stated as the thing that would actually go wrong.
    expect(attemptsUsed(runs, 'E-010', 'break-down')).toBe(1);
    expect(attemptsUsed(runs, 'E-010', 'execute')).toBe(0);
  });

  it('leaves alone the runs that never cost the card anything', async () => {
    // Neither ending is the card's doing, so neither burns — and stamping one would record a decision
    // nobody had to take, on a run that was never in the way.
    const root = await tempDir();
    await writeRun(root, record({ run: 'r-cancelled', status: 'cancelled' }));
    await writeRun(root, record({ run: 'r-interrupted', status: 'interrupted' }));
    // Nor has an in-flight run ended, so there is nothing to forgive about it yet.
    await writeRun(root, record({ run: 'r-running', status: 'running' }));
    await writeRun(root, record({ run: 'r-queued', status: 'queued' }));
    // And an infrastructure failure already costs the card nothing (core/accounting.ts).
    await writeRun(root, record({ run: 'r-infra', status: 'failed', fault: 'infrastructure' }));

    expect(await forgiveCardRuns(root, 'engineering', 'E-010', 'T')).toBe(0);
    const runs = await listCardRuns(root, 'engineering', 'E-010');
    expect(runs.filter((r) => r.forgiven !== undefined)).toEqual([]);
  });

  it('is a no-op the second time, rather than restamping', async () => {
    // The stamp says WHO let the card go and WHEN, so a second click must not rewrite the timestamp of
    // a decision somebody took last week.
    const root = await tempDir();
    await writeRun(root, record({ status: 'failed' }));
    expect(await forgiveCardRuns(root, 'engineering', 'E-010', 'FIRST')).toBe(1);
    expect(await forgiveCardRuns(root, 'engineering', 'E-010', 'SECOND')).toBe(0);
    expect((await readRun(root, 'engineering', 'E-010', record().run))?.forgiven).toBe('FIRST');
  });

  it('keeps the whole record — the history is the point', async () => {
    // The alternative this replaces was deleting the files, so what must be shown is that nothing else
    // moved: the status it ended with, the agent's own report, and everything VibeBoard recorded.
    const root = await tempDir();
    const failed = record({
      status: 'failed',
      outcome: 'attention',
      finished: 'T0',
      note: 'the credential was refused',
      summary: 'could not reach the model',
      prompt: 'do it',
      usage: { costUsd: 0.02, turns: 1 },
      report: '## What happened\n\nAuthentication failed.',
    });
    await writeRun(root, failed);
    await forgiveCardRuns(root, 'engineering', 'E-010', 'T');
    expect(await readRun(root, 'engineering', 'E-010', failed.run)).toEqual({ ...failed, forgiven: 'T' });
  });

  it('touches only the card it was asked about', async () => {
    const root = await tempDir();
    await writeRun(root, record({ status: 'failed' }));
    await writeRun(root, record({ card: 'E-011', status: 'failed' }));
    expect(await forgiveCardRuns(root, 'engineering', 'E-011', 'T')).toBe(1);
    expect((await readRun(root, 'engineering', 'E-010', record().run))?.forgiven).toBeUndefined();
  });

  it('says nothing was spent for a card with no runs', async () => {
    // The count is what lets the UI say "there was nothing to clear" instead of implying it fixed
    // something — on a card whose problem is somewhere else entirely, that is the whole answer.
    expect(await forgiveCardRuns(await tempDir(), 'engineering', 'E-010', 'T')).toBe(0);
  });
});

// A crash between the write and the rename used to leave `<run>.md.<pid>.<n>.tmp` behind for ever, in a
// directory that is committed to git. The listers filter on `.md`, so by design nothing lists it and
// nobody notices — which is why this is worth an assertion rather than a shrug.
describe('a write that fails', () => {
  it('leaves no temporary file behind', async () => {
    const root = await tempDir();
    const dir = join(root, boardRel('engineering', RESULTS_DIR, 'E-010'));
    // The failure has to land BETWEEN the write and the rename, or there is no temp file to leak: a
    // record that fails to serialise throws before one exists, and that version of this test passed with
    // the cleanup removed. A directory sitting where the record belongs makes the RENAME fail instead.
    await mkdir(join(dir, 'r-doomed.md'), { recursive: true });
    await writeFile(join(dir, 'r-doomed.md', 'occupied'), 'x', 'utf8');
    await expect(writeRun(root, record({ run: 'r-doomed' }))).rejects.toThrow();
    const left = await readdir(dir).catch(() => [] as string[]);
    expect(left.filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});

// The backstop under the route's 400. Both stores interpolate a run id into a path, and the hole the
// reviewer found was in the one route that forgot to check — so the check also lives where the path is
// built, for the next route whose author does not know this.
describe('a run id that is not one', () => {
  it('cannot be built into a path, in either store', () => {
    const root = '/tmp/project';
    expect(() => projectRunPath(root, '../../secret')).toThrow('not a run id');
    expect(() => recordPath(root, 'engineering', 'E-001', '../../secret')).toThrow('not a run id');
    // The card segment is not this guard's business, but the run segment is — and it is the one that
    // reaches here straight from a URL.
    expect(() => projectRunPath(root, 'a/b')).toThrow('not a run id');
  });

  it('still builds the path for an id the generator produced', () => {
    const id = runId(new Date('2026-08-04T10:00:00Z'), 'ab12');
    expect(projectRunPath('/tmp/project', id)).toContain(`${id}.md`);
  });
});

// THE BOOTSTRAP HAS NO CARD, so none of the above reaches it — and it is the one position that stops the
// whole project rather than one card.
//
// An empty board plus a README is derived by a card-less run of `derive-features`, and its cap is counted
// over PROJECT runs of that skill (`bootstrap` in core/lifecycle/tick.ts). `forgiveCardRuns` needs a board
// and a card to find records at all, so there was no supported way back from a bootstrap the machine had
// spent: on 2026-08-16 the calculator's three attempts were consumed by an unreachable OpenCode server, and
// clearing them meant deleting files from `project-runs/` by hand — which destroys the account of why the
// project was stuck, and which nobody could be expected to know to do.
describe('forgiveProjectRuns', () => {
  const derivation = (over: Partial<RunRecord> = {}): RunRecord =>
    record({ card: undefined, board: undefined, skill: 'derive-features', ...over });

  it('clears the card-less endings and counts them', async () => {
    const root = await tempDir();
    await writeRun(root, derivation({ run: 'p-1', status: 'failed' }));
    await writeRun(root, derivation({ run: 'p-2', status: 'attention' }));
    await writeRun(root, derivation({ run: 'p-3', status: 'success' }));

    expect(await forgiveProjectRuns(root, 'T')).toBe(2);
    const byId = new Map((await listProjectRuns(root)).map((r) => [r.run, r]));
    expect(byId.get('p-1')?.forgiven).toBe('T');
    expect(byId.get('p-2')?.forgiven).toBe('T');
    // Same rule as the card version, for the same reason: a derivation that WORKED is history. Clearing
    // it would free the loop to derive the whole board a second time.
    expect(byId.get('p-3')?.forgiven).toBeUndefined();
  });

  it('takes the bootstrap tally back to zero, which is the assertion that matters', async () => {
    // Made through the same expression `bootstrap` uses, not by reading `forgiven`: what the user needs is
    // a project auto-pilot will derive again, and this is the only statement of that.
    const root = await tempDir();
    for (const n of [1, 2, 3]) await writeRun(root, derivation({ run: `p-${n}`, status: 'failed' }));
    const tally = async () =>
      (await listProjectRuns(root)).filter((r) => r.skill === 'derive-features' && burnsAttempt(r)).length;
    expect(await tally()).toBe(3);

    await forgiveProjectRuns(root, 'T');

    expect(await tally()).toBe(0);
  });

  it('does not touch a card’s runs, which have their own button', async () => {
    // The two are separate actions on separate positions: clearing a stuck bootstrap must not quietly
    // re-open every card in the project.
    const root = await tempDir();
    await writeRun(root, derivation({ run: 'p-1', status: 'failed' }));
    await writeRun(root, record({ run: 'c-1', status: 'failed' }));

    expect(await forgiveProjectRuns(root, 'T')).toBe(1);
    expect(
      (await listCardRuns(root, 'engineering', 'E-010')).find((r) => r.run === 'c-1')?.forgiven,
    ).toBeUndefined();
  });

  it('leaves alone what never cost the project anything, and is a no-op the second time', async () => {
    const root = await tempDir();
    await writeRun(root, derivation({ run: 'p-cancelled', status: 'cancelled' }));
    await writeRun(root, derivation({ run: 'p-running', status: 'running' }));
    // Already the machine's fault, so it never burned (core/accounting.ts).
    await writeRun(root, derivation({ run: 'p-infra', status: 'failed', fault: 'infrastructure' }));
    expect(await forgiveProjectRuns(root, 'T')).toBe(0);

    await writeRun(root, derivation({ run: 'p-failed', status: 'failed' }));
    expect(await forgiveProjectRuns(root, 'T')).toBe(1);
    expect(await forgiveProjectRuns(root, 'LATER')).toBe(0);
    expect((await listProjectRuns(root)).find((r) => r.run === 'p-failed')?.forgiven).toBe('T');
  });
});
