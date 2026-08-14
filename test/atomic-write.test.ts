import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { type RunRecord, serializeRun } from '../src/core/runs.js';
import { listCardRuns, listRuns, recordPath, writeRun } from '../src/server/run-store.js';
import { writeAtomic } from '../src/server/write-queue.js';
import { tempDir } from './helpers.js';

// The temp-name contract between `writeAtomic` and the run store, which nothing tested until the two
// inline copies of the atomic write were merged into the shared one.
//
// run-store.ts's copy carried the reason in a comment — the temporary name must not end in `.md`,
// because the listers filter on that extension — and a comment is not a constraint. Adopting a shared
// helper that could later be given a `.md` temp name for some other caller's benefit would take this
// store's invariant with it silently: an interrupted write would leave a file that half-parses as a run
// record, in a directory that is committed to git, and it would show up in the Execution dashboard as a
// run nobody started.
//
// So the name is captured from a REAL write rather than asserted about a string builder: the property
// is about what actually lands on disk, and a test of the naming helper alone would not notice
// `writeAtomic` growing a second path that skips it.
const observed = vi.hoisted(() => ({ renamedFrom: [] as string[] }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      observed.renamedFrom.push(String(from));
      await actual.rename(from, to);
    },
  };
});

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

const lastTemp = (): string => {
  const temp = observed.renamedFrom.at(-1);
  if (temp === undefined) throw new Error('nothing was renamed, so no atomic write happened');
  return temp;
};

describe('the atomic write temp name', () => {
  it('does not end in .md, for a target that does', async () => {
    const root = await tempDir();
    observed.renamedFrom.length = 0;
    await writeAtomic(`${root}/note.md`, 'hello');
    expect(lastTemp().endsWith('.md')).toBe(false);
    expect(await readFile(`${root}/note.md`, 'utf8')).toBe('hello');
  });

  it('is unique per write, so two writes of one path cannot race for one name', async () => {
    const root = await tempDir();
    observed.renamedFrom.length = 0;
    await Promise.all([writeAtomic(`${root}/a.md`, 'one'), writeAtomic(`${root}/a.md`, 'two')]);
    expect(new Set(observed.renamedFrom).size).toBe(2);
  });

  it('leaves a run record behind under a name the listers ignore', async () => {
    const root = await tempDir();
    observed.renamedFrom.length = 0;
    const written = record();
    await writeRun(root, written);
    const temp = lastTemp();
    expect(temp.endsWith('.md')).toBe(false);

    // Exactly what a crash between the write and the rename leaves: a file at the temp name whose
    // content is a valid run record. It must not become a second run.
    await writeFile(temp, serializeRun(written), 'utf8');
    expect(await listCardRuns(root, 'engineering', 'E-010')).toEqual([written]);
    expect(await listRuns(root)).toEqual([written]);
  });

  it('would produce a phantom run if the temp name ended in .md, which is why it does not', async () => {
    const root = await tempDir();
    const written = record();
    await writeRun(root, written);
    // The same leftover, named the way the listers DO read. This is the failure the rule above
    // prevents, pinned so the two halves stay coupled: if this ever stops finding two runs, the
    // lister's filter changed and the temp-name rule is no longer the thing holding the line.
    const leftover = `${recordPath(root, 'engineering', 'E-010', written.run)}.7.tmp.md`;
    await writeFile(leftover, serializeRun(written), 'utf8');
    expect(await listCardRuns(root, 'engineering', 'E-010')).toHaveLength(2);
  });
});
