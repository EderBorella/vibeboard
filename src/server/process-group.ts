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
export function terminateGroup(pgid: number, graceMs = GROUP_GRACE_MS): boolean {
  const signalled = killGroup(pgid, 'SIGTERM');
  if (!signalled) return false;
  // `unref`ed, so a pending kill never holds the process open. Without it a server shutting down — or
  // a test worker finishing — would wait out the grace period of every run it stopped.
  setTimeout(() => killGroup(pgid, 'SIGKILL'), graceMs).unref();
  return true;
}
