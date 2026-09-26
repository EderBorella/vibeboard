import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardRel, PROJECT_RUNS_DIR, RESULTS_DIR } from '../src/core/layout.js';
import { isProjectRun, parseRun, type RunRecord, serializeRun } from '../src/core/runs.js';
import {
  listProjectRuns,
  listRuns,
  markInterrupted,
  projectRunPath,
  readProjectRun,
  resolveProjectRun,
  writeRun,
} from '../src/store/run-store.js';
import { tempDir } from './helpers.js';

// The checkup and pre-flight are about the PROJECT, not a card — and `parseRun` demanding `card` and
// `board` made the two runs the design insists must count against every cap the two that could not
// be written, read back, or summed. That was review blocker B5.

const projectRun = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: '20260803-101500-aaaa',
  skill: 'checkup',
  status: 'success',
  started: '2026-08-03T10:15:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: 'Looked at the board.',
  ...over,
});

const cardRun = (over: Partial<RunRecord> = {}): RunRecord => ({
  ...projectRun(),
  card: 'E-010',
  board: 'engineering',
  skill: 'implement',
  ...over,
});

describe('a run about the project rather than a card', () => {
  it('round-trips with neither card nor board, and writes no empty keys for them', () => {
    const text = serializeRun(projectRun());
    expect(text).not.toContain('card:');
    expect(text).not.toContain('board:');
    const back = parseRun(text);
    expect(back).toEqual(projectRun());
    expect(isProjectRun(back!)).toBe(true);
  });

  // Both or neither. A record with one of the pair has no computable home: `card` alone cannot say
  // which board's results folder it belongs to, and `board` alone names a folder with no card in it.
  // Writing it back would put it in the project store while it lives beside a card, so the record
  // would exist twice and the ledger would count it twice.
  it('refuses a record carrying only one half of the pair', () => {
    expect(parseRun(serializeRun(cardRun({ board: undefined })))).toBeNull();
    expect(parseRun(serializeRun(cardRun({ card: undefined })))).toBeNull();
  });

  it('is stored one level up from the boards, mirroring the card store', async () => {
    const root = await tempDir();
    const record = projectRun();
    await writeRun(root, record);
    expect(projectRunPath(root, record.run)).toBe(join(root, PROJECT_RUNS_DIR, `${record.run}.md`));
    expect(await readProjectRun(root, record.run)).toEqual(record);
    expect(await listProjectRuns(root)).toEqual([record]);
  });

  it('still puts a card run beside its card', async () => {
    const root = await tempDir();
    await writeRun(root, cardRun());
    expect(await listProjectRuns(root)).toEqual([]);
    expect(await listRuns(root)).toEqual([cardRun()]);
  });

  // Summing spend and listing history read BOTH locations. That is the whole cost of the decision.
  it('is listed alongside card runs, newest first', async () => {
    const root = await tempDir();
    // Distinct `started` values, because that is what "newest" means here. Both fixtures shared one
    // timestamp, so this case was ordering by the id tie-break and could not have told the two apart.
    const older = cardRun({ run: '20260803-090000-bbbb', started: '2026-08-03T09:00:00.000Z' });
    const newer = projectRun({ run: '20260803-120000-cccc', started: '2026-08-03T12:00:00.000Z' });
    await writeRun(root, older);
    await writeRun(root, newer);
    expect((await listRuns(root)).map((r) => r.run)).toEqual([newer.run, older.run]);
  });

  // THE ID IS NOT THE ORDER. It is the timestamp to the SECOND plus a random four-character suffix, so two
  // runs inside one second sort on a coin flip — and `started` is written by the server at dispatch with
  // milliseconds. The two are made to DISAGREE here, which is the only way to tell the fix from the flaw: by
  // id alone `zzzz` sorts first, and it is the older run.
  //
  // Nothing consuming this list is order-sensitive today, so this is a latent bug rather than a live one. It
  // is pinned because the identical flaw in core/bounds.ts made its latest-work-run lookup answer with the
  // wrong run in half the end-to-end trace's runs, and there it decided whether a task whose gates failed once
  // could ever pass — a bug that presented as a test flaking.
  it('orders two runs from the same second by when they started, not by their ids', async () => {
    const root = await tempDir();
    const first = cardRun({ run: '20260803-101500-zzzz', started: '2026-08-03T10:15:00.100Z' });
    const second = cardRun({ run: '20260803-101500-aaaa', started: '2026-08-03T10:15:00.900Z' });
    await writeRun(root, first);
    await writeRun(root, second);
    expect((await listRuns(root)).map((r) => r.run)).toEqual([second.run, first.run]);
  });

  // A record with no readable start time is NOT assumed to be the newest, which is the fail-closed
  // direction: it sorts last, and the id decides between it and anything else without one.
  it('does not treat a record with an unreadable start time as the newest', async () => {
    const root = await tempDir();
    const dated = cardRun({ run: '20260803-101500-aaaa', started: '2026-08-03T10:15:00.000Z' });
    const undated = cardRun({ run: '20260803-101500-zzzz', started: 'sometime' });
    await writeRun(root, dated);
    await writeRun(root, undated);
    expect((await listRuns(root)).map((r) => r.run)).toEqual([dated.run, undated.run]);
  });

  it('ignores a stray markdown file in either store', async () => {
    const root = await tempDir();
    await writeRun(root, projectRun());
    await writeRun(root, cardRun());
    await writeFile(join(root, PROJECT_RUNS_DIR, 'NOTES.md'), '# not a run\n', 'utf8');
    await mkdir(join(root, boardRel('engineering', RESULTS_DIR, 'E-010')), { recursive: true });
    await writeFile(join(root, boardRel('engineering', RESULTS_DIR, 'E-010', 'x.md')), 'hi\n', 'utf8');
    expect(await listRuns(root)).toHaveLength(2);
  });

  // Through listRuns, so this is a test that the union is really wired rather than a second
  // implementation of it: a checkup in flight when the server died is stale, not live.
  it('is marked interrupted on startup like any other in-flight run', async () => {
    const root = await tempDir();
    await writeRun(root, projectRun({ status: 'running' }));
    expect(await markInterrupted(root, '2026-08-03T13:00:00.000Z')).toBe(1);
    const after = await readProjectRun(root, projectRun().run);
    expect(after?.status).toBe('interrupted');
  });

  // A failed checkup would otherwise sit in the dashboard's attention group forever: the card
  // resolve route needs a board and a card in its path, and this run has neither.
  it('can be marked dealt with, twice being the same as once', async () => {
    const root = await tempDir();
    await writeRun(root, projectRun({ status: 'failed' }));
    const first = await resolveProjectRun(root, projectRun().run, '2026-08-03T14:00:00.000Z');
    expect(first?.resolved).toBe('2026-08-03T14:00:00.000Z');
    const second = await resolveProjectRun(root, projectRun().run, '2026-08-03T15:00:00.000Z');
    expect(second?.resolved).toBe('2026-08-03T14:00:00.000Z');
    expect(await resolveProjectRun(root, 'nope', '2026-08-03T14:00:00.000Z')).toBeNull();
  });
});
