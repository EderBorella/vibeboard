import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { groupStartTime, isSameGroup, killGroup, terminateGroup } from '../src/server/process-group.js';

// The grandchild is the whole point. Every assertion below fails against `child.kill()`, which is what
// the code did before this: 16 leaked processes were measured on the development machine, 15 of them
// reparented to init, and eleven shared one process group that a single group kill would have reaped.

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0); // signal 0 asks "may I signal this?" and kills nothing
    return true;
  } catch {
    return false;
  }
};

// A leader with two children, so "the direct child died" and "the group died" are distinguishable.
// `echo $!` reports each child's pid on its own line; the leader waits, so it outlives them.
async function group(): Promise<{ pgid: number; children: number[]; done: Promise<void> }> {
  const child = spawn('/bin/sh', ['-c', 'sleep 30 & echo $!; sleep 30 & echo $!; wait'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const pgid = child.pid as number;
  const children: number[] = [];
  const done = new Promise<void>((resolve) => child.on('close', () => resolve()));
  await new Promise<void>((resolve) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').trim().split('\n')) {
        const pid = Number(line.trim());
        if (Number.isInteger(pid) && pid > 0) children.push(pid);
      }
      if (children.length === 2) resolve();
    });
  });
  return { pgid, children, done };
}

describe('killing a process group', () => {
  it('takes the grandchildren with it', async () => {
    const { pgid, children, done } = await group();
    expect(children.every(alive)).toBe(true);

    expect(terminateGroup(pgid, 50)).toBe(true);
    await done;
    // The leader is gone; give the kernel a moment to reap two more before asking about them.
    await new Promise((r) => setTimeout(r, 250));
    expect(alive(pgid)).toBe(false);
    expect(children.filter(alive)).toEqual([]);
  }, 10_000);

  it('reports nothing to kill rather than throwing', async () => {
    const { pgid, done } = await group();
    terminateGroup(pgid, 50);
    await done;
    await new Promise((r) => setTimeout(r, 250));
    // The ordinary case: most runs finish by themselves, and the reaper walks records whose processes
    // are long gone.
    expect(killGroup(pgid, 'SIGTERM')).toBe(false);
    expect(terminateGroup(pgid, 50)).toBe(false);
  }, 10_000);

  // The escalation, against a leader that ignores SIGTERM — which is the case it exists for.
  //
  // What this test does NOT catch, stated plainly because the reverse claim was made once already in
  // this file's history: it does not exercise the identity re-check the escalation now performs. That
  // needs the group to exit inside the grace period AND its pid to be reused by a new leader, which
  // cannot be forced from a test. What it does catch is the regression that re-check could introduce —
  // a guard that refuses to escalate at all, leaving a run that ignores TERM alive for ever.
  it('kills a leader that ignores the polite signal', async () => {
    // `echo` AFTER the trap, and waited for: signalling before the shell has run its `trap` builtin
    // kills the leader with the TERM itself, and the test then passes with the escalation disabled —
    // which is what it did on the first attempt.
    const child = spawn('/bin/sh', ['-c', 'trap "" TERM; echo ready; while true; do sleep 0.2; done'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pgid = child.pid as number;
    const done = new Promise<void>((resolve) => child.on('close', () => resolve()));
    await new Promise<void>((resolve) => {
      child.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes('ready')) resolve();
      });
    });

    expect(terminateGroup(pgid, 100)).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(alive(pgid), 'a leader that ignored TERM survived the grace period').toBe(false);
    await done;
  }, 10_000);

  // The plan asked for this and nothing asserted it. `hasRef()` is the observable: an un-unref'd timer
  // keeps the event loop alive, so a server shutting down — or a test worker finishing — would wait out
  // the grace period of every run it stopped before it could exit.
  it('does not hold the process open while the grace period runs', async () => {
    const { pgid, done } = await group();
    const timers: { hasRef: () => boolean }[] = [];
    const real = globalThis.setTimeout;
    // Spied rather than inspected globally: `process.getActiveResourcesInfo()` cannot tell OUR timer from
    // vitest's own, and this file runs beside a runner that is full of them.
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      const timer = real(fn, ms);
      timers.push(timer as unknown as { hasRef: () => boolean });
      return timer;
    }) as typeof globalThis.setTimeout;
    try {
      terminateGroup(pgid, 50);
    } finally {
      globalThis.setTimeout = real;
    }
    expect(timers).toHaveLength(1);
    expect(timers[0]?.hasRef()).toBe(false);
    await done;
  }, 10_000);

  // `kill(0, ...)` signals our OWN process group and pid 1 is init. Neither can be a run we spawned,
  // and a typo that reached either would be catastrophic in a way no test could undo.
  it('refuses pgids that could never be a run', () => {
    for (const pgid of [0, 1, -5, 2.5, Number.NaN]) {
      expect(killGroup(pgid, 'SIGTERM')).toBe(false);
    }
  });
});

describe('identifying a group before acting on it', () => {
  it('reports when its leader started', async () => {
    const { pgid, done } = await group();
    const started = groupStartTime(pgid);
    expect(typeof started).toBe('number');
    expect(started).toBeGreaterThan(0);
    expect(isSameGroup(pgid, started as number)).toBe(true);
    terminateGroup(pgid, 50);
    await done;
  }, 10_000);

  // The pid-reuse guard. A pgid written to a run record minutes ago may belong to something else
  // entirely by the time another server reads it, and killing a stranger's group would be far worse
  // than the orphan being cleaned up.
  it('says no when the recorded start time does not match', async () => {
    const { pgid, done } = await group();
    expect(isSameGroup(pgid, 1)).toBe(false);
    terminateGroup(pgid, 50);
    await done;
  }, 10_000);

  it('says no for a process that is not its own group leader', () => {
    // This test process was not started detached, so it is a member of its parent's group.
    expect(groupStartTime(process.pid)).toBeUndefined();
  });

  it('says no for a pid that does not exist', () => {
    // Above any plausible live pid, and harmless either way: this only ever reads /proc.
    expect(groupStartTime(4_194_303)).toBeUndefined();
  });
});
