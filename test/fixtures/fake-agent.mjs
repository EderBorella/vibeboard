#!/usr/bin/env node
// Test shim standing in for an agent running a skill. Behaves per VIBEBOARD_SHIM_BEHAVIOUR so one
// file covers every way a run can end:
//
//   success   — writes a success report and exits 0
//   attention — writes an attention report with options
//   silent    — writes nothing at all and exits 0 (the case the contract has to survive)
//   garbage   — writes a report with malformed frontmatter
//   crash     — exits non-zero without a report
//   hang      — never exits, for cancel and timeout
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
const behaviour = process.env.VIBEBOARD_SHIM_BEHAVIOUR ?? 'success';

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

if (behaviour === 'hang') {
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
    num_turns: 1,
    duration_ms: 5,
    session_id: 'shim-run',
    usage: { input_tokens: 5, output_tokens: 7 },
  });
  process.exit(behaviour === 'crash' ? 2 : 0);
}
