#!/usr/bin/env node
// A Claude shim whose turn is still in flight when the test does something else.
//
// fake-claude.mjs finishes within a millisecond, which is precisely why it cannot reproduce the bug
// this exists for: the race needs a turn that is ALIVE when `copilot:new` arrives. This one announces
// its session immediately and then waits, so a test can interleave.
//
// It never exits on its own — the turn is always ended by the caller cancelling it, which is the
// situation under test.
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.VIBEBOARD_SHIM_ARGS) {
  appendFileSync(process.env.VIBEBOARD_SHIM_ARGS, `${JSON.stringify(args)}\n`);
}

const resumed = args.includes('--resume');
// The id the CLI reports. A resumed turn reports the id it was given, exactly as the real one does —
// which is what makes a resumed session indistinguishable from a fresh one in the stored record, and
// why the test asserts on argv instead.
const idx = args.indexOf('--resume');
const sessionId = resumed ? args[idx + 1] : 'slow-session';

const say = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

say({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  model: 'slow-model',
  permissionMode: 'bypassPermissions',
  cwd: process.cwd(),
});

// Then speak LATE, after the test has had time to do something else. This is the half that shows a
// superseded turn's output being handed to whatever chat is current by the time it arrives.
setTimeout(() => {
  say({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'LATE OUTPUT FROM THE OLD TURN' }] },
    session_id: sessionId,
  });
}, 400);

// Hold the turn open. The parent ends it by cancelling, which is the situation under test.
setInterval(() => {}, 1000);
