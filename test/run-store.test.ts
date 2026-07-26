import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type RunRecord, runId } from '../src/core/runs.js';
import {
  appendTranscript,
  foldReport,
  listCardRuns,
  listRuns,
  markInterrupted,
  readRun,
  recordPath,
  reportContract,
  reportPath,
  resolveCardRuns,
  resolveRun,
  takeAgentReport,
  transcriptTail,
  writeRun,
} from '../src/server/run-store.js';
import { isIgnored } from '../src/server/session.js';
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
      join(root, 'engineering', 'results', 'E-010', '20260726-143012-a1b2.md'),
    );
    // `results` is not a configured column, so readBoard cannot see it — this is the whole reason
    // the record can live next to the card.
    const { readBoard } = await import('../src/core/board.js');
    const { defaultConfig } = await import('../src/core/config.js');
    expect(await readBoard(root, 'engineering', defaultConfig('T'))).toEqual([]);
  });

  it('reads back what it wrote', async () => {
    const root = await tempDir();
    const written = record({ prompt: 'do it', attached: ['docs/a.md'] });
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
    const dir = join(root, 'engineering', 'results', 'E-010');
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
    await writeFile(join(root, 'engineering', 'results', 'stray.md'), 'hello\n', 'utf8');
    expect(await listRuns(root)).toHaveLength(1);
  });
});

describe('the agent report handoff', () => {
  it('tells the agent a path under .vibeboard, never inside a card folder', async () => {
    // The record's frontmatter is ours. Agents rewrite files wholesale, so they get their own path.
    expect(reportContract('r1')).toBe('.vibeboard/runs/r1.report.md');
    const root = await tempDir();
    expect(reportPath(root, 'r1')).toBe(join(root, '.vibeboard', 'runs', 'r1.report.md'));
  });

  it('is not watched, so a streaming run does not churn the board', () => {
    expect(isIgnored('/p/.vibeboard/runs/r1.report.md')).toBe(true);
    expect(isIgnored('/p/.vibeboard/runs/r1.log.jsonl')).toBe(true);
    // The record itself IS watched: writing one should refresh the card's reports.
    expect(isIgnored('/p/engineering/results/E-010/r1.md')).toBe(false);
    expect(isIgnored('/p/.vibeboard/config.yaml')).toBe(false);
  });

  it('consumes the report, so a later run cannot inherit an earlier one', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.vibeboard', 'runs'), { recursive: true });
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
    await mkdir(join(root, '.vibeboard', 'runs'), { recursive: true });
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
