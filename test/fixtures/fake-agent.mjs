#!/usr/bin/env node
// Test shim standing in for an agent running a skill. Behaviour comes from a [[behaviour:x]] marker
// in the prompt it was given — NOT from the environment, which is shared with every other test file
// in the process and so cannot be relied on. One file covers every way a run can end:
//
//   success   — writes a success report and exits 0
//   attention — writes an attention report with options
//   silent    — writes nothing at all and exits 0 (the case the contract has to survive)
//   garbage   — writes a report with malformed frontmatter
//   crash     — exits non-zero without a report
//   hang      — never exits, for cancel and timeout
//   free      — like success, but reports a cost of exactly 0 (a free model)
//
// The report path is read from the prompt it was given, exactly as a real agent would: that means
// these tests fail if the prompt stops naming the path.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
if (process.env.VIBEBOARD_SHIM_ARGS) {
  appendFileSync(process.env.VIBEBOARD_SHIM_ARGS, `${JSON.stringify(args)}\n`);
}

const prompt = args[args.length - 1] ?? '';
const match = prompt.match(/\.vibeboard\/runs\/[\w.-]+\.report\.md/);
const behaviour = (prompt.match(/\[\[behaviour:(\w+)\]\]/) ?? [])[1] ?? 'success';

const say = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
say({
  type: 'system',
  subtype: 'init',
  session_id: 'shim-run',
  model: 'shim-model',
  permissionMode: 'bypassPermissions',
  cwd: process.cwd(),
});
say({
  type: 'assistant',
  message: { content: [{ type: 'text', text: `working (${behaviour})` }] },
  session_id: 'shim-run',
});

const REPORTS = {
  success: '---\noutcome: success\nsummary: did the thing\ncreated: [E-041]\n---\n## What I did\n\nAll of it.\n',
  attention:
    '---\noutcome: attention\nsummary: bigger than one card\noptions:\n  - Split it in two\n  - Do the store only\n---\n## What I found\n\nThree cards, not one.\n',
  garbage: '---\noutcome: [unclosed\n---\nI tried\n',
};
// A free run still succeeds; only its cost differs.
REPORTS.free = REPORTS.success;

if (behaviour === 'chatty') {
  // Many events then an immediate exit with no report. The point is the race: every line must be on
  // disk before the runner reads the transcript tail to stand in for the missing report.
  for (let i = 0; i < 20; i++) {
    say({
      type: 'assistant',
      message: { content: [{ type: 'text', text: `step ${i}` }] },
      session_id: 'shim-run',
    });
  }
  process.exit(0);
} else if (behaviour === 'hang') {
  setInterval(() => {}, 1000); // never exits; the test cancels or times it out
} else {
  const body = REPORTS[behaviour];
  if (body && match) {
    const path = join(process.cwd(), match[0]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
  }
  say({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    num_turns: 3,
    duration_ms: 1250,
    session_id: 'shim-run',
    // `free` reports a genuine zero, which must survive to the record as zero and not as "unknown".
    total_cost_usd: behaviour === 'free' ? 0 : 0.0125,
    usage: { input_tokens: 5, cache_read_input_tokens: 95, output_tokens: 7 },
  });
  process.exit(behaviour === 'crash' ? 2 : 0);
}
