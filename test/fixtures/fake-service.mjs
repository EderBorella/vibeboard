#!/usr/bin/env node
// Test shim standing in for the auto-pilot loop (src/service/main.ts, built in Task 7).
//
// It records what the process was ACTUALLY given — argv, cwd, the environment, its AppArmor label, and
// what the state file said at the instant it started — so a test can assert what reaches the loop rather
// than what the code appears to pass. The log path comes as argv[2] rather than through the environment,
// deliberately: the environment is what is under test here, and two test files sharing a worker would
// otherwise write to one another's log.
//
//   argv[2]  where to write the record
//   argv[3]  'exit:<code>' to end immediately, or 'sleep' (the default) to stay alive
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , logPath, behaviour = 'sleep'] = process.argv;

// Node exposes no getpgrp, so the group comes from /proc the same way src/exec/process-group.ts reads
// it: everything after the LAST ')', because the command field is parenthesised and may contain spaces.
// Field 5 (pgrp) is index 2 of what is left.
function processGroup() {
  try {
    const line = readFileSync('/proc/self/stat', 'utf8');
    return Number(line.slice(line.lastIndexOf(')') + 2).split(' ')[2]);
  } catch {
    return -1;
  }
}

// Which AppArmor profile, if any, this process is running under.
//
// This replaces an `argv0` check that could not work: `aa-exec` EXECS its target, so a confined child sees
// `node` in `argv0` exactly as an unconfined one does. A reviewer proved the point by wrapping the real
// spawn in `aa-exec` — the test asserting "unsandboxed" stayed green. `/proc/self/attr/current` is the
// thing that actually differs: `unconfined` here, `<profile> (enforce)` under a profile.
function apparmorLabel() {
  try {
    return readFileSync('/proc/self/attr/current', 'utf8').trim();
  } catch {
    // No AppArmor on this kernel. Reported rather than guessed at: a test asserting `unconfined` should
    // fail loudly here rather than pass on a machine that cannot tell.
    return 'unreadable';
  }
}

// What the auto-pilot state said at the instant the loop started, read SYNCHRONOUSLY before anything else.
// The server writes `running` before spawning precisely so the loop's first tick has the authority to
// dispatch, and nothing could observe that ordering from outside — the final state looks identical either
// way. This is the observation.
function stateAtStart() {
  const root = process.env.VIBEBOARD_PROJECT_ROOT;
  if (!root) return null;
  try {
    return JSON.parse(readFileSync(join(root, '.vibeboard', 'autopilot-state.json'), 'utf8')).state ?? null;
  } catch {
    return 'unreadable';
  }
}

if (logPath) {
  // Written to a sibling and renamed into place, because the reader polls `existsSync` and then parses.
  // `writeFileSync` creates the file before it finishes filling it, so under load the reader caught a
  // partial record and died on `Unexpected end of JSON input` — a flake indistinguishable from a real
  // failure of the thing under test. A rename is atomic within a filesystem, so existence now implies
  // completeness. The temp name is a sibling, not /tmp, so it cannot cross a device boundary.
  const partial = `${logPath}.partial`;
  writeFileSync(
    partial,
    `${JSON.stringify({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      pid: process.pid,
      argv0: process.argv0,
      apparmor: apparmorLabel(),
      stateAtStart: stateAtStart(),
      token: process.env.VIBEBOARD_SERVICE_TOKEN ?? null,
      apiBase: process.env.VIBEBOARD_API_BASE ?? null,
      projectRoot: process.env.VIBEBOARD_PROJECT_ROOT ?? null,
      // The inherited environment, which the loop needs to run at all — without it there is no PATH and no
      // HOME. Reported as a presence check rather than dumped, because the record is written to a file.
      hasPath: typeof process.env.PATH === 'string' && process.env.PATH.length > 0,
      // Its own process group means the leader is itself. `detached: true` is what makes this true, and
      // an emergency stop depends on it.
      isGroupLeader: process.pid === processGroup(),
    })}\n`,
  );
  renameSync(partial, logPath);
}

// One line on each stream, always. The real loop writes to both — `console.error` for the three refusals
// that end it before it starts, `console.log` for the per-tick narrative — and the server points them at
// different places on purpose: errors are always kept, the narrative only when the debug setting is on. A
// test can only tell those apart if the shim writes to both.
process.stdout.write('shim on stdout\n');
process.stderr.write('shim on stderr\n');

if (behaviour.startsWith('exit:')) process.exit(Number(behaviour.slice(5)));

// Otherwise stay alive until killed — but NOT for ever. This shim is spawned detached and in its own
// process group, so a test that forgets to kill it leaves a process reparented to init holding ~48 MB.
// An earlier version used `setInterval`, and 275 of them accumulated on one machine — 12.7 GB resident —
// which is decision 13's own orphan failure reproduced by the fixture written to test it. The bounded
// timeout means the worst a forgotten child can cost is thirty seconds, and the tests kill it anyway.
setTimeout(() => process.exit(0), 30_000);
