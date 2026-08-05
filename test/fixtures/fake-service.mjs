#!/usr/bin/env node
// Test shim standing in for the auto-pilot loop (src/service/main.ts, built in Task 7).
//
// It records what the process was ACTUALLY given — argv, cwd, and the three variables the server passes
// it — so a test can assert what reaches the loop rather than what the code appears to pass. The log
// path comes as argv[2] rather than through the environment, deliberately: the environment is what is
// under test here, and two test files sharing a worker would otherwise write to one another's log.
//
//   argv[2]  where to write the record
//   argv[3]  'exit:<code>' to end immediately, or 'sleep' (the default) to stay alive
import { readFileSync, writeFileSync } from 'node:fs';

const [, , logPath, behaviour = 'sleep'] = process.argv;

// Node exposes no getpgrp, so the group comes from /proc the same way src/server/process-group.ts reads
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

if (logPath) {
  writeFileSync(
    logPath,
    JSON.stringify({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      pid: process.pid,
      // The whole point of the fixture: a confined process would not be `node` at all, it would be
      // `aa-exec -p vibeboard-agent -- node …`, so argv[0] is what proves the sandbox wrapper was NOT
      // applied. See the test that says why.
      argv0: process.argv0,
      token: process.env.VIBEBOARD_SERVICE_TOKEN ?? null,
      apiBase: process.env.VIBEBOARD_API_BASE ?? null,
      projectRoot: process.env.VIBEBOARD_PROJECT_ROOT ?? null,
      // Its own process group means the leader is itself. `detached: true` is what makes this true, and
      // an emergency stop depends on it.
      isGroupLeader: process.pid === processGroup(),
    }) + '\n',
  );
}

if (behaviour.startsWith('exit:')) process.exit(Number(behaviour.slice(5)));

// Otherwise stay alive until killed, without holding a busy loop.
setInterval(() => {}, 60_000);
