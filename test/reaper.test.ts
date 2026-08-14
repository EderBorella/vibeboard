import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '../src/core/runs.js';
import { groupStartTime } from '../src/exec/process-group.js';
import { groupsOf, reapGroups } from '../src/server/reaper.js';
import { markInterrupted, writeRun } from '../src/store/run-store.js';
import { tempDir } from './helpers.js';

// The identity check is what this file is about. Killing a stranger's process group because it
// inherited a recorded pid would be far worse than leaving the orphan alone, so the interesting
// assertions are the ones where NOTHING happens.

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: '20260803-100000-aaaa',
  card: 'E-010',
  board: 'engineering',
  skill: 'implement',
  status: 'running',
  started: '2026-08-03T10:00:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

describe('reaping recorded process groups', () => {
  it('kills a group it can identify', () => {
    const terminate = vi.fn(() => true);
    const result = reapGroups(groupsOf([record({ pgid: 4242, pgstart: 99 })]), {
      isSame: (pgid, started) => pgid === 4242 && started === 99,
      terminate,
    });
    expect(result).toEqual({ reaped: 1, skipped: 0 });
    expect(terminate).toHaveBeenCalledWith(4242);
  });

  // The pid-reuse guard, and the property that matters most: the terminate spy is never called at all.
  it('leaves a group whose start time does not match alone', () => {
    const terminate = vi.fn(() => true);
    const result = reapGroups(groupsOf([record({ pgid: 4242, pgstart: 99 })]), {
      isSame: () => false,
      terminate,
    });
    expect(result).toEqual({ reaped: 0, skipped: 1 });
    expect(terminate).not.toHaveBeenCalled();
  });

  // A record written before pgstart existed. It cannot be identified, so it is not a target — reaping
  // on a bare pid is exactly the mistake the pair exists to prevent.
  it('does not treat a record with no start time as a target', () => {
    const terminate = vi.fn(() => true);
    expect(groupsOf([record({ pgid: 4242 })])).toEqual([]);
    expect(reapGroups(groupsOf([record({ pgid: 4242 })]), { terminate })).toEqual({ reaped: 0, skipped: 0 });
    expect(terminate).not.toHaveBeenCalled();
  });

  it('ignores records that never had a group, such as OpenCode runs', () => {
    expect(groupsOf([record(), record({ run: 'b' })])).toEqual([]);
  });

  it('counts a group that had already gone as skipped rather than reaped', () => {
    const result = reapGroups(groupsOf([record({ pgid: 4242, pgstart: 99 })]), {
      isSame: () => true,
      terminate: () => false, // nothing there to signal — the ordinary case
    });
    expect(result).toEqual({ reaped: 0, skipped: 1 });
  });

  // The one caller allowed the weaker check: the auto-pilot service, killed by the same server that
  // spawned it rather than by one reading a file written long ago.
  it('accepts a target with no start time when it is still a group leader', () => {
    const terminate = vi.fn(() => true);
    const result = reapGroups([{ pgid: 7, what: 'the auto-pilot service' }], {
      isLeader: (pgid) => pgid === 7,
      terminate,
    });
    expect(result).toEqual({ reaped: 1, skipped: 0 });
  });

  it('refuses that target when the pid is not a group leader', () => {
    const terminate = vi.fn(() => true);
    reapGroups([{ pgid: 7, what: 'the auto-pilot service' }], { isLeader: () => false, terminate });
    expect(terminate).not.toHaveBeenCalled();
  });
});

// One real case end to end, because the injected version above proves the decision and not the wiring.
describe('when a project opens', () => {
  it('reaps the group of a run left in flight by a server that is gone', async () => {
    const root = await tempDir();
    const child = spawn('/bin/sh', ['-c', 'sleep 30'], { detached: true, stdio: 'ignore' });
    const pgid = child.pid as number;
    // Registered BEFORE anything can kill it: 'close' fires once, and a listener attached after the
    // fact never hears it — which looks exactly like a reaper that did nothing.
    const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
    // Give the kernel a moment to have the group in /proc before it is identified.
    await new Promise((r) => setTimeout(r, 100));
    const pgstart = groupStartTime(pgid) as number;
    expect(pgstart).toBeGreaterThan(0);

    // A record claiming to be running, from a previous server: this process has nothing in flight.
    await writeRun(root, record({ status: 'running', pgid, pgstart }));
    const stale = await markInterrupted(root, '2026-08-03T13:00:00.000Z');
    expect(stale).toBe(1);

    await closed;
    // Killed by a signal rather than having exited on its own: `sleep 30` would still be running.
    expect(child.signalCode).toBe('SIGTERM');
  }, 15_000);
});
