import { readFileSync } from 'node:fs';

// Killing a run means killing everything it started, not just the process we spawned.
//
// Confirmed live bug, not a hypothesis: agent turns were spawned without `detached`, so a run never
// got its own process group and `child.kill('SIGTERM')` reached only the direct child. Measured on the
// development machine: 16 leaked processes — 2 x `opencode serve`, the older of them seven days old,
// and 14 test fixtures — 15 of the 16 reparented to init. A CLI agent spawns compilers, test runners
// and servers; those are the grandchildren, and they are what keeps working and keeps spending.
//
// POSIX only. `/proc` and negative-pid signals have no Windows equivalent, and Windows is a deferred
// feature of its own — this is one of the reasons why. Everything here fails soft: a group we cannot
// identify is left alone.

// How long a group gets to exit on its own before it is killed outright. Long enough for a CLI to
// flush its output and write its report, short enough that a person pressing stop sees it happen.
export const GROUP_GRACE_MS = 2_000;

// `/proc/<pid>/stat` is one line of space-separated fields, EXCEPT that field 2 is the executable name
// in parentheses and may itself contain spaces and parentheses. Splitting the whole line would
// therefore misalign every field after it for a process called `(my prog)`. Everything is read after
// the LAST `)`, which is what the kernel's own documentation recommends.
//
//   field 3  state        rest[0]
//   field 5  pgrp         rest[2]
//   field 22 starttime    rest[19]   clock ticks since boot
function statFields(pid: number): string[] | undefined {
  try {
    const line = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = line.lastIndexOf(')');
    if (close < 0) return undefined;
    return line.slice(close + 2).split(' ');
  } catch {
    return undefined; // no such process, no /proc, or nothing we may read
  }
}

// When this group's leader started, or `undefined` if there is no such group.
//
// The start time is what makes a recorded pgid safe to act on LATER. Pids are reused, so a number
// written to a run record minutes ago may belong to something else entirely by the time a new server
// reads it — and killing a stranger's process group because it inherited a pid would be far worse
// than the orphan being cleaned up. `reapOrphanServer` already sets this precedent with its
// command-line check; a start time is the exact version of the same idea.
export function groupStartTime(pgid: number): number | undefined {
  const rest = statFields(pgid);
  if (!rest) return undefined;
  // Still its own group leader. A pid whose pgrp is some other group is not the group we recorded,
  // whatever else it may be.
  if (Number(rest[2]) !== pgid) return undefined;
  const started = Number(rest[19]);
  return Number.isFinite(started) && started > 0 ? started : undefined;
}

// Is the group behind this pgid still the one we recorded? Both halves matter: a group that has gone
// answers `undefined`, and a pid reused by something new answers a different start time.
export function isSameGroup(pgid: number, started: number): boolean {
  return groupStartTime(pgid) === started;
}

// Signal a whole group. `false` when there was nothing there — which is the ORDINARY case, not an
// error: most runs finish by themselves, and the reaper walks records whose processes are long gone.
export function killGroup(pgid: number, signal: NodeJS.Signals): boolean {
  // A pgid of 0 or 1 would be catastrophic: `kill(0, ...)` signals our own process group, and pid 1 is
  // init. Neither can be a run we spawned, so neither is worth risking a typo over.
  //
  // THE MUTANTS OF THIS LINE ARE EXCLUDED BECAUSE THEY KILL THE MUTATION RUN ITSELF, and that is the
  // strongest evidence this guard is load-bearing that anything could produce. Removing it lets the `0`
  // in test/process-group.test.ts's "refuses pgids that could never be a run" reach `process.kill(-0)`
  // — and `-0 === 0`, so the vitest worker signals its whole process group, which under Stryker is
  // Stryker. Measured twice before it was understood: both runs died at 94% with exit 143 (SIGTERM),
  // no summary and no report, which reads exactly like flaky infrastructure.
  //
  // Excluded here rather than by dropping the file from stryker.config.mjs, so the other 90-odd mutants
  // in this module stay measured.
  // Stryker disable next-line all: mutating this guard makes the test runner SIGTERM its own process group
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

// Ask, then insist. A CLI given SIGTERM writes what it has and exits; one that ignores it — or whose
// children do — is killed after the grace period.
//
// `stillWanted` is an EXTRA condition on the escalation, never a replacement for the identity check
// below. commands.ts had its own copy of this shape guarding only on a `settled` flag — a process that
// exited inside the grace period and had its pid reused was still a SIGKILL waiting to land on a
// stranger — so it now calls this and passes its flag in. Absent means "nothing else to ask".
export function terminateGroup(pgid: number, graceMs = GROUP_GRACE_MS, stillWanted?: () => boolean): boolean {
  // Sampled BEFORE the TERM, because it is the only moment the group is known to be the right one. The
  // escalation two seconds later is exactly the situation this module exists for: the group may have
  // exited inside the grace period and a new leader may have inherited its pid, in which case the
  // SIGKILL would land on a stranger — the mistake `groupStartTime` was written to prevent, made by
  // the function that owns the timer rather than by a stale record.
  const started = groupStartTime(pgid);
  const signalled = killGroup(pgid, 'SIGTERM');
  if (!signalled) return false;
  // `unref`ed, so a pending kill never holds the process open. Without it a server shutting down — or
  // a test worker finishing — would wait out the grace period of every run it stopped.
  setTimeout(() => {
    if (stillWanted?.() === false) return;
    // No start time means we could not identify the group even at TERM time; escalating blind is the
    // one thing worse than leaving it, since by now the pid may be anyone's.
    if (started !== undefined && isSameGroup(pgid, started)) killGroup(pgid, 'SIGKILL');
  }, graceMs).unref();
  return true;
}
