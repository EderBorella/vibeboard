import { declaredCommands } from '../core/foundation.js';
import { startSession } from '../exec/git-work.js';
import { readAutopilotState, updateAutopilotState } from '../server/autopilot-store.js';
import { commitTail, performAction } from './act.js';
import { BoardClient } from './board-client.js';
import { runLoop } from './loop.js';

// The auto-pilot loop, as a process. Spawned by the server (`src/server/service-process.ts`), which hands it
// everything below in its environment and supervises it.
//
// This file is WIRING ONLY, deliberately: the decisions are in `src/core/tick.ts` (pure), the sequencing is
// in `./loop.ts` (injected dependencies, no process), and carrying an action out is in `./act.ts`. What is
// left here is the three things that can only come from a real process — the environment, the clock, and the
// state file — plus the exit code. Nothing here is worth a test, which is the point of it being this small.

const token = process.env.VIBEBOARD_SERVICE_TOKEN;
const apiBase = process.env.VIBEBOARD_API_BASE;
const root = process.env.VIBEBOARD_PROJECT_ROOT;

// A refusal rather than a crash, and it says which variable: this process is started by code, so a missing
// one is a wiring mistake somebody has to find, and `undefined` in a URL is not a clue.
if (!token || !apiBase || !root) {
  const missing = [
    ...(token ? [] : ['VIBEBOARD_SERVICE_TOKEN']),
    ...(apiBase ? [] : ['VIBEBOARD_API_BASE']),
    ...(root ? [] : ['VIBEBOARD_PROJECT_ROOT']),
  ];
  console.error(`the auto-pilot loop cannot start: ${missing.join(', ')} not set`);
  process.exit(2);
}

const client = new BoardClient({ apiBase, token });
const log = (message: string): void => {
  // stdout is `ignore`d by the parent, so this is for a hand-run: `node dist/service/main.js` with the three
  // variables set is how the loop is exercised on its own, and a loop that says nothing is one nobody can
  // debug. What it wants remembered goes in the diary instead.
  console.log(`[autopilot] ${message}`);
};

// One read before anything else, as a pre-flight: a loop whose project is not open, or whose credential is
// already gone, says so here with the server's own sentence rather than dying inside its first tick.
const board = await client.board();
if (!board.ok) {
  console.error(`the auto-pilot loop cannot start: ${board.reason}`);
  process.exit(2);
}
// The branch this session works on, read once at start-up because a session commits and switches ONCE
// (`startSession`) rather than per run.
const branchName = `autopilot/${new Date().toISOString().slice(0, 10)}`;
// Commits whatever was already in the tree, THEN switches. A dirty tree is not a blocker (ruling
// 2026-08-11): the only moment a person's own edits can be sitting there is the moment they press Start, so
// the session records them where they made them and begins from that.
const branch = await startSession(root, branchName);
if (!branch.ok) {
  // Reported through the server so it reaches the overlay and the diary rather than a stdout nobody reads.
  await client.stopped('stalled', `Auto-pilot could not start on its own branch: ${branch.reason}`);
  console.error(branch.reason);
  process.exit(2);
}

const actDeps = {
  client,
  log,
  root,
  branch: branch.branch,
  now: () => new Date(),
  // FRESH ON EVERY READ, not captured here: an agent may rewrite a gate document mid-session, and the loop
  // refuses to run a gate command while one is unread. A value read at start-up would be a refusal about a
  // state that has already changed.
  state: () => readAutopilotState(root, new Date().toISOString()),
};

const ended = await runLoop({
  client,
  // Decision 20's carve-out: the state file directly, not over HTTP. `GET /autopilot/state` is admin-only,
  // and the counters below are the loop's own.
  readState: () => readAutopilotState(root, new Date().toISOString()),
  // The same carve-out, for the same reason: the foundation documents are on disk and no route serves them to a
  // `service` credential.
  commands: () => declaredCommands(root),
  addToCounters: async (dispatches) => {
    await updateAutopilotState(root, new Date().toISOString(), (current) => ({
      ...current,
      iteration: current.iteration + dispatches,
    }));
  },
  commitTail: (reason) => commitTail(actDeps, reason),
  act: (action, context) => performAction(actDeps, action, context),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log,
});

log(`finished after ${ended.iterations} dispatches: ${ended.reason}`);
// Zero whichever reason it ended with. The reason is recorded in the state file and the diary, where a person
// reads it; an exit code has one bit of room and the supervisor already treats any exit as the end. A non-zero
// code here would make an ordinary `complete` look like a crash in every process listing.
process.exit(0);
