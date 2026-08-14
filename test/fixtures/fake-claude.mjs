#!/usr/bin/env node
// Test shim standing in for the `claude` CLI. Emits canned stream-json so CopilotSession
// can be tested without spending quota. Echoes whether it was resumed, and records the
// args it was invoked with to a file (VIBEBOARD_SHIM_ARGS) for assertions.
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.VIBEBOARD_SHIM_ARGS) {
  appendFileSync(process.env.VIBEBOARD_SHIM_ARGS, `${JSON.stringify(args)}\n`);
}

const resumed = args.includes('--resume');
const sessionId = 'shim-session';
const say = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

say({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  model: 'shim-model',
  permissionMode: 'bypassPermissions',
  cwd: process.cwd(),
});
say({
  type: 'assistant',
  message: { content: [{ type: 'text', text: resumed ? 'resumed' : 'fresh' }] },
  session_id: sessionId,
});
say({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: resumed ? 'resumed' : 'fresh',
  num_turns: 1,
  duration_ms: 42,
  total_cost_usd: 0.001,
  session_id: sessionId,
  usage: { input_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 7 },
});
process.exit(0);
