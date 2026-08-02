#!/usr/bin/env node
// Test shim standing in for `opencode serve`. It prints the listening banner the real server prints
// — that line is the contract startServer waits for — and records what confines it, which is the
// only way to observe whether the spawn went through the sandbox wrapper: aa-exec execs its target,
// so its own arguments are gone by the time this runs.
import { appendFileSync, readFileSync } from 'node:fs';

let confinement = 'unknown';
try {
  confinement = readFileSync('/proc/self/attr/current', 'utf8').trim();
} catch {
  /* no AppArmor, or not Linux */
}

// Appended, one line per spawn, so a test can count them. A restart that quietly spawns twice is
// exactly the bug this fixture exists to catch, and an overwriting log would hide it.
const log = process.env.VIBEBOARD_FAKE_OPENCODE_LOG;
if (log) {
  appendFileSync(log, `${JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), confinement })}\n`);
}

process.stdout.write('listening on http://127.0.0.1:59999\n');
// Stays up like the real server: startServer records the pid and the test stops it. Watching ppid
// covers a test runner killed in a way it cannot catch, which is how the last batch of orphans got
// onto this machine.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) process.exit(0);
}, 250);
