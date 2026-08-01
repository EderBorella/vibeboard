#!/usr/bin/env node
// Test shim standing in for `opencode serve`, for opencode-server's own tests. It never binds a
// socket: these tests read what the process SAYS, not what it serves.
//
// Argv is fixed by startServer (`serve --port N --hostname H`), so behaviour cannot be selected the
// way the other shims do it from the prompt. This one has only what the logging test needs:
//   1. a listening line, so startServer settles and resolves the URL
//   2. then, on separate ticks, a stdout line, a stderr line, and a newline-only chunk — the output
//      that used to go nowhere once the promise had settled.
// Each on its own tick because a chunk that arrives BEFORE settle is accumulated, never logged.
const port = process.argv[process.argv.indexOf('--port') + 1] ?? '0';
process.stdout.write(`opencode server listening on http://127.0.0.1:${port}\n`);

setInterval(() => process.stdout.write('GET /session 200\n'), 40);
setInterval(() => process.stderr.write('provider error: no credentials for anthropic\n'), 55);
// Trailing whitespace only: must not become a blank log line.
setInterval(() => process.stdout.write('\n'), 70);
