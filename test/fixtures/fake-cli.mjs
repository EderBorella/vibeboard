#!/usr/bin/env node
// Test shim standing in for the `claude` CLI, for agent-turn's own tests.
//
// Everything it needs comes from the PROMPT (the last argv entry), never the environment: env is
// shared with every other test file in the worker, and a sibling rewriting it mid-run is what made
// Stryker's dry run fail where `npm test` passed.
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
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const prompt = args[args.length - 1] ?? '';
const log = (prompt.match(/\[\[log:([^\]]+)\]\]/) ?? [])[1];
if (log) appendFileSync(log, `${JSON.stringify({ argv: args, cwd: process.cwd() })}\n`);

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
  usage: { input_tokens: 5, output_tokens: 7 },
};

if (behaviour === 'hang') {
  setInterval(() => {}, 1000);
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
