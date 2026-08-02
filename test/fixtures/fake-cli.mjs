#!/usr/bin/env node
// Test shim standing in for the `claude` CLI, for agent-turn's own tests.
//
// Everything it needs comes from the PROMPT, which arrives on STDIN — never the environment (shared
// with every other test file in the worker, and a sibling rewriting it mid-run is what made
// Stryker's dry run fail where `npm test` passed) and no longer argv, because the prompt carries the
// run's credential and a command line is world readable through /proc.
//
//   [[log:/path/to/file]]  append {argv, cwd} for this invocation to that file, as one JSON line
//   [[behaviour:X]]        how to behave:
//     ok      (default) init + assistant + result, exit 0
//     split   one JSON line delivered in two writes, to exercise chunk reassembly
//     tail    a final line with NO trailing newline, to exercise the flush on close
//     noinit  no init line — the session id arrives only on the result
//     fail    writes to stderr and exits 2
//     bigerr  writes 2000 characters to stderr and exits 2, to exercise the tail limit
//     failquiet  exits 3 with NOTHING on stderr
//     notail  init + text then exits 0 with no result line, so the last event carries no session id
//     hang    never exits, for cancel and timeout
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
// Synchronously from fd 0, like `claude -p`, which waits for EOF before it starts.
let prompt = '';
try {
  prompt = readFileSync(0, 'utf8');
} catch {
  /* no stdin attached */
}
const log = (prompt.match(/\[\[log:([^\]]+)\]\]/) ?? [])[1];

// What is confining THIS process. Recorded rather than inferred from argv, because the sandbox
// wrapper `exec`s the CLI — so by the time this runs, aa-exec is gone and its arguments with it.
// argv can only ever show the shape of the command; this shows whether the kernel agreed.
let confinement = 'unknown';
try {
  confinement = readFileSync('/proc/self/attr/current', 'utf8').trim();
} catch {
  /* no AppArmor, or not Linux — 'unknown' is the honest answer */
}

// The prompt is recorded alongside argv so a test can assert BOTH what was said and that argv did
// not say it.
if (log) appendFileSync(log, `${JSON.stringify({ argv: args, cwd: process.cwd(), prompt, confinement })}\n`);

const behaviour = (prompt.match(/\[\[behaviour:(\w+)\]\]/) ?? [])[1] ?? 'ok';
const write = (s) => process.stdout.write(s);
const line = (obj) => `${JSON.stringify(obj)}\n`;

const INIT = {
  type: 'system',
  subtype: 'init',
  session_id: 'shim-session',
  model: 'shim-model',
  permissionMode: 'bypassPermissions',
  cwd: process.cwd(),
};
const TEXT = {
  type: 'assistant',
  message: { content: [{ type: 'text', text: 'working' }] },
  session_id: 'shim-session',
};
const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
  num_turns: 1,
  duration_ms: 5,
  session_id: 'shim-session',
  // A real cost, so a test can tell "captured it" from "defaulted to zero".
  total_cost_usd: 0.0125,
  usage: { input_tokens: 5, output_tokens: 7 },
};

if (behaviour === 'hang') {
  // Never exits on its own — the test cancels it or times it out. But if the test RUNNER dies first
  // (a SIGKILLed vitest, an interrupted pre-commit hook), nothing ever does, and the shim outlives
  // the suite that spawned it. Watching ppid covers the kills a process cannot catch.
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent) process.exit(0);
  }, 250);
} else if (behaviour === 'split') {
  // One line, two writes: the reader must not emit until the newline arrives.
  const whole = line(INIT);
  const cut = Math.floor(whole.length / 2);
  write(whole.slice(0, cut));
  setTimeout(() => {
    write(whole.slice(cut));
    write(line(RESULT));
    process.exit(0);
  }, 30);
} else if (behaviour === 'tail') {
  write(line(INIT));
  write(JSON.stringify(RESULT)); // no trailing newline: only the close flush can emit this
  process.exit(0);
} else if (behaviour === 'noinit') {
  write(line(RESULT));
  process.exit(0);
} else if (behaviour === 'fail') {
  write(line(INIT));
  process.stderr.write('something went very wrong\n');
  process.exit(2);
} else if (behaviour === 'bigerr') {
  process.stderr.write(`${'e'.repeat(2000)}\n`);
  process.exit(2);
} else if (behaviour === 'failquiet') {
  process.exit(3);
} else if (behaviour === 'notail') {
  write(line(INIT));
  write(line(TEXT));
  process.exit(0);
} else {
  write(line(INIT));
  write(line(TEXT));
  write(line(RESULT));
  process.exit(0);
}
