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
  // THE STORY'S WORK IN ONE RUN (decision 83), which is why no `implement` appears anywhere below: the
  // tasks are what this run is asked for and the loop settles them together when it ends.
  'implement-story': '[[behaviour:success]]',
  // THE ONE JUDGEMENT A STORY GETS (decision 80), and it answers a verdict rather than an outcome — the
  // story checkup it absorbed did not, which is what makes the trace below three dispatches where it was
  // five.
  'review-story': '[[behaviour:verdict:done]]',
  fix: '[[behaviour:success]]',
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
// A BRANCH AND NOT AN ASSERTION, and the reason is worth writing down because the first version got this
// wrong in both directions.
//
// It began as a bare branch with a comment claiming that a deleted gate would fail every trace in this file.
// Planted, it was **2 of 24** — only the two that happen to name `'stopped review'` in their expected array.
// The claim had been written without planting it, which is the one thing this repository's first rule is
// about. Replacing the branch with `expect(first.reason).toBe('review')` then caught the plant at 24 of 24
// and **broke 12 real tests**: several traces stop legitimately before they ever reach the gate — a small
// `ticks` budget, or an unreviewed gate document that stalls the first session — so the helper cannot
// honestly assert it for every caller.
//
// So the gate is pinned where it can be pinned exactly: `stops for review before it works the first
// feature`, below, which drives ONE session and asserts both halves. This helper just carries the other
// traces past a stop that is not their subject.
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
    // THE GATE ITSELF — decision 74 — and the one place in this file that pins it, because `drive` above
    // cannot: several traces here stop legitimately before they reach it.
    //
    // ONE SESSION, and both halves asserted. The reason alone would pass over a gate that fired in the
    // wrong place; what makes it the gate is that NOTHING HAS MOVED YET — the derivation's own exits are
    // written and not one feature has left the column it was derived into. Planted by deleting the stop in
    // `afterProjectRun`: this fails on the reason, and on the board having walked on without anyone.
    it('stops for review before it works the first feature', async () => {
      const started = await start({
        skills: { ...HAPPY, 'derive-features': creates(mode, 'features:1:product:1:engineering:1') },
      });
      const ended = await driveOnce(started);
      expect(ended.reason).toBe('review');
      // It counts, and it names the harness card apart from the derived ones.
      expect(ended.detail).toContain('one feature');
      expect(ended.detail).toContain('smoke-harness');

      // The exits ARE written — the gate sits after them, never instead of them.
      const live = (await board(started.project)).filter(isLive);
      const features = live.filter((c) => c.board === 'features');
      expect(features.filter((c) => c.setup === true)).toHaveLength(1);
      expect(features).toHaveLength(2);
      // And nothing has been built on the list yet: every feature is still where the derivation put it.
      expect(features.every((c) => c.columnSlug === 'backlog')).toBe(true);
      expect(live.filter((c) => c.board === 'engineering')).toHaveLength(0);
    });

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
        // DECISION 83: ONE RUN, AND BOTH TASKS. They are claimed together before the dispatch — which is how
        // the run is told which tasks are its own — and settled together after it, so there is no window in
        // which the story is half-closed. No per-task dispatch, and the run line names the STORY.
        //
        // DECISION 80 still: a task is finished when its work lands, and nothing is stamped into the Review
        // column at all — what gets judged is the story, once every task under it is settled.
        'move engineering/E-001 in-progress',
        'move engineering/E-002 in-progress',
        'move engineering/E-001 done',
        'move engineering/E-002 done',
        'ran P-001 implement-story',
        // AND THEN THE ONE JUDGEMENT, which closes the story and absorbs what the story checkup asked.
        'move product/P-001 done',
        'review P-001 pass',
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
        'move engineering/E-003 done',
        'ran P-002 implement-story',
        'move product/P-002 done',
        'review P-002 pass',
        'smoke F-002 pass',
        'move features/F-002 done',
        'ran F-002 checkup-feature',
        'stopped complete',
      ]);

      // THE COST, WHICH IS THE POINT OF DECISIONS 80 AND 83. Two tasks under P-001 cost five dispatches
      // before either — implement, review, implement, review, checkup — three after the judgement moved up,
      // and two here: one run that does both tasks, and the one judgement.
      expect(await dispatches(started.project, started.argsLog)).toEqual([
        'dispatch project derive-features',
        'dispatch F-001 break-down in features/todo',
        'dispatch P-001 break-down in product/todo',
        // THE STORY, in the column it is judged from: no entry stamp was needed and none was written.
        'dispatch P-001 implement-story in product/in-progress',
        'dispatch P-001 review-story in product/in-progress',
        'dispatch F-001 checkup-feature in features/in-progress',
        'dispatch F-002 break-down in features/todo',
        'dispatch P-002 break-down in product/todo',
        'dispatch P-002 implement-story in product/in-progress',
        'dispatch P-002 review-story in product/in-progress',
        'dispatch F-002 checkup-feature in features/in-progress',
      ]);

      // ONCE PER STORY rather than once per task review, which is the determinism half of decision 80: over
      // 219 real dispatches, 41 of 77 reviews re-ran the gates unprompted and 36 did not. Two stories, so
      // two runs — and the smoke command once before each feature checkup. Counted from what the commands
      // themselves wrote.
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(2);
      expect(await ranTimes(started.project.root, SMOKE_LOG)).toBe(2);
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    it('sends a story back through a fix when a gate fails, dispatching no model for the gate', async () => {
      // Hoisted because two things need the exact bytes: the document the loop reads it out of, and the
      // assertion below that the FIX was handed this very command rather than told to go and look.
      const failing = `echo ran >> ${GATE_LOG}; test $(wc -l < ${GATE_LOG}) -ge 2`;
      const started = await start({
        // The gate fails the first time it runs and passes the second: the test chooses the failure, because the
        // command comes from foundation/CODE-QUALITY.md.
        //
        // NO DOUBLE QUOTES — `gatesDoc` puts the command in a double-quoted YAML scalar, and a `"` inside it
        // makes the document unparseable. That is not a broken test, it is a PASSING one: an unreadable gate set
        // is a gates verdict carrying no command, and inside the setup subtree — which every card under the
        // scaffolding feature is — that is the one case the loop excuses, so the card sails through to its
        // judgement. The first draft of this test did exactly that and asserted nothing at all.
        gates: failing,
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
      expect(traced.slice(traced.indexOf('ran P-001 implement-story'), upTo + 1)).toEqual([
        'ran P-001 implement-story',
        // No model was asked and no iteration spent: the verdict is the gate's own, and the card goes back.
        // AND NO MOVE WITH IT (decision 80): `in-progress` is where a story stands while it is judged, so a
        // send-back's destination is where it already is — a stamp there would be a diary line about an
        // event that did not happen.
        'gates P-001 fail',
        'ran P-001 fix',
        'move product/P-001 done',
        'review P-001 pass',
        'smoke F-001 pass',
        'move features/F-001 done',
        'ran F-001 checkup-feature',
      ]);

      // THE GATE SPENT NOTHING. One judgement run for P-001, not two — the failing gate dispatched no model
      // at all — and exactly one fix in the whole project, because the gate passes from its second run on.
      const all = await runs(started.project);
      expect(all.filter((r) => r.card === 'P-001' && r.skill === 'review-story')).toHaveLength(1);
      expect(all.filter((r) => r.skill === 'fix')).toHaveLength(1);
      // Three: P-001 fails, P-001 passes after the fix, and the harness feature's own story passes first time.
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(3);

      // WHERE THE FAILURE LOCALITY WENT (decision 83). The gates run once for the whole story now, so a red
      // suite no longer says which task broke it — and what recovers that is the fix being HANDED the gate's
      // own command and what it printed, rather than told to go and look. Three links compose to make that
      // true — the verdict is written onto the run the tick named, the tick hands that run to the fix as
      // `previous`, and the prompt renders its verification — and this is the one place all three are
      // exercised together, against the prompt the shim was really given.
      //
      // NOT the judge: it is dispatched only once the gates PASS, so it never sees a failing one. Its own
      // prompt carries `gatesPassed` and nothing else about them.
      const prompts = (await readFile(started.argsLog, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { prompt: string }).prompt);
      const fixPrompt = prompts.find((text) => text.startsWith('# Fix\n'));
      expect(fixPrompt).toBeDefined();
      // THE WHOLE LINE, command included. `toContain('The command that failed:')` alone passes over a
      // heading with nothing under it, and the command's own text appears in this prompt anyway —
      // foundation/CODE-QUALITY.md is quoted in full a few sections up, so matching on it proves nothing.
      expect(fixPrompt).toContain(`The command that failed: \`${failing}\``);
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
      // Four ticks: bootstrap, the feature's break-down, the story's, and the implement that settles E-001
      // and so leaves P-001 at its judging point. Both premises are asserted rather than assumed, because a
      // budget that stopped one tick later would run the gates itself and this test would then be about
      // nothing.
      const first = await drive(started, { ticks: 4 });
      expect(first.reason).toBe('stopped');
      expect(await columnOf(started.project, 'E-001')).toBe('done');
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(0);

      const ended = await drive(started, { unreviewedGates: ['foundation/CODE-QUALITY.md'] });
      expect(ended.reason).toBe('stalled');
      expect(ended.detail).toContain('will not run a gate command');
      // NOTHING EXECUTED. The refusal is in front of the shell, not after it.
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(0);
      // And no model was asked either: the judging phase never got past its own first step.
      expect((await runs(started.project)).filter((r) => r.skill === 'review-story')).toEqual([]);
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
      // Five ticks: bootstrap, the feature's break-down, the story's, E-001's implement, and P-001's
      // judgement — which leaves F-001 open with every story of it settled, one tick short of its own
      // checkup. It was six before decision 80 took the per-task review out. Both premises are asserted
      // rather than assumed: a budget one tick longer would run the smoke command itself and this test
      // would then be about nothing.
      const first = await drive(started, { ticks: 5 });
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

    it('blocks a story that cannot be fixed, and still closes its feature', async () => {
      const started = await start({
        gates: `echo ran >> ${GATE_LOG}; exit 1`,
        skills: {
          ...HAPPY,
          'derive-features': creates(mode, 'features:1:product:1:engineering:1'),
          'break-down': HARNESS_CHAIN(mode),
        },
      });
      const ended = await drive(started);

      // The loop CARRIES ON past a card nobody can fix (decision 45), and says what it left behind. Both of
      // them: this gate fails for everything, so the harness feature's own story is blocked too — which is the
      // limitation ruling 66 records rather than a surprise. The harness cannot verify itself.
      //
      // THE STORY IS WHAT BLOCKS, not the task, and that is decision 80 rather than a change of mind about
      // decision 45: the gates are run once at the story boundary now, so what cannot pass them is the story.
      // Its tasks are done — their work landed — and the story carries the failure they add up to.
      expect(ended.reason).toBe('complete');
      expect(ended.detail).toContain('P-001');
      expect(ended.detail).toContain('P-002');
      expect(await columnOf(started.project, 'E-001')).toBe('done');
      expect(await columnOf(started.project, 'P-001')).toBe('blocked');
      expect(await columnOf(started.project, 'F-001')).toBe('done');
      expect(await columnOf(started.project, 'F-002')).toBe('done');
      // One fix budget for both send-back kinds: three fixes and no more per story, then blocked.
      const fixes = (await runs(started.project)).filter((r) => r.skill === 'fix');
      expect(fixes.filter((r) => r.card === 'P-001')).toHaveLength(3);
      expect(fixes.filter((r) => r.card === 'P-002')).toHaveLength(3);
      // THE BOARD, not the diary: every card the walk produced is hung where the machine can see it.
      await assertHierarchy(started.project);
    });

    // THE STORY THAT ARRIVED CARRYING ITS TASKS, AND WHOSE GATES THEN FAIL — decision 82, and a project
    // halt until it. It skipped its break-down (decision 50), so it has no work run; the gates run BEFORE
    // any dispatch, so a failure leaves no review run either. There was nothing on the card to write the
    // verdict onto, `exitFail` named the column the story already stood in, and nothing was dispatched — so
    // every tick decided the same thing and re-ran the whole gate suite. Driven against this harness before
    // the fix: **57 executions of the gate command and 57 identical diary lines inside one 60-tick budget**,
    // one run in the entire project, and `MAX_IDLE_TICKS` waiting at 240 to end it with a reason that
    // described none of that.
    //
    // THE HAND-PLACED SHAPE IS THE POINT and is what an imported board produces: a story carrying tasks
    // nobody's break-down made. Every other trace in this file reaches its stories through a break-down,
    // which is exactly why none of them could see this.
    it('blocks a story that arrived with its tasks and cannot pass its gates', async () => {
      const started = await start({ gates: `echo ran >> ${GATE_LOG}; exit 1` });
      // THE TASK ARRIVES DONE, which is what keeps this shape reachable at all since the work moved up to
      // the story (decision 83). A story carrying an OUTSTANDING task now gets an implement run of its own
      // first, and that run is a record the verdict can land on — so the hole decision 82 is about is the
      // board where every task under the story is already settled: an import, or a person who finished the
      // work by hand. The skip, no work run, and the gates running before any dispatch.
      const task = await place(started.project, 'engineering', 'done', 'A task');
      const story = await place(started.project, 'product', 'backlog', 'A story', [task]);
      await place(started.project, 'features', 'backlog', 'A feature', [story]);

      const ended = await drive(started);

      // The project FINISHES, naming what it left behind, which is the rule the fix budget and `capReached`
      // already embody everywhere else: a halt is never the answer to one bad card.
      expect(ended.reason).toBe('complete');
      expect(ended.detail).toContain('P-001');
      expect(await columnOf(started.project, 'P-001')).toBe('blocked');
      expect(await columnOf(started.project, 'F-001')).toBe('done');
      // THE FIX BUDGET IS SPENT, which is what the first send-back buys: three attempts, the same three any
      // other refused story gets, and then the card is left for a person.
      const fixes = (await runs(started.project)).filter((r) => r.skill === 'fix');
      expect(fixes).toHaveLength(3);
      // AND THE FIRST ONE IS THE ONE WITH NO RUN TO NAME. The gates refused a story with nothing on it, so
      // that fix is dispatched on the loop's own evidence; the three after it are handed the run carrying
      // the verdict, because by then there is one.
      expect(fixes.filter((r) => r.previous === undefined)).toHaveLength(1);
      // FOUR GATE RUNS, not fifty-seven: the judgement, then one after each fix.
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(4);
      // THE WHOLE TRACE past the project's own creation line, not a suffix of it. A slice starting at the
      // first dispatch cannot see the two SKIPS in front of it, which are half of what this shape is — both
      // cards arrived carrying their children, so each is stamped in with no run behind it.
      expect((await trace(started.project)).slice(1)).toEqual([
        'move features/F-001 in-progress',
        'move product/P-001 in-progress',
        // No implement run: the one task under this story arrived settled, so there is no outstanding work
        // and the story goes straight to its judgement carrying no record of any kind.
        // The gate refuses a story with nothing on it to record the refusal against, and the fix goes anyway.
        'gates P-001 fail',
        'ran P-001 fix',
        'gates P-001 fail',
        'ran P-001 fix',
        'gates P-001 fail',
        'ran P-001 fix',
        'gates P-001 fail',
        // Four judgements and three fixes: the budget, spent, and then the card left for a person.
        'move product/P-001 blocked',
        'smoke F-001 pass',
        'move features/F-001 done',
        'ran F-001 checkup-feature',
        'stopped complete',
      ]);
      await assertHierarchy(started.project);
    });

    // THE NEIGHBOUR, pinned because nothing did: the same shape whose gates PASS first time. It must reach
    // its judgement, close on the verdict written onto the review's own record (decision 81), and close its
    // feature — one gate run and one review, with no fix anywhere.
    it('closes a story that arrived with its tasks and passes its gates first time', async () => {
      const started = await start();
      // OUTSTANDING, unlike its neighbour above: this is the imported board whose work has NOT been done,
      // so the story's own implement run is dispatched for it — and that run is then the record the
      // judgement lands on, which is the ordinary path rather than decision 81's.
      const task = await place(started.project, 'engineering', 'backlog', 'A task');
      const story = await place(started.project, 'product', 'backlog', 'A story', [task]);
      await place(started.project, 'features', 'backlog', 'A feature', [story]);

      const ended = await drive(started);

      expect(ended.reason).toBe('complete');
      expect(ended.detail).toBeUndefined();
      expect((await trace(started.project)).slice(1)).toEqual([
        // Two skips, one after the other: neither card's break-down runs, and both are stamped in with no
        // run behind them (decision 50).
        'move features/F-001 in-progress',
        'move product/P-001 in-progress',
        'move engineering/E-001 in-progress',
        'move engineering/E-001 done',
        'ran P-001 implement-story',
        // One judgement, and the verdict lands on the implement run the story now has of its own.
        'move product/P-001 done',
        'review P-001 pass',
        'smoke F-001 pass',
        'move features/F-001 done',
        'ran F-001 checkup-feature',
        'stopped complete',
      ]);
      // Neither break-down ran — both cards arrived with their children — and nothing was fixed. Newest
      // first, which is the order `GET /api/runs` answers in.
      expect((await runs(started.project)).map((r) => `${r.card} ${r.skill}`)).toEqual([
        'F-001 checkup-feature',
        'P-001 review-story',
        'P-001 implement-story',
      ]);
      expect(await ranTimes(started.project.root, GATE_LOG)).toBe(1);
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
      // Seven ticks: bootstrap, the feature's break-down, the story's, E-001's implement, P-001's judgement,
      // the feature checkup that creates P-002, and P-002's own break-down. Stopped there because the seeded
      // checkup creates on EVERY run, so left to itself this project never closes — which is decision 47's
      // own bound and is asserted in test/tick.test.ts rather than paid for here.
      const ended = await drive(started, { ticks: 7 });
      expect(ended.reason).toBe('stopped');

      const traced = await trace(started.project);
      expect(traced.slice(traced.indexOf('review P-001 pass'))).toEqual([
        'review P-001 pass',
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

    // A STORY JUDGEMENT THAT CREATES, which nothing anywhere drove — and it is the one phase whose parent is
    // NOT the run's own card: it creates SIBLINGS on its own board, whose parent is the feature above. Nobody
    // had noticed the shim's own parent choice is wrong for it, because no test ever made it choose. The
    // authority is the story checkup's, kept when the judgement absorbed it (decision 80).
    //
    // The sibling joins L2's queue (decision 47) rather than reopening anything, so what proves the link is the
    // loop WALKING it: an orphan sibling is invisible to `derivePosition`, which finds a story only among the
    // current feature's children.
    it('walks a story a story judgement creates, hung off the feature and not off its sibling', async () => {
      const started = await start({
        skills: {
          ...HAPPY,
          'derive-features': creates(mode, 'features:1:product:1:engineering:1'),
          // It finds a criterion that was missed and cards it as a sibling story with a task of its own. The
          // shim answers a verdict WITH it, off the judging contract in the prompt: a judgement that creates
          // must still answer, or it passes nothing.
          'review-story': creates(mode, 'product:1:engineering:1'),
        },
      });
      const ended = await drive(started, { ticks: 7 });
      expect(ended.reason).toBe('stopped');

      const traced = await trace(started.project);
      expect(traced.slice(traced.indexOf('review P-001 pass'))).toEqual([
        'review P-001 pass',
        // P-001 closes and the sibling joins the queue: L2 walks it, which it can only do if the feature owns it.
        'move product/P-002 todo',
        'move product/P-002 in-progress',
        'ran P-002 break-down',
        // And L3 under that, on the task the sibling's own break-down produced — the whole vertical below a card
        // no phase would ever have reached if it were hung off its sibling. The run is the STORY's and the
        // task is claimed and settled by it (decision 83).
        'move engineering/E-002 in-progress',
        'move engineering/E-002 done',
        'ran P-002 implement-story',
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
        'review P-001 pass',
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

// A STORY BIGGER THAN ONE RUN'S CEILING, THROUGH THE WHOLE MACHINE (decision 84). The tick-level test in
// test/tick.test.ts pins the arithmetic; this pins that the arithmetic is reachable — four real dispatches,
// four real groups of tasks claimed and settled over HTTP, and a judgement at the end of them.
//
// ONE MODE, deliberately. `MODES` exists to drive the API's two create routes, and nothing here varies by
// which of them made the cards: what is under test is how many runs the story costs and what happens after
// the last one.
//
// SIXTEEN IS THE SMALLEST BOARD THAT SHOWS IT: `TASKS_PER_RUN × attemptCap` is fifteen, and fifteen closed
// perfectly well while sixteen was blocked FOR SUCCEEDING — three successful groups, the sixteenth task
// stranded in `backlog`, `story-review` never dispatched, so the gates never ran over any of the work.
describe('a story with more tasks than one cap could pay for', { timeout: 60_000 }, () => {
  it('delivers it in groups and closes it, rather than blocking the story that succeeded', async () => {
    const started = await start({
      skills: {
        ...HAPPY,
        'derive-features': creates('create', 'features:1:product:1:engineering:16'),
        'break-down': HARNESS_CHAIN('create'),
      },
    });
    const ended = await drive(started);
    expect(ended.reason).toBe('complete');

    // FOUR RUNS FOR SIXTEEN TASKS — three full groups and the remainder — and ONE judgement after them.
    const all = await runs(started.project);
    expect(all.filter((r) => r.card === 'P-001' && r.skill === 'implement-story')).toHaveLength(4);
    expect(all.filter((r) => r.card === 'P-001' && r.skill === 'review-story')).toHaveLength(1);

    // THE CEILING HELD ON THE WAY IN: the first run was handed five tasks and not sixteen, counted from the
    // claims the loop wrote before it dispatched.
    const traced = await trace(started.project);
    const first = traced.indexOf('ran P-001 implement-story');
    expect(first).toBeGreaterThan(-1);
    expect(
      traced.slice(0, first).filter((line) => /^move engineering\/\S+ in-progress$/.test(line)),
    ).toHaveLength(5);

    // AND EVERY TASK LANDED. The story is closed by its judgement, and nothing is left behind it.
    const cards = (await board(started.project)).filter(isLive);
    const story = cards.find((c) => c.id === 'P-001') as Card;
    const tasks = childrenOf(story, cards);
    expect(tasks).toHaveLength(16);
    expect(tasks.filter((t) => t.columnSlug !== 'done')).toEqual([]);
    expect(story.columnSlug).toBe('done');
    await assertHierarchy(started.project);
  });
});
