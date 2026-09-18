import { chmodSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { DiaryEntry } from '../src/core/diary.js';
import { HARNESS_FEATURE } from '../src/core/harness-feature.js';
import { childrenOf, isLive, parentBoardOf, parentOf } from '../src/core/hierarchy.js';
import { skillRel } from '../src/core/layout.js';
import type { RunRecord } from '../src/core/runs.js';
import type { BoardName, Card } from '../src/core/types.js';
import { type ActDeps, performAction } from '../src/service/act.js';
import { BoardClient } from '../src/service/board-client.js';
import { type LoopEnded, runLoop } from '../src/service/loop.js';
import {
  readAutopilotState,
  updateAutopilotState,
  writeAutopilotState,
} from '../src/store/autopilot-store.js';
import { declaredCommands } from '../src/store/project/foundation.js';
import {
  injectFetch,
  makeReady,
  openTestProject,
  putFoundation,
  shimArgsLog,
  type TestProject,
} from './helpers.js';

// THE LIFECYCLE, END TO END, against a throwaway project — the trace Part One §4 of the plan states, asserted
// rather than described. A trace in a document that nothing checks is a trace that will be wrong within a
// week, and every failure this design was written against was an ORDERING or an absence: a set of
// individually reasonable events is exactly what a circle looks like.
//
// NO MODEL, and none is needed. Every dispatch is served by test/fixtures/fake-agent.mjs, whose behaviour
// travels in the PROMPT rather than the environment — env is shared with every other test file in the
// process, and a sibling rewriting it mid-run is what once made Stryker's dry run fail where `npm test`
// passed. Each skill is seeded with the behaviour this suite wants and needs no other plumbing.
//
// WHAT IS READ, and this is the point: the DIARY and the RUN RECORDS, both off disk. A trace asserted against
// a spy on the loop would pass even if nothing reached the project — it would prove the loop called itself in
// an order, not that the project moved.
//
// The project root comes from `tempDir()`, which mkdtemps inside the run's own root: one per-RUN root removed
// by test/global-teardown.ts is what stopped 440,653 leaked trees filling the filesystem's inode table, after
// which one arbitrary test fails per run and looks exactly like flakiness.

const SHIM = join(process.cwd(), 'test', 'fixtures', 'fake-agent.mjs');
// Stryker runs the suite from a sandbox COPY of the repo, and the copy does not carry the executable bit.
chmodSync(SHIM, 0o755);

// A gate command that RECORDS EVERY TIME IT RUNS, in the project itself. That is what makes "no gate command
// was run" assertable from disk rather than from a seam: the loop runs the real `verifyGates` here, through
// the real shell, exactly as it would on a person's project.
const GATE_LOG = 'gate-runs.log';
const SMOKE_LOG = 'smoke-runs.log';
const tally = (log: string) => `echo ran >> ${log}`;

const gatesDoc = (command: string) =>
  `---\ngates:\n  - name: tally\n    command: "${command}"\n---\nThe bar every card clears.\n`;
const testingDoc = (command: string) => `---\nsmoke: "${command}"\n---\nWhat a smoke test means here.\n`;

// THE HARNESS FEATURE'S BREAK-DOWN, which no card body can drive: the loop creates that card with a canned body
// (ruling 66), so its chain has to come from the SKILL — scoped to F-002, which is the id the harness takes in
// every test below that derives exactly one feature. Every other break-down still reads its own card.
const HARNESS_CHAIN = (mode: Mode) => `[[behaviour@F-002:${mode}:product:1:engineering:1]]`;

// How many times a command declared in a foundation document actually ran, counted from what it wrote.
async function ranTimes(root: string, log: string): Promise<number> {
  try {
    return (await readFile(join(root, log), 'utf8')).trim().split('\n').filter(Boolean).length;
  } catch {
    return 0; // never ran, so the file was never made
  }
}

// The behaviour marker goes into the skill's own body, which `buildRunPrompt` puts at the top of every prompt.
// APPENDED rather than substituted: the real body travels too, so what the shim is handed is what a model
// would be handed.
//
// `break-down`'s behaviour comes from the CARD rather than from here — the skill body is above the card section
// in the prompt, so an unscoped marker here would win over every card's — and that is how one chain of creates
// drives both levels of a break-down with one skill.
//
// THE ONE EXCEPTION is a marker SCOPED to a single card (`[[behaviour@F-002:…]]`, see the shim), which the
// callers below use for the smoke-harness feature: the loop creates that card with a canned body, so there is no
// card body to put its chain in. Every other card still reads its own.
async function seedSkillBodies(root: string, markers: Record<string, string>): Promise<void> {
  for (const [slug, marker] of Object.entries(markers)) {
    await appendFile(join(root, skillRel(slug, 'SKILL.md')), `\n${marker}\n`, 'utf8');
  }
}

// What the shim reports for every skill the machine dispatches. The two break-downs are absent by design; the
// rest say what this suite wants of them.
const HAPPY = {
  implement: '[[behaviour:success]]',
  review: '[[behaviour:verdict:done]]',
  fix: '[[behaviour:success]]',
  'checkup-story': '[[behaviour:success]]',
  'checkup-feature': '[[behaviour:success]]',
};

interface Started {
  project: TestProject;
  argsLog: string;
}

// A project the loop can drive: ready, empty-boarded unless the caller adds cards, with the app LISTENING.
//
// It listens because the shim is a real child process: it reads the API base out of its own prompt and POSTs
// its cards over HTTP, which is the whole point of the `create` behaviour — the endpoint's rules about which
// board a phase may create on are then genuinely under test. `VIBEBOARD_PORT` is what the prompt's API base
// is built from, so it is set here and put back afterwards.
async function start(
  opts: { gates?: string; smoke?: string; skills?: Record<string, string> } = {},
): Promise<Started> {
  const project = await openTestProject({ name: 'T', mode: 'brownfield', runBin: SHIM });
  await makeReady(project.app, project.root, { cards: false });
  await putFoundation(project.app, 'CODE-QUALITY.md', gatesDoc(opts.gates ?? tally(GATE_LOG)));
  // A SMOKE COMMAND THAT IS NOT THE GATE, unless a test says otherwise: `complete` refuses while the two are the
  // same command (ruling 66), so this is the ordinary project rather than a detail of the fixture.
  await putFoundation(project.app, 'TESTING.md', testingDoc(opts.smoke ?? tally(SMOKE_LOG)));
  await seedSkillBodies(project.root, opts.skills ?? HAPPY);

  await project.app.listen({ host: '127.0.0.1', port: 0 });
  const address = project.app.server.address();
  if (address === null || typeof address === 'string')
    throw new Error('the test app is not listening on a port');
  const port = process.env.VIBEBOARD_PORT;
  const argsLog = shimArgsLog();
  const args = process.env.VIBEBOARD_SHIM_ARGS;
  process.env.VIBEBOARD_PORT = String(address.port);
  process.env.VIBEBOARD_SHIM_ARGS = argsLog;
  onTestFinished(() => {
    // Both are process-wide and shared with every other file in this worker, so they go back exactly as they
    // were rather than being deleted.
    if (port === undefined) delete process.env.VIBEBOARD_PORT;
    else process.env.VIBEBOARD_PORT = port;
    if (args === undefined) delete process.env.VIBEBOARD_SHIM_ARGS;
    else process.env.VIBEBOARD_SHIM_ARGS = args;
  });
  return { project, argsLog };
}

// Everything the loop needs, composed the way src/service/main.ts composes it: a real `BoardClient` over
// `injectFetch`, a real `service` credential from the store the app verifies against, and `performAction` as
// the executor. Two seams only, and both are outside the machine: git, because a scaffolded temp folder is no
// repository, and the clock the poll interval reads.
//
// `ticks` bounds the run for the tests that are about a prefix of the lifecycle rather than all of it. The
// state file is the loop's own stop control, so a budget expressed through it stops the loop the way a person
// pressing Stop does rather than by reaching inside it.
// ONE SESSION OF THE LOOP. Every trace below spans TWO of them now — see `drive`.
async function driveOnce(
  started: Started,
  opts: { ticks?: number; unreviewedGates?: string[] } = {},
  // SHARED ACROSS BOTH SESSIONS when there is one, and that is not a detail: `ticks` is how a test says "stop
  // part-way and look". A budget that reset at the review gate would give every such test twice the run it
  // asked for, and several of them then walked past the state they were written to inspect.
  budget = { left: opts.ticks ?? 60 },
): Promise<LoopEnded> {
  const { project } = started;
  await writeAutopilotState(project.root, {
    state: 'running',
    iteration: 0,
    ...(opts.unreviewedGates ? { unreviewedGates: opts.unreviewedGates } : {}),
  });
  const credential = project.mint('service', 'run-service');
  const client = new BoardClient({
    apiBase: 'http://board.test',
    token: credential.token,
    fetch: injectFetch(project.app),
  });
  const actDeps: ActDeps = {
    client,
    root: project.root,
    branch: 'autopilot/test',
    now: () => new Date(),
    state: () => readAutopilotState(project.root, new Date().toISOString()),
    // A scaffolded temp folder is not a git repository, so the real `commitAll` would refuse and stop the
    // loop before its first dispatch. `{committed: false}` with no reason is what it answers for a clean tree.
    commit: async () => ({ committed: false }),
    settlePollMs: 10,
    settleTimeoutMs: 60_000,
  };
  return await runLoop({
    client,
    readState: async () => {
      const state = await readAutopilotState(project.root, new Date().toISOString());
      budget.left -= 1;
      return budget.left < 0 ? { ...state, state: 'stopped' } : state;
    },
    addToCounters: async (dispatches) => {
      await updateAutopilotState(project.root, new Date().toISOString(), (current) => ({
        ...current,
        iteration: current.iteration + dispatches,
      }));
    },
    // OFF DISK, exactly as main.ts wires it: the collision refusal (ruling 66) reads what the foundation
    // documents declare, and every test here writes real ones through `putFoundation`.
    commands: () => declaredCommands(project.root),
    act: (action, context) => performAction(actDeps, action, context),
    // Nothing sleeps: the idle wait is five seconds in production and there is nothing to wait for here.
    wait: async () => {},
  });
}

// EVERY TRACE HERE STARTS FROM AN EMPTY BOARD, so every one of them now meets the review gate (decision 74):
// the loop derives the feature list and stops, and a person confirms before anything is built on it. That is
// one human step, not a phase, so driving through it belongs here rather than repeated at fifteen call sites
// where it would be noise around the thing each test is actually about.
//
// IT IS ASSERTED RATHER THAN ABSORBED, and that distinction is the whole reason this is not a silent second
// call. A helper that just ran the loop twice would let the gate be deleted without one test in this file
// noticing — and this file is the one that would have to notice, because it is the only place the whole
// lifecycle runs. So the first ending must BE `review`: if the gate stops firing, all eighteen fail here.
//
// The second session is the person pressing Confirm. It re-reads the board from disk exactly as a resumed
// loop does, which is also why the traces below are unchanged by any of this: the phases are the same
// phases, in the same order, either side of a stop.
async function drive(
  started: Started,
  opts: { ticks?: number; unreviewedGates?: string[] } = {},
): Promise<LoopEnded> {
  const budget = { left: opts.ticks ?? 60 };
  const first = await driveOnce(started, opts, budget);
  if (first.reason !== 'review') return first;
  return await driveOnce(started, opts, budget);
}

async function diary(project: TestProject): Promise<DiaryEntry[]> {
  const res = await project.app.inject({ method: 'GET', url: '/api/log' });
  expect(res.statusCode).toBe(200);
  return (res.json() as { entries: DiaryEntry[] }).entries;
}

async function runs(project: TestProject): Promise<RunRecord[]> {
  const res = await project.app.inject({ method: 'GET', url: '/api/runs' });
  expect(res.statusCode).toBe(200);
  return (res.json() as { runs: RunRecord[] }).runs;
}

async function board(project: TestProject): Promise<Card[]> {
  const res = await project.app.inject({ method: 'GET', url: '/api/state' });
  const snapshot = (res.json() as { snapshot: { boards: Record<BoardName, Card[]> } }).snapshot;
  return Object.values(snapshot.boards).flat();
}

const columnOf = async (project: TestProject, id: string): Promise<string | undefined> =>
  (await board(project)).find((c) => c.id === id)?.columnSlug;

// EVERY CARD MOVEMENT AND EVERY VERDICT, in the order the diary records them — which is the order they
// happened, because the diary is append-only and one process writes it.
//
// A line this does not recognise comes back verbatim, so a new kind of event shows up in the assertion's own
// diff rather than being silently dropped from the trace.
function step(entry: DiaryEntry): string {
  const moved = entry.text.match(/^(\S+) moved to (\S+):/);
  if (moved) return `move ${entry.board}/${moved[1]} ${moved[2]}`;
  const setup = entry.text.match(/^(\S+) is this project's scaffolding feature/);
  if (setup) return `flag ${setup[1]} setup`;
  const harness = entry.text.match(/^(\S+) is this project's smoke harness/);
  if (harness) return `harness ${harness[1]}`;
  const smoke = entry.text.match(/ran the smoke command before (\S+) checkup — it (passed|did not pass)/);
  if (smoke) return `smoke ${smoke[1]} ${smoke[2] === 'passed' ? 'pass' : 'fail'}`;
  const gates = entry.text.match(/^(\S+) failed its gates/);
  if (gates) return `gates ${gates[1]} fail`;
  const review = entry.text.match(/^Iteration \d+: (\S+)'s review (passed it|sent it back)/);
  if (review) return `review ${review[1]} ${review[2] === 'passed it' ? 'pass' : 'sent-back'}`;
  const project = entry.text.match(/^Iteration \d+: (\S+) ran against the project to derive the board/);
  if (project) return `ran project ${project[1]}`;
  const ran = entry.text.match(/^Iteration \d+: (\S+) ran (\S+) for its (\S+) phase/);
  if (ran) return `ran ${ran[1]} ${ran[2]}`;
  const stopped = entry.text.match(/^Auto-pilot stopped: /);
  if (stopped) return `stopped ${entry.outcome}`;
  return `${entry.kind}: ${entry.text}`;
}

const trace = async (project: TestProject): Promise<string[]> => (await diary(project)).map(step);

// EVERY DISPATCH, in order, WITH THE COLUMN THE CARD WAS IN WHEN THE AGENT READ IT.
//
// Read out of the prompts the shim was actually given — the run's report path names the run, and the card
// section names the file the card was in — so this is the agent's own view of the board rather than the
// loop's account of it. That is what makes the entry stamp assertable: a loop that dispatched before stamping
// would hand the agent a card in the column it came from, and every per-task test would still pass.
async function dispatches(project: TestProject, argsLog: string): Promise<string[]> {
  const byRun = new Map((await runs(project)).map((r) => [r.run, r]));
  const lines = (await readFile(argsLog, 'utf8')).trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const { prompt } = JSON.parse(line) as { prompt: string };
    const runId = prompt.match(/^[\w./-]*\/([\w.-]+)\.report\.md$/m)?.[1];
    const record = runId === undefined ? undefined : byRun.get(runId);
    const where = prompt.match(/^File: .*boards\/(\w+)\/([\w-]+)\//m);
    if (!record) return `dispatch ??? (${runId})`;
    if (!record.card) return `dispatch project ${record.skill}`;
    return `dispatch ${record.card} ${record.skill} in ${where?.[1]}/${where?.[2]}`;
  });
}

// A card placed by hand, as a person would from the board. Admin-scoped, so none of the loop's own rules
// about who may create what are involved.
//
// THE BODY IS PART OF IT, because `break-down` is the one skill this file never seeds: its behaviour travels
// in the CARD (see `seedSkillBodies`), so a hand-placed story with no marker is a break-down that creates
// nothing — which is exactly the run that produced decision 45's correction.
async function place(
  project: TestProject,
  board: BoardName,
  columnSlug: string,
  title: string,
  links: string[] = [],
  body?: string,
): Promise<string> {
  const res = await project.app.inject({
    method: 'POST',
    url: '/api/cards',
    payload: { board, columnSlug, title, ...(body === undefined ? {} : { body }) },
  });
  expect(res.statusCode).toBe(200);
  const card = res.json() as Card;
  if (links.length > 0) {
    const linked = await project.app.inject({
      method: 'PUT',
      url: `/api/cards/${board}/${card.id}/links`,
      payload: { links },
    });
    expect(linked.statusCode).toBe(200);
  }
  return card.id;
}

// THE TWO CREATE MODES the API admits, and the whole trace runs under each. `create` POSTs a card and then PUTs
// its own link list; `createlinks` sends `links` on the POST, the way `POST /api/cards` used to advertise. The
// shim is COMPLIANT either way, which is the problem this closes: written from the same mental model as the code,
// it could only ever confirm that model, and the route it did not take is the one that shipped orphans.
const MODES = ['create', 'createlinks'] as const;
type Mode = (typeof MODES)[number];

// `<mode>:<board>:<n>[…]` — the chain travels through the cards the shim creates, carrying the mode with it, so
// one marker drives every level of a break-down in the mode the suite is running.
const creates = (mode: Mode, chain: string): string => `[[behaviour:${mode}:${chain}]]`;

// THE BOARD'S SHAPE, and its absence is what let the orphan ship. Everything above reads the DIARY and the run
// records — the loop's own account of what it did, which is true of a project whose every card is an orphan: the
// two tasks that produced this ruling were created, echoed their parent's id back, and were invisible to the
// machine in both directions.
//
// TWO CLAIMS, and the second is why the first is not enough. No live card below the top board is an orphan; and
// each parent's children are EXACTLY the cards its runs created — attributed from `Card.createdBy`, which the
// endpoint stamps from the credential, so nothing here trusts a run's own report of what it made. Claim one alone
// passes on a card hung under the wrong parent, which is what "link to the run's own card" does to a checkup's
// sibling.
async function assertHierarchy(project: TestProject): Promise<void> {
  const cards = (await board(project)).filter(isLive);
  const byRun = new Map((await runs(project)).map((r) => [r.run, r]));
  const madeByRun = (card: Card): boolean => card.createdBy !== undefined;

  // NO ORPHANS. A feature is the top of its own vertical and has nobody above it; everything else must be
  // reachable downwards from one, because `childrenOf` is the only way the machine walks.
  expect(
    cards.filter((c) => c.board !== 'features' && parentOf(c, cards) === undefined).map((c) => c.id),
  ).toEqual([]);

  // Where a run-created card BELONGS: the card on the board above what its run's phase creates — the run's own
  // card when it sits there, and the card above THAT when the phase created on its own board (a checkup's
  // siblings). Derived here from the boards rather than from the endpoint's code, so the two have to agree.
  const want: Record<string, string[]> = {};
  const actual: Record<string, string[]> = {};
  for (const parent of cards) {
    want[parent.id] = [];
    actual[parent.id] = childrenOf(parent, cards)
      .filter(madeByRun)
      .map((c) => c.id)
      .sort();
  }
  for (const card of cards.filter(madeByRun)) {
    const run = byRun.get(card.createdBy as string);
    // A project run has no card: the bootstrap's features sit under nothing, by design.
    if (run?.card === undefined) continue;
    const own = cards.find((c) => c.id === run.card);
    const above = parentBoardOf(card.board);
    const parent =
      own === undefined || above === undefined ? undefined : own.board === above ? own : parentOf(own, cards);
    expect(parent, `${card.id}, created by a run on ${run.card}, belongs under something`).toBeDefined();
    want[(parent as Card).id].push(card.id);
  }
  for (const ids of Object.values(want)) ids.sort();
  expect(actual).toEqual(want);
}

// A MINUTE PER TEST, and vitest's 5,000ms default is the wrong number for what these do. Every test here
// spawns a real HTTP listener, seven to nine real child processes, and real shell commands through
// `/bin/sh`; in isolation one takes about a second, and inside the whole suite — twenty workers, all of
// them busy — this file has been measured at 13.6 seconds for eight tests. Under the default that is a
// timeout on an arbitrary test whenever the machine is loaded, which is indistinguishable from a bug in
// the code and is what a reviewer chasing the ORDERING flake in here also had to wade through.
//
// A timeout is a declaration of how long the work may take, not a retry: no assertion is relaxed by it,
// and a test that genuinely hangs still fails — one minute later.
for (const mode of MODES) {
  describe(`the lifecycle, driven end to end — ${mode}`, { timeout: 60_000 }, () => {
    it('walks a feature from an empty board to complete, in the order Part One §4 states', async () => {
      const started = await start({
        // One feature, one story under it, two tasks under that. The chain travels through the cards the shim
        // creates, so one `break-down` skill serves both levels — and each board is named literally, so the
        // endpoint's own rule about where a phase may create is what decides, not the shim.
        skills: {
          ...HAPPY,
          'derive-features': creates(mode, 'features:1:product:1:engineering:2'),
          'break-down': HARNESS_CHAIN(mode),
        },
      });
      const ended = await drive(started);
      expect(ended.reason).toBe('complete');

      expect(await trace(started.project)).toEqual([
        // The scaffolder's own line, which is the project's first event and is in the same file.
        'lifecycle: Project T created.',
        'flag F-001 setup',
        // RULING 66: the loop's own second write at the bootstrap's exit, after the flag and before the diary
        // line about the run. One derived feature, so the harness is F-002 and it sorts last.
        'harness F-002',
        'ran project derive-features',
        // DECISION 74 — THE REVIEW GATE, and its position in this trace is the whole of what it buys. The
        // derivation's two exits are already written above it, and the first card does not move until after
        // it: a person has read the feature list before anything is built on top of it. The second session
        // below this line is that person having confirmed.
        'stopped review',
        'move features/F-001 todo',
        'move features/F-001 in-progress',
        'ran F-001 break-down',
        'move product/P-001 todo',
        'move product/P-001 in-progress',
        'ran P-001 break-down',
        'move engineering/E-001 in-progress',
        'move engineering/E-001 review',
        'ran E-001 implement',
        'move engineering/E-001 done',
        'review E-001 pass',
        // E-002 the same shape, and only after E-001 is done: one task at a time.
        'move engineering/E-002 in-progress',
        'move engineering/E-002 review',
        'ran E-002 implement',
        'move engineering/E-002 done',
        'review E-002 pass',
        'move product/P-001 done',
        'ran P-001 checkup-story',
        'smoke F-001 pass',
        'move features/F-001 done',
        'ran F-001 checkup-feature',
        // AND THEN THE HARNESS FEATURE, walked as an ordinary feature and LAST — which is the only order it can
        // be built in, because there was nothing to smoke test until the work above it existed.
        'move features/F-002 todo',
        'move features/F-002 in-progress',
        'ran F-002 break-down',
        'move product/P-002 todo',
        'move product/P-002 in-progress',
        'ran P-002 break-down',
        'move engineering/E-003 in-progress',
        'move engineering/E-003 review',
        'ran E-003 implement',
        'move engineering/E-003 done',
        'review E-003 pass',
        'move product/P-002 done',
        'ran P-002 checkup-story',
        'smoke F-002 pass',
        'move features/F-002 done',
        'ran F-002 checkup-feature',
        'stopped complete',
      ]);

      expect(await dispatches(started.project, started.argsLog)).toEqual([
        'dispatch project derive-features',
        'dispatch F-001 break-down in features/todo',
        'dispatch P-001 break-down in product/todo',
        'dispatch E-001 implement in engineering/in-progress',
        'dispatch E-001 review in engineering/review',
        'dispatch E-002 implement in engineering/in-progress',
        'dispatch E-002 review in engineering/review',
        'dispatch P-001 checkup-story in product/in-progress',
        'dispatch F-001 checkup-feature in features/in-progress',
        'dispatch F-002 break-down in features/todo',
        'dispatch P-002 break-down in product/todo',
        'dispatch E-003 implement in engineering/in-progress',
        'dispatch E-003 review in engineering/review',
        'dispatch P-002 checkup-story in product/in-progress',
        'dispatch F-002 checkup-feature in features/in-progress',
      ]);

      // The gates ran once per review, in the loop's own process, and the smoke command once before each feature
      // checkup. Counted from what the commands themselves wrote.
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(3);
      expect(await ranTimes(started.project.root, SMOKE_LOG)).toBe(2);
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    it('sends a task back through a fix when a gate fails, dispatching no model for the gate', async () => {
      const started = await start({
        // The gate fails the first time it runs and passes the second: the test chooses the failure, because the
        // command comes from foundation/CODE-QUALITY.md.
        //
        // NO DOUBLE QUOTES — `gatesDoc` puts the command in a double-quoted YAML scalar, and a `"` inside it
        // makes the document unparseable. That is not a broken test, it is a PASSING one: an unreadable gate set
        // is a gates verdict carrying no command, and inside the setup subtree — which every card under the
        // scaffolding feature is — that is the one case the loop excuses, so the card sails through to its
        // review. The first draft of this test did exactly that and asserted nothing at all.
        gates: `echo ran >> ${GATE_LOG}; test $(wc -l < ${GATE_LOG}) -ge 2`,
        skills: {
          ...HAPPY,
          'derive-features': creates(mode, 'features:1:product:1:engineering:1'),
          'break-down': HARNESS_CHAIN(mode),
        },
      });
      const ended = await drive(started);
      expect(ended.reason).toBe('complete');

      const traced = await trace(started.project);
      // TO THE END OF THE FIRST FEATURE only. The harness feature is walked after it — its own trace is the
      // subject of the test above — and this one is about the send-back, which happens once.
      const upTo = traced.indexOf('ran F-001 checkup-feature');
      expect(traced.slice(traced.indexOf('ran E-001 implement'), upTo + 1)).toEqual([
        'ran E-001 implement',
        // No model was asked and no iteration spent: the verdict is the gate's own, and the card goes back.
        'move engineering/E-001 in-progress',
        'gates E-001 fail',
        'move engineering/E-001 review',
        'ran E-001 fix',
        'move engineering/E-001 done',
        'review E-001 pass',
        'move product/P-001 done',
        'ran P-001 checkup-story',
        'smoke F-001 pass',
        'move features/F-001 done',
        'ran F-001 checkup-feature',
      ]);

      // THE GATE SPENT NOTHING. One review run for E-001, not two — the failing gate dispatched no model at
      // all — and exactly one fix in the whole project, because the gate passes from its second run onwards.
      const all = await runs(started.project);
      expect(all.filter((r) => r.card === 'E-001' && r.skill === 'review')).toHaveLength(1);
      expect(all.filter((r) => r.skill === 'fix')).toHaveLength(1);
      // Three: E-001 fails, E-001 passes after the fix, and the harness feature's own task passes first time.
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(3);
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    it('runs no gate command and stops while a gate document is unreviewed', async () => {
      const started = await start({
        skills: { ...HAPPY, 'derive-features': creates(mode, 'features:1:product:1:engineering:1') },
      });
      // THE DOCUMENT GOES UNREAD MID-SESSION, which is the shape this guard exists for: an agent rewrites
      // `foundation/CODE-QUALITY.md` while the loop is running, and the commands in it would then run
      // unsandboxed as this user. Set from the start it would prove less than it looks — `POST /api/runs`
      // refuses every dispatch while one is unread, so nothing would ever reach a review at all.
      //
      // Four ticks: bootstrap, the feature's break-down, the story's, and the implement that leaves E-001 in
      // review. Both premises are asserted rather than assumed, because a budget that stopped one tick later
      // would run the gates itself and this test would then be about nothing.
      const first = await drive(started, { ticks: 4 });
      expect(first.reason).toBe('stopped');
      expect(await columnOf(started.project, 'E-001')).toBe('review');
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(0);

      const ended = await drive(started, { unreviewedGates: ['foundation/CODE-QUALITY.md'] });
      expect(ended.reason).toBe('stalled');
      expect(ended.detail).toContain('will not run a gate command');
      // NOTHING EXECUTED. The refusal is in front of the shell, not after it.
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(0);
      // And no model was asked either: the review phase never got past its own first step.
      expect((await runs(started.project)).filter((r) => r.skill === 'review')).toEqual([]);
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    // THE SAME HOLE, ONE DOCUMENT OVER. `foundation/TESTING.md` carries the `smoke:` command and is in the same
    // EXECUTED set as `foundation/CODE-QUALITY.md` (server/content/control-routes.ts) — both run through `/bin/sh`
    // unsandboxed as this user. The refusal guarded only the gates, so a copilot could rewrite `TESTING.md`, the
    // loop would reach a feature checkup, and the new command would execute before the dispatch that would have
    // been refused.
    //
    // Counted from what the command itself WROTE, exactly as the gate case is: a seam would prove the loop
    // called something in an order, not that no shell ran.
    it('runs no smoke command and stops while a gate document is unreviewed', async () => {
      const started = await start({
        skills: { ...HAPPY, 'derive-features': creates(mode, 'features:1:product:1:engineering:1') },
      });
      // Six ticks: bootstrap, the feature's break-down, the story's, E-001's implement, its review, and P-001's
      // checkup — which leaves F-001 open with every story of it settled, one tick short of its own checkup.
      // Both premises are asserted rather than assumed: a budget one tick longer would run the smoke command
      // itself and this test would then be about nothing.
      const first = await drive(started, { ticks: 6 });
      expect(first.reason).toBe('stopped');
      expect(await columnOf(started.project, 'P-001')).toBe('done');
      expect(await columnOf(started.project, 'F-001')).toBe('in-progress');
      expect(await ranTimes(started.project.root, SMOKE_LOG)).toBe(0);

      const ended = await drive(started, { unreviewedGates: ['TESTING.md'] });
      expect(ended.reason).toBe('stalled');
      expect(ended.detail).toContain('will not run a gate command');
      // NOTHING EXECUTED. The refusal is in front of the shell, not after it.
      expect(await ranTimes(started.project.root, SMOKE_LOG)).toBe(0);
      // And no checkup was asked either: the loop stopped before the dispatch the endpoint would have refused.
      expect((await runs(started.project)).filter((r) => r.skill === 'checkup-feature')).toEqual([]);
      expect(await columnOf(started.project, 'F-001')).toBe('in-progress');
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    it('blocks a task that cannot be fixed, and still closes its story and its feature', async () => {
      const started = await start({
        gates: `echo ran >> ${GATE_LOG}; exit 1`,
        skills: {
          ...HAPPY,
          'derive-features': creates(mode, 'features:1:product:1:engineering:1'),
          'break-down': HARNESS_CHAIN(mode),
        },
      });
      const ended = await drive(started);

      // The loop CARRIES ON past a task nobody can fix (decision 45), and says what it left behind. Both of
      // them: this gate fails for everything, so the harness feature's own task is blocked too — which is the
      // limitation ruling 66 records rather than a surprise. The harness cannot verify itself.
      expect(ended.reason).toBe('complete');
      expect(ended.detail).toContain('E-001');
      expect(ended.detail).toContain('E-002');
      expect(await columnOf(started.project, 'E-001')).toBe('blocked');
      expect(await columnOf(started.project, 'P-001')).toBe('done');
      expect(await columnOf(started.project, 'F-001')).toBe('done');
      expect(await columnOf(started.project, 'F-002')).toBe('done');
      // One fix budget for both send-back kinds: three fixes and no more per task, then blocked.
      const fixes = (await runs(started.project)).filter((r) => r.skill === 'fix');
      expect(fixes.filter((r) => r.card === 'E-001')).toHaveLength(3);
      expect(fixes.filter((r) => r.card === 'E-002')).toHaveLength(3);
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    // THE FEATURE CHECKUP'S OTHER EXIT (the L1 loop). A checkup that created stories has not finished its
    // feature: it stays OPEN and L2 walks what appeared under it. Stamped `done` regardless, those stories are
    // ORPHANS — `derivePosition` picks a feature only out of `todo` or `in-progress`, so a closed feature is
    // never re-entered and nothing would ever pick them up.
    //
    // ASSERTED END TO END rather than in a unit fixture, because the failure is not in either half: the stamp
    // and the derivation are each individually reasonable, and only walking from one to the other shows that
    // what one produced the other cannot see.
    it('leaves a feature open when its checkup creates a story, and walks that story', async () => {
      const started = await start({
        skills: {
          ...HAPPY,
          'derive-features': creates(mode, 'features:1:product:1:engineering:1'),
          // The checkup finds something missing and creates one story for it, carrying a task of its own.
          'checkup-feature': creates(mode, 'product:1:engineering:1'),
        },
      });
      // Eight ticks: bootstrap, the feature's break-down, the story's, E-001's implement, its review, P-001's
      // checkup, the feature checkup that creates P-002, and P-002's own break-down. Stopped there because the
      // seeded checkup creates on EVERY run, so left to itself this project never closes — which is decision
      // 47's own bound and is asserted in test/tick.test.ts rather than paid for here.
      const ended = await drive(started, { ticks: 8 });
      expect(ended.reason).toBe('stopped');

      const traced = await trace(started.project);
      expect(traced.slice(traced.indexOf('ran P-001 checkup-story'))).toEqual([
        'ran P-001 checkup-story',
        'smoke F-001 pass',
        // No `move features/F-001 done` before it, and none after: the checkup created work, so its feature
        // is not finished.
        'ran F-001 checkup-feature',
        // L2, over the story that checkup created.
        'move product/P-002 todo',
        'move product/P-002 in-progress',
        'ran P-002 break-down',
      ]);
      expect(traced).not.toContain('move features/F-001 done');
      expect(await columnOf(started.project, 'F-001')).toBe('in-progress');
      // And the story it created is real work with a task under it, not a card nothing will ever reach.
      expect(await columnOf(started.project, 'E-002')).toBe('backlog');
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    // A STORY CHECKUP THAT CREATES, which nothing anywhere drove — and it is the one phase whose parent is NOT
    // the run's own card: it creates SIBLINGS on its own board, whose parent is the feature above. Nobody had
    // noticed the shim's own parent choice is wrong for it, because no test ever made it choose.
    //
    // The sibling joins L2's queue (decision 47) rather than reopening anything, so what proves the link is the
    // loop WALKING it: an orphan sibling is invisible to `derivePosition`, which finds a story only among the
    // current feature's children.
    it('walks a story a story checkup creates, hung off the feature and not off its sibling', async () => {
      const started = await start({
        skills: {
          ...HAPPY,
          'derive-features': creates(mode, 'features:1:product:1:engineering:1'),
          // The checkup finds a criterion that was missed and cards it as a sibling story, with a task of its own.
          'checkup-story': creates(mode, 'product:1:engineering:1'),
        },
      });
      const ended = await drive(started, { ticks: 8 });
      expect(ended.reason).toBe('stopped');

      const traced = await trace(started.project);
      expect(traced.slice(traced.indexOf('ran P-001 checkup-story'))).toEqual([
        'ran P-001 checkup-story',
        // P-001 closes and the sibling joins the queue: L2 walks it, which it can only do if the feature owns it.
        'move product/P-002 todo',
        'move product/P-002 in-progress',
        'ran P-002 break-down',
        // And L3 under that, on the task the sibling's own break-down produced — the whole vertical below a card
        // no phase would ever have reached if it were hung off its sibling.
        'move engineering/E-002 in-progress',
        'move engineering/E-002 review',
        'ran E-002 implement',
      ]);
      await assertHierarchy(started.project);
    });

    // THE RUN THAT PRODUCED DECISION 45's 2026-08-13 CORRECTION, driven end to end. P-001 was delivered and
    // closed, and then P-002 — the same story under a second title — could not be broken down, three times,
    // because P-001's tasks had already satisfied it. Every attempt reported the truth: there is nothing to
    // create here. The loop refused to advance a creating phase that created nothing (decision 43,
    // correctly), burned the attempts, and then STOPPED THE ENTIRE PROJECT over one redundant story.
    //
    // ASSERTED HERE rather than only in test/tick.test.ts because the bug was not in any one half: the cap
    // path, the position and the checkup trigger are each individually reasonable, and only walking from one
    // to the next shows that a story nobody can break down used to take the whole board with it.
    //
    // The two titles are the real ones. The OVERLAP that caused it is a separate finding and belongs to
    // `break-down`'s prompt: no deterministic check can see that these are one story, which is why the
    // checkups are where over-scope has to be noticed.
    it('blocks a story that cannot be broken down, and carries on with the next one', async () => {
      const started = await start();
      // One feature with two stories, placed by hand: the feature arrives with its stories, so its own
      // break-down is skipped and each story's is what this test is about. The FIRST carries a create
      // marker and delivers a task; the SECOND carries none, so its break-down creates nothing — three
      // times, which is `attemptCap`.
      const first = await place(
        started.project,
        'product',
        'backlog',
        'npm test is configured and working',
        [],
        `Make the test command real.\n${creates(mode, 'engineering:1')}\n`,
      );
      const second = await place(
        started.project,
        'product',
        'backlog',
        'node:test framework is set up',
        [],
        'Already delivered by the story above, though nothing can know that deterministically.\n',
      );
      await place(started.project, 'features', 'backlog', 'A test runner', [first, second]);

      const ended = await drive(started);

      // THE RUN DOES NOT STOP. One story nobody can break down must not cost the project what is behind it.
      expect(ended.reason).toBe('complete');
      expect(ended.detail).toContain('P-002');
      expect(await columnOf(started.project, 'P-002')).toBe('blocked');
      expect(await columnOf(started.project, 'P-001')).toBe('done');
      expect(await columnOf(started.project, 'F-001')).toBe('done');

      const traced = await trace(started.project);
      expect(traced.slice(traced.indexOf('move product/P-001 done'))).toEqual([
        'move product/P-001 done',
        'ran P-001 checkup-story',
        // L2 moves on to the sibling, which is where the old behaviour ended the project instead.
        'move product/P-002 todo',
        // Three attempts, each of which created nothing — and ONE entry stamp between them, because a retry
        // whose card is already in `todo` writes no move.
        'ran P-002 break-down',
        'ran P-002 break-down',
        'ran P-002 break-down',
        // No fourth dispatch: the stamp is the loop's own act, with no run and nothing spent.
        'move product/P-002 blocked',
        // And the feature reaches its checkup over a settled story it could not break down, and closes.
        'smoke F-001 pass',
        'move features/F-001 done',
        'ran F-001 checkup-feature',
        'stopped complete',
      ]);

      // EXACTLY THREE, from the run records rather than from the trace: the cap is what stops it, and a
      // fourth attempt would be the loop paying for a judgement it already has three times over.
      const all = await runs(started.project);
      expect(all.filter((r) => r.card === 'P-002' && r.skill === 'break-down')).toHaveLength(3);
      // FINDING F, incidentally proved: the shim's success report CLAIMS `created: [E-041]` and the board
      // says otherwise, so what refused to advance the card was the board comparison and not the report.
      expect(all.some((r) => r.card === 'P-002' && r.created?.includes('E-041'))).toBe(true);
      expect((await board(started.project)).map((c) => c.id)).not.toContain('E-041');
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    // RULING 66, END TO END, and the two halves are asserted apart. THE CARD: the bootstrap produces the derived
    // features PLUS the harness feature, and the harness is last — which is load-bearing rather than incidental,
    // because a harness built before the product verifies nothing.
    it('derives the features and then the harness feature, which sorts last', async () => {
      const started = await start({
        // Two features, so "last" is a position rather than the only one there is.
        skills: { ...HAPPY, 'derive-features': creates(mode, 'features:2') },
      });
      // ONE TICK: the bootstrap and its exit, and nothing after it. A longer budget would break the first
      // feature down and this test would be about the walk instead.
      const first = await drive(started, { ticks: 1 });
      expect(first.reason).toBe('stopped');

      const features = (await board(started.project))
        .filter((c) => c.board === 'features')
        .sort((a, b) => a.order - b.order);
      expect(features.map((c) => c.title)).toEqual([
        'features 1 of 2',
        'features 2 of 2',
        HARNESS_FEATURE.title,
      ]);
      // THE SCAFFOLDING IS FIRST AND THE HARNESS IS NOT IT. Two flags that mean opposite things about when a
      // card is built, so the one thing that must not happen is the loop putting both on one card.
      expect(features.filter((c) => c.setup === true).map((c) => c.id)).toEqual([features[0]?.id]);
      expect(features.at(-1)?.setup).toBeUndefined();
      // In the queue, like every other feature: nothing about it skips the phases in front of it.
      expect(features.at(-1)?.columnSlug).toBe('backlog');
      await assertHierarchy(started.project);
    });

    // AND THE REFUSAL, both directions on one board. The project that produced the ruling declared `npm test` as
    // its gate and as its smoke command: four features closed, sixteen tasks delivered, `complete` reported, and
    // the product had no main and printed nothing.
    it('does not report complete while the smoke command is the gate, and does once it is not', async () => {
      const started = await start({
        // ONE COMMAND FOR BOTH, exactly as a person reaching for the obvious answer would write it.
        smoke: tally(GATE_LOG),
        skills: {
          ...HAPPY,
          'derive-features': creates(mode, 'features:1:product:1:engineering:1'),
          'break-down': HARNESS_CHAIN(mode),
        },
      });
      const refused = await drive(started);

      // Every card done — the harness feature included, because delivering that card is not what this checks —
      // and still not `complete`.
      expect(refused.reason).toBe('stalled');
      expect(refused.detail).toContain(tally(GATE_LOG));
      expect(refused.detail).toContain('foundation/TESTING.md');
      expect(await columnOf(started.project, 'F-001')).toBe('done');
      expect(await columnOf(started.project, 'F-002')).toBe('done');

      // THE ONE THING THAT CHANGES is the document. Nothing on the board moves, no run is dispatched, and the
      // same loop over the same project now finishes.
      await putFoundation(started.project.app, 'TESTING.md', testingDoc(tally(SMOKE_LOG)));
      const before = (await runs(started.project)).length;
      const ended = await drive(started);
      expect(ended.reason).toBe('complete');
      expect(ended.detail).toBeUndefined();
      expect((await runs(started.project)).length).toBe(before);
    });

    it('stops stalled without dispatching when two features are open', async () => {
      const started = await start();
      await place(started.project, 'features', 'todo', 'One');
      await place(started.project, 'features', 'in-progress', 'Two');
      const ended = await drive(started, { ticks: 3 });

      expect(ended.reason).toBe('stalled');
      expect(ended.detail).toContain('F-001');
      expect(ended.detail).toContain('F-002');
      // Nothing was dispatched: the position could not be derived, so there was no phase to be in.
      expect(await runs(started.project)).toEqual([]);
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    it('skips break-down for a feature that arrives with its stories', async () => {
      // The follow-up-feature shape (decision 50), which is also the crash-and-restart shape.
      const started = await start();
      const story = await place(started.project, 'product', 'backlog', 'A story');
      await place(started.project, 'features', 'backlog', 'A feature', [story]);
      const ended = await drive(started, { ticks: 2 });

      const traced = await trace(started.project);
      expect(traced).toContain('move features/F-001 in-progress');
      expect(traced).not.toContain('ran F-001 break-down');
      // THE FIRST THING DISPATCHED IS THE STORY'S break-down, not the feature's: the feature was stamped and
      // passed over, with no run at all, which is what a skip is.
      expect((await runs(started.project)).map((r) => `${r.card} ${r.skill}`)).toEqual(['P-001 break-down']);
      expect(ended.iterations).toBe(1);
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });
  });
}
