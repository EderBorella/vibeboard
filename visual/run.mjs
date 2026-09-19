#!/usr/bin/env node
// The only supported way to run the browser harness: `npm run visual`.
//
// It exists because three things have to be true at once and none of them can be expressed in
// playwright.config.ts alone.
//
// 1. ONE TEMP ROOT PER RUN, REMOVED HERE. The vitest suite once leaked one directory per test and
//    filled the filesystem's inode table (440,653 trees, 9.43M of 9.83M inodes) while 61G of block
//    space sat free — every file-creating call then had a chance of failing, so one arbitrary test
//    died per run and looked like flakiness. The config module is re-evaluated in every worker
//    process, so an `mkdtemp` there would make one root per worker and nothing would own the
//    removal. It is made once, here, in the process that outlives the run. Never a swept shared
//    prefix: a run beside this one has live directories under the same prefix.
// 2. THE ARTEFACT UNDER TEST MUST MATCH THE TREE. The webServer boots `dist/server/main.js` and the
//    UI it serves is `dist/web`, so a stale build means the harness measures the previous commit's
//    CSS — which would make a planted defect pass and the gate worthless.
// 3. THE FIXTURE PROJECT HAS TO EXIST BEFORE THE SERVER STARTS, because the server reopens
//    `lastProject` at boot and the board only renders with a project open.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 4610 is the owner's own board. A harness that bound it would take the port from a live server, so
// the default here is a different one and the value travels to the server and to the tests together.
const PORT = process.env.VB_VISUAL_PORT ?? '4699';

const root = mkdtempSync(join(tmpdir(), 'vibeboard-visual-'));
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  rmSync(root, { recursive: true, force: true });
  // Stated, not assumed: a teardown that silently failed is how the inode incident started.
  if (existsSync(root)) console.error(`  visual: FAILED to remove ${root}`);
  else console.log(`  visual: removed ${root}`);
}

function die(message) {
  console.error(`  visual: ${message}`);
  cleanup();
  process.exit(1);
}

// Both of these, or a Ctrl-C during a 20-second run leaves the tree behind — which is exactly the
// per-run leak this file is built to prevent.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanup();
    process.exit(130);
  });
}

if (process.env.VB_VISUAL_SKIP_BUILD !== '1') {
  const built = spawnSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'inherit' });
  if (built.status !== 0) die('the build failed, so there is nothing current to test');
}

// Imported from `dist/` rather than reimplemented: a fixture built by a second copy of the scaffolder
// would drift, and then the harness would be testing a project shape the product cannot produce.
const { scaffoldProject } = await import(pathToFileURL(join(REPO, 'dist/store/project/scaffold.js')));

// FIXTURE STATE, BECAUSE AN EMPTY SURFACE EXAMINES ALMOST NOTHING AND A CHECK THAT EXAMINES NOTHING
// PASSES.
//
// The scaffolder writes three sample cards, which is what makes the board worth measuring — and it
// writes no runs, no suggestions and nothing archived, so before Phase 6 the Execution view was three
// empty panels, the Project Log's right-hand column said "Nothing has been filed in this project yet",
// and the archive drawer could not be opened at all because its button only exists at a non-zero count.
// Recording those as green would have been the coverage-shaped lie this phase exists to avoid.
//
// Written through the PRODUCT'S OWN STORES, imported from `dist/`, for the reason `scaffoldProject` is:
// a fixture built by a second copy of the writer drifts, and then the harness measures a project shape
// the product cannot produce. Everything lands under the per-run temp root and goes with it.
async function furnish(projectRoot) {
  const { readConfig } = await import(pathToFileURL(join(REPO, 'dist/store/project/config.js')));
  const { readBoard } = await import(pathToFileURL(join(REPO, 'dist/store/cards/board.js')));
  const { archiveCard, createCard } = await import(
    pathToFileURL(join(REPO, 'dist/store/cards/mutations.js'))
  );
  const { writeRun } = await import(pathToFileURL(join(REPO, 'dist/store/run-store.js')));
  const { appendEntry } = await import(pathToFileURL(join(REPO, 'dist/store/diary-store.js')));
  const { writeSuggestion } = await import(pathToFileURL(join(REPO, 'dist/store/suggestion-store.js')));

  const config = await readConfig(projectRoot);
  const product = (await readBoard(projectRoot, 'product', config))[0];
  const engineering = (await readBoard(projectRoot, 'engineering', config))[0];
  if (!product || !engineering) die('the scaffolder wrote no sample cards, so there is nothing to furnish');

  // Two runs on the product card and one on the engineering card, so the Execution view's "Done" and
  // "Requires attention" columns both have rows and the open card has a report list of its own.
  //
  // NONE OF THEM IS IN FLIGHT, deliberately. The server rewrites a `running` record to `interrupted`
  // when it opens the project — a child process cannot survive the server that spawned it — so a
  // `queued` or `running` fixture would be measured as something other than what was written. The "In
  // progress" column is therefore empty and says so, which is a real state of that surface rather than
  // an empty surface: the two columns beside it carry the rows.
  const dispatched = { backend: 'claude', model: 'sonnet', effort: 'default', mode: 'bypassPermissions' };
  const runs = [
    {
      ...dispatched,
      run: '20260101-090000-1a2b',
      board: 'product',
      card: product.id,
      skill: 'implement',
      status: 'success',
      started: '2026-01-01T09:00:00.000Z',
      finished: '2026-01-01T09:04:09.000Z',
      outcome: 'success',
      summary: 'Wrote the first pass and left two notes about the column names.',
      usage: { costUsd: 0.4231, durationMs: 249_000, turns: 14, contextTokens: 48_200, outputTokens: 3100 },
      suggestions: 2,
    },
    {
      ...dispatched,
      run: '20260101-101500-3c4d',
      board: 'product',
      card: product.id,
      skill: 'review',
      status: 'attention',
      started: '2026-01-01T10:15:00.000Z',
      finished: '2026-01-01T10:20:48.000Z',
      outcome: 'attention',
      summary: 'Needs a decision before it can go further.',
      // A report with options renders the option list, which is a surface of its own on the card pane.
      options: ['Rename the column to match', 'Leave it and note the mismatch'],
      usage: { costUsd: 0.1177, durationMs: 348_000, turns: 9, contextTokens: 31_400 },
    },
    {
      ...dispatched,
      run: '20260101-114500-5e6f',
      board: 'engineering',
      card: engineering.id,
      skill: 'implement',
      status: 'failed',
      started: '2026-01-01T11:45:00.000Z',
      finished: '2026-01-01T11:45:00.449Z',
      note: 'The agent stopped without writing a report.',
      usage: { costUsd: 0.0119, durationMs: 449 },
    },
  ];
  for (const record of runs) await writeRun(projectRoot, record);

  // ONE ARCHIVED CARD, so the drawer's button exists at all: `.board-archive` is rendered only at a
  // non-zero count, so with nothing archived the surface is not merely empty — it is unreachable.
  const spare = await createCard(
    projectRoot,
    config,
    {
      board: 'product',
      // The slug the scaffolded card is already in, rather than a second derivation of it: the
      // config's labels are slugified by `boardColumnSlugs` and a hand-rolled copy of that rule is
      // exactly the drift this file avoids by importing the product's own writers.
      columnSlug: product.columnSlug,
      title: 'A card that was archived',
      description: 'Here so the archive drawer has something in it.',
    },
    '2026-01-01',
  );
  if (typeof spare === 'string') die(`the archive fixture card was refused: ${spare}`);
  await archiveCard(projectRoot, spare, '2026-01-02T08:30:00.000Z');

  // A COLUMN THAT OVERFLOWS, AND A TITLE THAT DOES NOT FIT — two conditions this harness could not
  // reach and the owner hit within a minute of using his own board.
  //
  // A `.column-body` shows three fixed-height tiles and then scrolls, so a fixture with ONE card can
  // never say anything about the scrollbar: the check would examine a column with nothing to scroll,
  // report clean, and be exactly the vacuous pass this harness exists to prevent. Four cards is the
  // smallest number that produces the state.
  //
  // AND ONE OF THE FOUR HAS A TITLE FAR TOO LONG FOR THE TILE, for the same reason one card was too
  // thin: a title that fits cannot distinguish "clamped to one line and ellipsised" from "clamped to
  // two lines and cut through the middle of the second", which is what the box actually drew. Both
  // outcomes look identical on `Sample product card`.
  const crowd = [
    'A card whose title is far longer than one line of a fixed-height tile can hold, and which therefore has to end in an ellipsis rather than be sliced through the middle of its second line',
    'The third card in this column',
    'The fourth card in this column',
  ];
  for (const [i, title] of crowd.entries()) {
    const extra = await createCard(
      projectRoot,
      config,
      { board: 'product', columnSlug: product.columnSlug, title, description: 'Here so the column scrolls.' },
      '2026-01-01',
    );
    if (typeof extra === 'string') die(`crowd card ${i + 1} was refused: ${extra}`);
  }

  // The scaffolder writes one diary line. Two more, of two different kinds, so the list renders rows
  // with a kind, an outcome and a card reference rather than one bare lifecycle entry.
  await appendEntry(projectRoot, {
    at: '2026-01-01T09:04:09.000Z',
    kind: 'run',
    text: 'implement finished on the sample product card.',
    iteration: 1,
    card: product.id,
    outcome: 'success',
  });
  await appendEntry(projectRoot, {
    at: '2026-01-01T11:45:01.000Z',
    kind: 'note',
    text: 'Left a note by hand so the log has a line somebody wrote as well as one a machine did.',
  });

  // What agents filed: the right-hand column of the Project Log, and the dock's Suggestions badge.
  const filed = [
    {
      id: '20260101-090409-aaaa',
      state: 'active',
      created: '2026-01-01T09:04:09.000Z',
      title: 'The product and engineering columns disagree',
      run: runs[0].run,
      card: product.id,
      board: 'product',
      body: 'Noticed while implementing. Not acted on, because renaming a column is a decision.',
    },
    {
      id: '20260101-092000-bbbb',
      // `dismissed`, not `rejected`: SUGGESTION_STATES is active|actioned|dismissed, and the store
      // normalised the wrong value silently — so the fixture claimed to render a second state and
      // rendered the first one twice.
      state: 'dismissed',
      created: '2026-01-01T09:20:00.000Z',
      title: 'Add a fourth board',
      run: runs[0].run,
      card: product.id,
      board: 'product',
      reason: 'Three boards is the design; a fourth would need its own place in the hierarchy.',
      body: 'Filed so it is not raised again.',
    },
  ];
  for (const s of filed) await writeSuggestion(projectRoot, s);

  // A CHAT ON DISK, so the copilot dock has a transcript to measure rather than an empty state.
  //
  // Written as the file rather than through `ChatStore`, which persists privately and exports no writer.
  // That is the same thing this harness already does for `state.json`: the on-disk format is frozen, so a
  // fixture written against it is as safe as one written through an API, and it needs no running server.
  //
  // ONE OF EVERY TRANSCRIPT KIND. `user`, `assistant`, `tool` and `error` render as four different bubbles
  // with four different inks, and a fixture holding only the first two would measure half the surface and
  // report a floor as if it were whole. The error one especially: it is the only red thing in the dock and
  // it was rendering a raw provider payload until 2026-08-31.
  const chat = {
    id: '11111111-2222-4333-8444-555555555555',
    title: 'What does the board look like?',
    backend: 'claude-code',
    model: 'sonnet',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:02:00.000Z',
    messageCount: 4,
    items: [
      { kind: 'user', text: 'What does the board look like, and what is blocked?' },
      {
        kind: 'assistant',
        text: 'Three boards. One product card and one engineering card, both with runs against them. Nothing is blocked, and there is one open suggestion about the run report renderer.',
      },
      { kind: 'tool', text: 'GET /api/state — 200, 3 boards', toolName: 'board' },
      {
        kind: 'error',
        text: 'The provider is rate-limited. Trying again in a moment usually works.',
      },
    ],
    stats: { costUsd: 0.0142, turns: 1, lastDurationMs: 4200, contextTokens: 9364 },
  };
  seedChat(projectRoot, chat);
}

// One writer for both transcripts on disk, because there are two projects that need one and a second
// copy of the path and the serialisation is how they come to disagree. See the block above for why
// this is written as the file rather than through `ChatStore`.
function seedChat(projectRoot, chat) {
  const chatDir = join(projectRoot, '.vibeboard', 'chat');
  mkdirSync(chatDir, { recursive: true });
  writeFileSync(join(chatDir, `${chat.id}.json`), `${JSON.stringify(chat, null, 2)}\n`, 'utf8');
}

const projects = join(root, 'projects');
const project = join(projects, 'harness');
mkdirSync(project, { recursive: true });
// Greenfield, because it writes the sample cards: a board with no cards renders almost no elements,
// and a check that examines nothing passes.
await scaffoldProject(project, { name: 'Harness', mode: 'greenfield', today: '2026-01-01' });
await furnish(project);

// A SECOND PROJECT, HALF SET UP, AND IT HAS TO BE A SECOND ONE. The wizard's later steps have no URL
// and no door — they are reached by opening a project whose `wizard.yaml` is still on disk, which
// resumes setup at the step the file names — so the only way to render one is a project that is
// mid-setup. Putting that file on the board-proof project instead would replace the board with the
// wizard for every other check in the harness: `openBoard` proves the board partly by no setup screen
// covering it.
//
// THERE ARE NO AGENTS HERE. `VIBEBOARD_DOCKER_BIN` is `/bin/false`, so the stack step's own run can
// never answer — and that step dispatches one unless the file already carries a proposal. With
// `suggested.stack` present it renders the proposal screen and touches the network for nothing; without
// it, the screen is a spinner over `Choosing a stack that fits…` and stays there. The key is the whole
// fixture.
//
// Written through the product's own writer for the reason `scaffoldProject` is imported rather than
// reimplemented: a second copy of the serialiser drifts, and then the harness measures a file shape the
// product cannot produce. No `resumes` for the same reason — the copilot writes those at the docs step,
// which is after this one, so a stack-step file carrying them is a state that never exists.
const { writeWizardState } = await import(pathToFileURL(join(REPO, 'dist/store/project/wizard.js')));
const midSetup = join(projects, 'setup');
mkdirSync(midSetup, { recursive: true });
await scaffoldProject(midSetup, { name: 'Setup in progress', mode: 'greenfield', today: '2026-01-01' });
await writeWizardState(midSetup, {
  mode: 'greenfield',
  step: 'stack',
  answers: {
    what: 'A place to keep track of what the allotment needs each week.',
    who: 'The four of us who share the plot, mostly on our phones.',
    done: "Everyone can see this week's jobs without having to ask anybody.",
  },
  suggested: {
    stack:
      'A small web app written in TypeScript, with React for the screens and Vite to build them. Vitest for the tests. Nothing that needs a server of its own to begin with.',
    packages: ['git', 'ripgrep'],
  },
});

// A THIRD PROJECT, AT THE STEP AFTER THAT ONE, AND IT IS A THIRD RATHER THAN THE SECOND MOVED ON.
// One `wizard.yaml` names one step, so a project can render exactly one of the wizard's screens — and
// the stack step's surface is already recorded against the second. Re-pointing that file would have
// traded one measured screen for another; a third project keeps both, and the recording pass is
// unchanged because it opens each surface by NAME from the picker.
//
// THE REVIEW RENDERS FROM THE FILE AND NOTHING ELSE, which is the whole reason it can be measured
// here: a documents step resumed with summaries already filed opens IN the review — no kick-off turn,
// no authorise confirm — so this surface needs no agent, and there are none (`VIBEBOARD_DOCKER_BIN`
// is `/bin/false`). The full six summaries and an agreed stack are what a resumed review has;
// anything less renders placeholder cards, which is a different screen.
//
// AND THE DOCUMENTS THEMSELVES, because `Read it all` on a card really opens the file: the five
// foundation documents through the product's own writer, at the paths the LISTING gives the browser,
// and the README at the project root, which is not a control file and is read through the explorer.
// Without them every card's full-text view would open on `Opening…` forever and the one affordance
// this screen has would be measured as a button that does nothing.
const { writeControlFile } = await import(pathToFileURL(join(REPO, 'dist/store/project/control-files.js')));
const { foundationRel } = await import(pathToFileURL(join(REPO, 'dist/core/layout.js')));
const review = join(projects, 'review');
mkdirSync(review, { recursive: true });
await scaffoldProject(review, { name: 'Drafts to read', mode: 'greenfield', today: '2026-01-01' });

// Short and honest, in the voice the step's own brief asks for — including the admitted gap, which is
// what `wizardFrame` tells the model to write rather than a plausible blank. CODE-QUALITY.md carries
// the `gates:` list and TESTING.md the `smoke:` command because those two are contracts the product
// reads, and a fixture document that omitted them would be a shape setup cannot produce.
const FOUNDATION = {
  'STACK.md': `# The stack

TypeScript throughout. React for the screens, Vite to build and serve them, Vitest for the tests.
Nothing runs on a server yet — the list lives in the browser.

**I couldn't work out:** whether this ever has to sync between two phones. Say so in a sentence and
this document changes.
`,
  'CODE-QUALITY.md': `---
gates:
  - name: types
    command: npm run typecheck
  - name: lint
    command: npm run lint
  - name: tests
    command: npm test
---

# Quality gates

Three commands, and all three pass before anything here is called done. They are the same three the
machine runs, so there is nothing to remember separately.
`,
  'TESTING.md': `---
smoke: npm run dev
---

# Testing

Unit tests sit beside the code they test. A smoke test here means one pass by hand: start the app,
add a meal, reload the page, and see that it is still there.
`,
  'UX.md': `# How it feels

One screen. Big targets, because this gets used on a phone with one hand while something is on the
hob. Adding a meal is the only thing the app ever asks for.
`,
  'DESIGN.md': `# How it looks

One accent colour, generous spacing, the system font, nothing decorative.

**I couldn't work out:** whether you want a dark mode. Tell me and it goes in.
`,
};
for (const [name, content] of Object.entries(FOUNDATION)) {
  const written = await writeControlFile(review, foundationRel(name), content);
  if (!written) die(`the review fixture could not write ${name} — is it still a foundation document?`);
}
writeFileSync(
  join(review, 'README.md'),
  `# Meals

A shared list of the meals we cook, so nobody has to plan dinner out of memory. Add what you made,
see what you ate last week, and pick something out of it.

It runs in the browser. \`npm install\`, then \`npm run dev\`; there is no server to stand up and no
account to make.

The documents that steer this project are in the foundation folder, and the setup assistant wrote
the first draft of all of them.
`,
  'utf8',
);

await writeWizardState(review, {
  mode: 'greenfield',
  step: 'docs',
  answers: {
    what: 'A shared list of the meals we cook, so nobody has to plan dinner out of memory.',
    who: 'The two of us at home, on a phone in the kitchen.',
    done: 'We can see what we ate last week and pick from it in under a minute.',
  },
  // AGREED, not suggested: the stack step is behind this one, so a review reached without it is a
  // state setup cannot reach — and it is the line `wizardFrame` puts in front of the model.
  stack:
    'A small web app in TypeScript, with React for the screens and Vite to build them. Vitest for the tests. The list lives in the browser to begin with.',
  // ALL SIX, because a résumé map with gaps renders placeholder cards and this surface is the review
  // as a person reaching it actually finds it. The order is the order they are written.
  resumes: {
    'README.md':
      'What this is and how to run it. It says the app is a shared list of meals for the people who cook them, and that everything runs on your own machine for now.',
    'STACK.md':
      'The tools this is built with: TypeScript, React, Vite and Vitest. It also says what is deliberately not here yet — no server, no database.',
    'CODE-QUALITY.md':
      'The three checks that must pass before anything is called done: the types, the linter and the tests. Each one is a command you can run yourself.',
    'TESTING.md':
      'How this is tested, and what a smoke test means here: start the app, add a meal, reload, and see it still there.',
    'UX.md':
      'How it should feel. One screen, big targets for a phone, and nothing that needs explaining. Adding a meal is the only thing it asks of you.',
    'DESIGN.md':
      'How it should look: one accent colour, generous spacing, the system font. I could not work out whether you want a dark mode, and the document says so.',
  },
});

// THE CONVERSATION THAT WROTE THEM, because the review is the summaries BESIDE it: the panel is the
// larger half of this surface and an empty transcript would measure its frame and call it a screen.
// Three kinds and not the dock's four — this turn succeeded, and an error bubble invented to raise a
// count would be a state this fixture is not in.
seedChat(review, {
  id: '22222222-3333-4444-8555-666666666666',
  title: "Please set up this project's documents from my answers.",
  backend: 'claude-code',
  model: 'sonnet',
  createdAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:06:00.000Z',
  messageCount: 3,
  items: [
    { kind: 'user', text: "Please set up this project's documents from my answers." },
    { kind: 'tool', text: 'PUT /api/control/foundation/DESIGN.md — 200', toolName: 'control' },
    {
      kind: 'assistant',
      text: 'All six are written, and each one has a short summary beside it. One thing I could not work out: whether you want a dark mode — it is written down as an open question rather than guessed at.',
    },
  ],
  stats: { costUsd: 0.0863, turns: 1, lastDurationMs: 361_000, contextTokens: 21_480 },
});

const stateFile = join(root, 'state.json');
writeFileSync(stateFile, `${JSON.stringify({ lastProject: project }, null, 2)}\n`, 'utf8');

const env = {
  ...process.env,
  VB_VISUAL_PORT: PORT,
  VB_VISUAL_ROOT: root,
  VB_VISUAL_PROJECT: project,
  VB_VISUAL_STATE_FILE: stateFile,
  // The server creates this file at boot. The tests read it at that moment and keep the value in
  // memory; nothing here ever writes a credential, and the file goes with the root.
  VB_VISUAL_TOKEN_FILE: join(root, 'creds', 'token'),
};

const playwright = join(REPO, 'node_modules', '.bin', 'playwright');
if (!existsSync(playwright)) die('node_modules/.bin/playwright is missing — run npm install');

const args = ['test', '--config', join(REPO, 'visual', 'playwright.config.ts'), ...process.argv.slice(2)];
const run = spawn(playwright, args, { cwd: REPO, stdio: 'inherit', env });
run.on('exit', (code, signal) => {
  cleanup();
  process.exit(signal ? 1 : (code ?? 1));
});
