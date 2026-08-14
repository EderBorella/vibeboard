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
//   echo      — quotes its own credential back in its narration, then exits 0
//   leaky     — writes a REPORT that quotes its own credential, then exits 0
//   spawner   — starts a child of its own, narrates its pid, then hangs: the grandchild case
//   reporthang— writes a SUCCESS report and then hangs: a run stopped after it claimed victory
//   verdict:v — writes a success report carrying `verdict: v`, for a review run
//   create:…  — creates cards through the API, one POST per card, then PUTs its own link list
//   createlinks:… — the same cards, but with `links` on the POST and no PUT. See `createCards` below.
//
// The report path is read from the prompt it was given, exactly as a real agent would: that means
// these tests fail if the prompt stops naming the path.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);

// The prompt arrives on STDIN, not in argv — it carries the run's credential, and a command line is
// world readable through /proc. Read synchronously from fd 0 so this shim behaves like `claude -p`,
// which waits for EOF before it starts.
let prompt = '';
try {
  prompt = readFileSync(0, 'utf8');
} catch {
  /* no stdin attached */
}

// Both halves recorded, so a test can assert what the prompt said AND that argv did not say it.
if (process.env.VIBEBOARD_SHIM_ARGS) {
  appendFileSync(process.env.VIBEBOARD_SHIM_ARGS, `${JSON.stringify({ argv: args, prompt })}\n`);
}
// The contract puts the path on a line of its own inside a fenced block, so match a whole line
// rather than a folder this shim would otherwise have to keep in step with core/layout.ts.
const match = prompt.match(/^[\w./-]+\.report\.md$/m);
// `[\w:]` and not `\w`: a behaviour may carry arguments, colon-separated, and `\w` excludes the colon — so
// `[[behaviour:create:features:2]]` matched NOTHING and fell through to the `?? 'success'` default. The
// failure was silent and looked exactly like a machine bug: cards never appeared and the loop refused the
// creating phase for producing nothing. Every existing single-word marker still matches, with no arguments.
// A marker may also be scoped to ONE CARD: `[[behaviour@E-004:create:engineering:1]]`, which only this shim's
// own card obeys. It exists for a card whose BODY nobody can seed — the smoke-harness feature is created by the
// loop with a canned body (src/core/harness-feature.ts), so the usual route of putting the chain in the card is
// closed for it, and a marker in the SKILL body wins over every card's because the skill sits higher in the
// prompt. Scoped, it drives exactly one card and every other card still falls through to its own.
//
// `@` is not in `[\w:]`, so the unscoped pattern below cannot see a scoped marker: a skill carrying only a
// scoped one leaves every other card reading its own body, which is what makes this additive.
const scopedMarker = (id) => {
  if (id === undefined) return undefined;
  const escaped = id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return (prompt.match(new RegExp(`\\[\\[behaviour@${escaped}:([\\w:]+)\\]\\]`)) ?? [])[1];
};
const [behaviour = 'success', ...behaviourArgs] = (
  scopedMarker((prompt.match(/^## The card: (\S+)$/m) ?? [])[1]) ??
  (prompt.match(/\[\[behaviour:([\w:]+)\]\]/) ?? [])[1] ??
  'success'
).split(':');

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
  success:
    '---\noutcome: success\nsummary: did the thing\ncreated: [E-041]\n---\n## What I did\n\nAll of it.\n',
  attention:
    '---\noutcome: attention\nsummary: bigger than one card\noptions:\n  - Split it in two\n  - Do the store only\n---\n## What I found\n\nThree cards, not one.\n',
  garbage: '---\noutcome: [unclosed\n---\nI tried\n',
};
// A free run still succeeds; only its cost differs.
REPORTS.free = REPORTS.success;
// A report that quotes the credential: the other half of the same leak, through the file that is
// folded into the run record and pushed to every connected browser.
const leakedCred = (prompt.match(/Your credential: `([^`]+)`/) ?? [])[1] ?? '(none)';
REPORTS.leaky = `---\noutcome: success\nsummary: called the API\n---\n## What I did\n\nRan: curl -H 'Authorization: Bearer ${leakedCred}'\n`;
// A REVIEW's answer. `outcome` and `verdict` are different fields deliberately: a review that ran perfectly
// and sent the work back is `outcome: success` with `verdict: sent-back`, and one that answers nothing at all
// is an inconclusive review rather than a failed run.
REPORTS.verdict = `---\noutcome: success\nsummary: judged the run against its card\nverdict: ${behaviourArgs[0] ?? 'done'}\n---\n## What I judged\n\nThe run, against the card that asked for it.\n`;

// The API base and the credential, out of the PROMPT — the same sentence a real agent reads them from
// (`credentialSection`, src/server/run-prompt.ts). Nothing here comes from the environment.
const apiBase = (prompt.match(/Send it as .* to `([^`]+)`/) ?? [])[1];
const myId = (prompt.match(/^## The card: (\S+)$/m) ?? [])[1];

async function api(method, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${leakedCred}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return JSON.parse(text);
}

// CREATING CARDS, the way the seeded skills tell a real agent to: `POST /api/cards` ONE CALL PER CARD, never
// a batch and never a shell loop whose result cannot be checked (decision 43).
//
// TWO MODES, because the API admits at least three routes to "created and linked" and a COMPLIANT shim written
// from the same mental model as the code can only confirm that model. `create` posts each card and then PUTs its
// own complete link list, which is what the seeded skill used to instruct; `createlinks` sends `links` ON THE
// POST, which is what `POST /api/cards` used to advertise — and that route is the one that shipped two orphans,
// because the field was written into the new card's frontmatter with nothing on the far side. Every trace runs
// under both, so what is asserted is the API's surface rather than one path through it.
//
// The marker is `<mode>:<board>:<n>[:<board>:<n>…]` — pairs. The FIRST pair is what this run creates; the rest
// is written into each new card's body as its own marker, CARRYING THE MODE, so one chain drives every level of
// a break-down: `create:features:1:product:1:engineering:2` derives one feature whose break-down creates one
// story whose break-down creates two tasks. The board is passed LITERALLY, so the endpoint's own rule about
// which board a phase may create on is under test rather than agreed with here.
async function createCards(mode, args) {
  const board = args[0];
  const count = Number(args[1] ?? 1);
  const rest = args.slice(2);
  const childMarker = rest.length > 0 ? `\n[[behaviour:${mode}:${rest.join(':')}]]\n` : '';
  // The parent an agent would name if it named one: its own card. Wrong for a story checkup, which creates
  // siblings — deliberately left wrong, because the server decides the parent and this is what a model sending
  // its best guess looks like.
  const onPost = mode === 'createlinks' && myId !== undefined ? { links: [myId] } : {};
  const created = [];
  for (let n = 1; n <= count; n++) {
    const card = await api('POST', '/api/cards', {
      board,
      // A column the endpoint overrides for a run anyway (it enters the board's first). Sent because a real
      // agent must send one, and a wrong guess is exactly what the stamp exists to correct.
      columnSlug: 'backlog',
      title: `${board} ${n} of ${count}`,
      body: `Made by the shim.\n${childMarker}`,
      ...onPost,
    });
    created.push(card.id);
  }
  // In `createlinks` mode the POST was the whole of it: no second call, which is the point of the mode.
  if (mode === 'create' && myId !== undefined) {
    // The COMPLETE list, which is what the endpoint takes — so this run's existing links have to survive it.
    // Read off the board rather than out of the prompt: `GET /api/state` is unrestricted, and a parent link
    // dropped here would orphan the card above this one.
    const state = await api('GET', '/api/state');
    const boards = state.snapshot?.boards ?? {};
    const mine = Object.values(boards)
      .flat()
      .find((c) => c.id === myId);
    if (mine) {
      await api('PUT', `/api/cards/${mine.board}/${myId}/links`, {
        links: [...mine.links, ...created],
      });
    }
  }
  return created;
}

if (behaviour === 'create' || behaviour === 'createlinks') {
  // A creating run: it changes no files at all, so what it produced is only visible on the board — which is
  // exactly why `createdNothing` compares the board before and after rather than reading this report.
  const created = await createCards(behaviour, behaviourArgs);
  if (match) {
    const path = join(process.cwd(), match[0]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `---\noutcome: success\nsummary: created ${created.length} card${created.length === 1 ? '' : 's'}\ncreated: [${created.join(', ')}]\n---\n## What I did\n\nOne POST per card.\n`,
      'utf8',
    );
  }
  say({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    num_turns: 3,
    duration_ms: 1250,
    session_id: 'shim-run',
    total_cost_usd: 0.0125,
    usage: { input_tokens: 5, cache_read_input_tokens: 95, output_tokens: 7 },
  });
  process.exit(0);
} else if (behaviour === 'chatty') {
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
} else if (behaviour === 'echo') {
  // How a credential really leaks: the agent narrates the command it is about to run, or quotes the
  // prompt back at itself. The transcript is a file every other agent can read.
  const cred = (prompt.match(/Your credential: `([^`]+)`/) ?? [])[1] ?? '(none)';
  say({
    type: 'assistant',
    message: { content: [{ type: 'text', text: `about to run: curl -H 'Authorization: Bearer ${cred}'` }] },
    session_id: 'shim-run',
  });
  process.exit(0);
} else if (behaviour === 'reporthang') {
  // The case S1 is about: the agent declares success in its report and then never exits, so the run
  // ends by cancel or timeout with a report already on disk claiming it worked.
  if (match) {
    const path = join(process.cwd(), match[0]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, REPORTS.success, 'utf8');
  }
  const startedUnder = process.ppid;
  setInterval(() => {
    if (process.ppid !== startedUnder) process.exit(0);
  }, 250);
} else if (behaviour === 'spawner') {
  // What a real agent does constantly: start a compiler, a test runner, a dev server. The child is in
  // THIS process's group and is not detached, so killing the shim alone leaves it running and
  // reparented to init — which is what 15 of the 16 leaked processes on the development machine were.
  //
  // Its pid is narrated rather than written to a file: every event reaches the run's transcript, which
  // is per-run and needs no environment variable shared with the rest of the suite.
  const child = spawn('/bin/sh', ['-c', 'sleep 30'], { stdio: 'ignore' });
  say({
    type: 'assistant',
    message: { content: [{ type: 'text', text: `child ${child.pid}` }] },
    session_id: 'shim-run',
  });
  // Then hang, exactly as `hang` does, so the test can cancel it.
  const started = process.ppid;
  setInterval(() => {
    if (process.ppid !== started) process.exit(0);
  }, 250);
} else if (behaviour === 'hang') {
  // Never exits on its own — the test cancels it or times it out. But if the test RUNNER dies first
  // (a SIGKILLed vitest, an interrupted pre-commit hook), nothing ever does, and the shim outlives
  // the suite that spawned it: fourteen were found still running a week after the fact. Watching
  // ppid costs nothing and covers the kills a process cannot catch.
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent) process.exit(0);
  }, 250);
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
