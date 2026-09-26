import { relative } from 'node:path';
import type { BoardAround } from '../../../core/board-around.js';
import { ARCHIVE_SLUG, RESULTS_DIR } from '../../../core/layout.js';
import { type PhaseName, phase, phaseForRun } from '../../../core/phases.js';
import type { BoardName, Card } from '../../../core/types.js';
import type { Verification } from '../../../core/verify.js';
import { BOX_BROWSERS_PATH, BOX_PLAYWRIGHT_VERSION } from '../../boxes/image-tools.js';
import type { BoardColumns, PromptInputs } from './index.js';

// One section per thing the agent is told about, and every one of them a pure function of what it is
// handed. `buildRunPrompt` in index.ts decides WHICH of these appear and in what order; each function
// here answers only "what does this section say".
//
// The rule they all follow, and the reason several of them return nothing rather than an empty body: a
// heading over nothing is worse than no heading. An agent reads a promised section that is blank as a
// fact about the project rather than as an absence in the prompt.

export function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body}`;
}

// What a PROJECT run is told in place of a card, and it has to do two jobs. The first is to say plainly that
// there is no card, because the absence is otherwise indistinguishable from a prompt that lost one.
//
// The second is the awkward one: the skill file was written for a per-card dispatch and says so — "the column
// this card is in", "the card below". Left unaddressed, an agent reading that either hunts for a card it will
// not find or invents one to reason about. So the reading is fixed here, once, rather than by rewording every
// skill: the project is the subject, and any instruction phrased about "this card" is about the board as a
// whole.
export function projectSubject(): string {
  return [
    'There is no card. The board is empty, and creating its first cards is what this run is for — so nothing',
    'on the board is your subject and there is none to read, move or edit.',
    '',
    'The **README at the project root is the brief.** Read it, and derive the work from it.',
    '',
    'The skill above was written for a run that has a card, so it may say things like "the column this card is',
    'in" or "the card below". There is no such card: read those as being about the project\'s board as a whole,',
    'and do not invent a card to stand in for one.',
  ].join('\n');
}

function cardLine(card: Card): string {
  const where = `${card.board}/${card.columnSlug}`;
  return `- **${card.id}** (${where}) — ${card.title}${card.description ? `: ${card.description}` : ''}`;
}

// Where a card is allowed to live. This used to be absent, and the only column the prompt named was
// the source card's own — so a skill asking for cards "in the right column" was unanswerable and the
// agent guessed. Because column = folder, the guess did not fail: it CREATED
// `engineering/backlog/`, which no column mapped to, and four cards landed where readBoard does not
// look. The prohibition is therefore stated, not implied.
export function columnsSection(boardColumns: BoardColumns[]): string {
  const lines = boardColumns.map(
    ({ board, columns }) => `- **${board}**: ${columns.map((c) => `${c.name} (${c.slug})`).join(', ')}`,
  );
  return [
    'Every column this project has, by board — the name, then the folder slug you write in a path:',
    '',
    ...lines,
    '',
    'A card must go in one of the columns listed above, named by its slug. Do NOT create a new column',
    'folder: a column IS a folder, so a name that is not listed does not fail — it creates a folder the',
    `board never reads, and the card is invisible. \`${ARCHIVE_SLUG}/\` and \`${RESULTS_DIR}/\` sit beside the`,
    'columns on disk but are NOT columns; no card belongs in either.',
  ].join('\n');
}

// Linked cards: every one identified, and the *product* ones quoted in full. A product card carries
// the intent an engineering card usually omits, which is exactly what an agent needs and the least
// likely thing for it to think of reading.
// A STORY'S BODY IS QUOTED ONLY TO A TASK, because it is the task's intent. Linked from a feature the
// stories are its children rather than its reason, and a feature checkup was carrying every one of them in
// full — 24 KB on the board that was measured — to judge a list it already has (decision 90).
export function linkedSection(linked: Card[], projectRoot: string, from?: Card): string {
  const lines = linked.map((c) => `${cardLine(c)}\n  file: ${relative(projectRoot, c.filePath)}`);
  const intent = linked
    .filter((c) => from?.board === 'engineering' && c.board === 'product' && c.body.trim() !== '')
    .map((c) => `### ${c.id} — ${c.title}\n\n${c.body.trim()}`);
  return [lines.join('\n'), ...intent].join('\n\n');
}

// WHO GETS THE GATE DOCUMENT'S PROSE: every run but these. Its conventions are what the implement builds
// against and the review judges, and an agent sent to go and read them will sometimes not bother. These
// four neither write code nor judge it — they need the bar, which is the commands, and not the argument
// for it (decision 89). A phase is matched on skill and board, so a break-down dispatched by hand is one
// too; a run no phase claims keeps the document.
const GATE_LIST_ONLY: ReadonlySet<PhaseName> = new Set([
  'bootstrap',
  'feature-breakdown',
  'story-breakdown',
  'feature-checkup',
]);

// Named as binding rather than as background reading, and as read-only rather than as a request:
// the OS denies these paths to every agent, so an agent that tries to "fix" one gets a permission
// error it would otherwise read as a broken tool.

export function foundationSection(
  foundation: NonNullable<PromptInputs['foundation']>,
  phaseName?: PhaseName,
): string {
  const lines = [
    'These decisions are already made for this project. Follow them, do not re-open them, and do not',
    'edit these files — they are read-only to you at the operating-system level.',
    '',
    ...foundation.paths.map((p) => `- ${p}`),
  ];
  const listOnly = phaseName !== undefined && GATE_LIST_ONLY.has(phaseName);
  if (listOnly && foundation.gates && foundation.gates.length > 0) {
    lines.push(
      '',
      'The gates, run from the project root:',
      '',
      ...foundation.gates.map((g) => `- ${g.name}: \`${g.command}\``),
      '',
      'Why each exists, and what no gate can catch, is in CODE-QUALITY.md, listed above.',
    );
  } else if (foundation.codeQuality?.trim()) {
    lines.push(
      '',
      'The gates your work must pass, in full:',
      '',
      '```markdown',
      foundation.codeQuality.trim(),
      '```',
    );
  }
  return lines.join('\n');
}

// Where each card sits, as one line: the slice carries titles, never bodies, so it stays a list.
const place = (c: Card): string => `**${c.id}** (${c.board}/${c.columnSlug}) — ${c.title}`;

// THE BOARD AROUND THE CARD (decision 90), in the words of the question the skill asks: what is already
// under it, and what sits beside it. The pointer for anything else stays, with the answer's shape stated by
// the endpoint list, so a run that does need more is not left decoding it.
export function aroundSection(around: BoardAround): string {
  const under =
    around.children === undefined
      ? []
      : around.children.length === 0
        ? ['Under this card: nothing yet.', '']
        : ['Under this card:', ...around.children.map((c) => `- ${place(c)}`), ''];
  const beside = around.siblings.flatMap(({ card, children }) => [
    `- ${place(card)}`,
    ...children.map((c) => `  - ${place(c)}`),
  ]);
  return [
    'The board as it stood when this run was dispatched, so you do not need to fetch it to see what exists.',
    '',
    ...under,
    ...whereItSits(around, beside),
  ].join('\n');
}

// One answer per case, because an empty slice means different things: no other features, a story alone
// under its feature, or a story nobody linked to one.
function whereItSits(around: BoardAround, beside: string[]): string[] {
  if (around.of === 'feature')
    return beside.length > 0 ? ['The other features:', ...beside] : ['There are no other features.'];
  if (!around.parent) return ['It sits under no feature.'];
  const parent = place(around.parent);
  return beside.length > 0
    ? [`It sits under ${parent}. Beside it, under ${around.parent.id}:`, ...beside]
    : [`It sits under ${parent}, alone.`];
}

// WHAT IS UNDER THIS CARD, as the loop already knows it. Every line here is a fact the checkup would otherwise
// have had to fetch, and cannot: `GET /api/runs` is `service`-only and the diary has no read row at all
// (ruling 60). So it is told, and the prompt never suggests it go and look.
function checkupSection(checkup: NonNullable<PromptInputs['checkup']>): string {
  const children = checkup.children.map((c) => {
    const ended = c.outcome
      ? `, and its last run ended as \`${c.outcome}\``
      : ', and nothing has run on it yet';
    return `- **${c.id}** is in \`${c.column}\`${ended}${c.blocked ? ' — it is BLOCKED' : ''}.`;
  });
  return [
    ...(children.length > 0 ? children : ['There is nothing under this card.']),
    '',
    // Named as a list rather than left to be derived from the columns: which slug means blocked is a config
    // fact this run has no way to read, and the report is expected to name them.
    checkup.blocked.length > 0
      ? `Blocked and waiting for a person: ${checkup.blocked.join(', ')}. A blocked card has already had every attempt it is allowed — do not create work to get past one.`
      : 'Nothing under this card is blocked.',
    '',
    ...(checkup.suggestions.length > 0
      ? [
          'Already filed as suggestions, so do not file them again:',
          '',
          ...checkup.suggestions.map((s) => `- ${s.id}: ${s.title}`),
        ]
      : ['There are no open suggestions on this project.']),
    // THE GATES ARE NOT A FEATURE CHECKUP'S TO RUN (decision 90). Every checkup measured ran them, six times a
    // run on average. It says the loop runs them rather than that they passed: a story can also close through
    // one gate (`story-satisfied`), with none in the setup subtree, or by a person's move.
    ...(checkup.feature
      ? [
          '',
          'Running the gates is auto-pilot’s job, not this checkup’s: it runs the project’s gates before every',
          'story’s review, and again on anything you create. Do not run them here — what this checkup adds is',
          'what no gate can measure.',
        ]
      : []),
  ].join('\n');
}

// EXPRESS MODE, and it is the ONLY thing `autopilot.mode` changes. The phase table, the walker, every
// bound and every refusal are identical under both lifecycles — what differs is how coarse the cards the
// creating phases are asked for are, which is a fact about the instruction and not about the machine.
//
// MEASURED BEFORE IT WAS BUILT, on a throwaway project with the same README, the same foundation documents
// and the same backend, with these three paragraphs pasted into the project's own skill files by hand:
// 24 runs against 80, $14.06 against $41.07, 37 minutes of agent time against 109, 12 cards against 39 —
// and a product that passes its smoke test either way, checked by hand rather than by a gate. The saving
// is almost entirely break-downs and the implement/review/checkup cycle each extra card brings with it.
//
// ONE SECTION RATHER THAN A SECOND SET OF SKILL FILES. Skills are ordinary per-project files a person owns
// and edits; swapping them on a mode change would either overwrite somebody's edits or leave a project
// switched to express still running the standard prompts. A section the server adds is neither.
//
// The three sizes are stated as NOT the run's to choose, deliberately. A break-down told only that "this
// project prefers larger cards" splits anyway when a card looks awkward, and each split it makes is a full
// implement, gates and review cycle — the cost this mode exists to avoid.
const EXPRESS: Partial<Record<PhaseName, string[]>> = {
  bootstrap: [
    '**One feature card for the whole product**, not one per capability. Its body LISTS every capability the',
    'README requires, in the order they must be built, one bullet each — earlier bullets must not depend on',
    'later ones. That list is the plan: the break-down of this card turns each bullet into a story, so a',
    'capability missing from it is a capability this project will not build.',
  ],
  'feature-breakdown': [
    "**One story per bullet in this card's body.** Not one per acceptance criterion — one per bullet. If the",
    'card carries no list, create the smallest set of stories that covers what it asks for, and say in your',
    'report how many and why.',
  ],
  'story-breakdown': [
    '**Exactly one task**, carrying the whole of this story end to end: the code, its tests, and whatever the',
    'story needs to be demonstrably done. A story that seems to need two tasks needs one task with two',
    'acceptance criteria — say so in the card body and keep it as one.',
  ],
};

// `undefined` for a phase express says nothing about, and for every run on a standard project — the rule
// this file already follows, that a heading over nothing is worse than no heading.
export function expressSection(skill: string, board: BoardName | undefined): string | undefined {
  const name = phaseForRun(skill, board)?.name;
  const lines = name ? EXPRESS[name] : undefined;
  if (!lines) return undefined;
  return [
    'This project runs the **express** lifecycle: granularity is deliberately traded for cost, and the sizes',
    'below are fixed rather than yours to choose. A card split "to be safe" costs a full implement, gates and',
    'review cycle that nobody asked for.',
    '',
    ...lines,
  ].join('\n');
}

// THE BOARD THE DEMAND BELOW NAMES, read from the phase table rather than typed out — and it is a fix, not a
// tidy-up. This section used to say "on the engineering board" while `feature-checkup` declares
// `creates: 'product'`, and `wrongBoardForRun` (server/boards/cards-routes.ts) enforces that field: the server
// refused every card the instruction asked for, so the run created nothing, `boardGrew` was false, decision 69
// held the feature open and the round repeated to the attempt cap. The whole mechanism was dead on the only
// branch that reaches it.
//
// Widening `creates` to engineering would not have fixed it. `derivePosition` walks feature -> story -> task,
// so an engineering card parented to a feature is an orphan no phase picks up — see the header of
// HOLDS_OPEN_HAVING_CREATED in service/act/outcomes.ts. Filed on `product`, each card is a story the machine
// already knows how to break into tasks, which is what the closing sentence promises.
//
// Ruling 52's precedent: a fact the table already carries is read from it, never copied. Two copies is two
// places to drift, and this is what drifting cost.
const CHECKUP_CREATES = phase('feature-checkup').creates;

// WHAT EVERY BOX IS, whatever it carries. These lines were the copilot's alone until Claude card runs
// stopped being handed the copilot's system prompt (agent-turn.ts), and a run meets each of them as an
// error it would otherwise read as a broken tool.
const BOX_LIMITS = [
  'Everything under `.vibeboard/` that decides anything is read-only in here: a write there fails, and',
  'that is not a broken tool. The internet is reachable and the machine’s own network is not: a refused',
  'connection to a local address is that rule, not an outage.',
].join('\n');

// WHAT THE BOX ALREADY HAS. An agent is told about the board, the cards, the columns and its own
// credential, and until now nothing at all about the machine it is standing in — so it re-fetched a
// browser the image ships. See `server/boxes/image-tools.ts` for the measurement and why the version
// belongs in the sentence.
//
// AND WHICH BOX IT IS, since the kinds split the image. The browser is what the WEB LAYER adds, so a
// `game` or `research` project's box is created from the shared base and has none — telling one of
// those agents the download is already done is the same wrong belief the section exists to remove,
// arrived at from the other side. The caller decides, from the image the kind selects. decision 75.
export function boxSection(browser: boolean): string {
  return `${browserLines(browser)}\n\n${BOX_LIMITS}`;
}

function browserLines(browser: boolean): string {
  if (!browser) {
    return [
      'No browser is installed in this container — this project’s kind does not carry the web layer, so',
      'nothing here can open a page. If a check needs a page opened, say so in the report rather than',
      'downloading a browser: that is minutes of this run’s budget, and it dies with the container.',
    ].join('\n');
  }
  return [
    `A **Chromium for Playwright ${BOX_PLAYWRIGHT_VERSION}** is already installed in this container, at`,
    `\`${BOX_BROWSERS_PATH}\`, and \`PLAYWRIGHT_BROWSERS_PATH\` points at it. You do not need to download one,`,
    'and a run that does spends minutes of its own budget fetching what it was given.',
    '',
    `Playwright keeps browsers per release, so that copy answers for ${BOX_PLAYWRIGHT_VERSION}. If this project`,
    'depends on a different Playwright, it will correctly find nothing it can use and fetch its own — that is',
    'the one case where installing is right.',
  ].join('\n');
}

// RULING 55 SET THE PASSING HALF; DECISION 69 CHANGED THE FAILING ONE. A passing smoke is still evidence and
// the model still decides what it means. A FAILING one is no longer a judgement call, because the judgement was
// the defect: asked what a failed command meant, models read the output and reasoned their way to
// "environmental" — twice in one afternoon, once rightly and once by quoting a document that was already
// out of date.
//
// So the failing branch stops inviting an opinion and asks for work instead. It does not need to threaten: the
// close is refused by the machine in service/act/outcomes.ts whatever this run concludes, and saying so here is
// what stops the run wasting its turn arguing that the feature is fine.
function smokeSection(smoke: Verification, gates: boolean): string {
  if (smoke.passed) {
    return [
      'Auto-pilot ran this in its own process before dispatching you, and it is evidence rather than a verdict:',
      'what it means is yours to decide.',
      '',
      'The smoke command passed.',
    ].join('\n');
  }
  // NOT THIS FEATURE'S PROBLEM, and saying so is the difference between a checkup that closes and one that
  // stalls. The smoke command proves the ASSEMBLED product runs; while other features are still to come it
  // will fail on work this card does not own, and a checkup told "you are not finished" over that spends its
  // one round of creation looking for something — anything — to justify staying open. Watched happening three
  // times in a row on a greenfield project, each time on a feature whose own work was complete.
  if (!gates) {
    return [
      'Auto-pilot ran the smoke command in its own process before dispatching you, and **it did not pass**.',
      '',
      ...(smoke.reason ? [smoke.reason, ''] : []),
      ...(smoke.command ? [`The command: \`${smoke.command}\``, ''] : []),
      ...(smoke.output ? ['What it printed:', '', '```', smoke.output.trim(), '```', ''] : []),
      '**This is not, on its own, a reason to keep this feature open.** The smoke command exercises the whole',
      'assembled product, and features are still outstanding — so it is expected to fail until the last of them',
      'lands, and it will be run again then. It is here as evidence, in case it shows something that IS yours.',
      '',
      'Judge this feature on its own work. If what the smoke command printed reveals a gap inside this feature,',
      'that is worth a card; if it is waiting on work another feature owns, say so in a line and close.',
    ].join('\n');
  }
  return [
    'Auto-pilot ran the smoke command in its own process before dispatching you. **It did not pass.**',
    '',
    ...(smoke.reason ? [smoke.reason, ''] : []),
    ...(smoke.command ? [`The command: \`${smoke.command}\``, ''] : []),
    ...(smoke.output ? ['What it printed:', '', '```', smoke.output.trim(), '```', ''] : []),
    'Every other feature on this board is finished, so there is nothing left to blame: the product is as',
    'assembled as it is going to get, and it does not run.',
    '',
    'The smoke command is how this project says its product can be run. It did not run, so **this feature is',
    'not finished** — and that is not a conclusion for you to reach or to argue with: the feature stays open',
    'whatever you decide, so an answer explaining why it is really fine costs you the turn and changes nothing.',
    '',
    'What is yours to decide is WHAT IS WRONG. Read the output above and **create one card for each distinct',
    `failure**, on the ${CHECKUP_CREATES} board, each naming what was expected and what happened. Quote the`,
    'real strings the command printed rather than describing them — a card written from the failure reproduces',
    'it, a card written from a guess sends the next run somewhere else.',
    '',
    'Auto-pilot takes it from there: this feature stays open, each card you file is broken down into the work',
    'that fixes it, and the command is run again when that work is done.',
    '',
    'If the failure is genuinely not the product — the command itself is wrong, or something it needs is',
    'missing from this container — say so plainly and say what you ran to establish it. "It looks',
    'environmental" without a command and its output is the answer this instruction exists to stop.',
  ].join('\n');
}

// TWO SECTIONS, and separate because the smoke result is the FEATURE checkup's alone: a heading over nothing is
// worse than no heading, which is the rule this file already follows. Returned as a list rather than pushed by
// the caller so `buildRunPrompt` stays a flat sequence — a nested conditional inside it costs far more
// complexity than the length it saves, and flattening beats a suppression.
export function checkupSections(checkup: PromptInputs['checkup']): string[] {
  if (!checkup) return [];
  return [
    section('What is under this card', checkupSection(checkup)),
    ...(checkup.smoke
      ? [section('The smoke command', smokeSection(checkup.smoke, checkup.smokeGates === true))]
      : []),
    ...(checkup.feature ? [section('The question this checkup exists for', usableSection())] : []),
  ];
}

// RULING 66'S SECOND FIX, and the one the incident actually needed.
//
// A project ran to `complete`: 67 iterations, 21 commits, four features closed, sixteen tasks delivered.
// Every gate was green. The tool it built had no main and printed nothing — three tasks and a whole feature
// claiming a working CLI, each having passed `npm test` and a review.
//
// EVERY LAYER WAS ASKING THE SAME QUESTION, which is why none of them caught it. The gate is the project's
// own test command; the tests were written by the agents that wrote the code and import its exported
// functions; nothing anywhere executes the thing; and the smoke command was ALSO `npm test`, so the evidence
// ruling 55 hands this checkup added nothing the gate had not already said. The first fix closed that last
// one — a smoke command may no longer equal a gate command — and it is not sufficient, because two different
// commands can both be vacuous.
//
// SO THIS ASKS THE ONE QUESTION NO COMMAND CAN EXPRESS. Not "are the tasks done", which the loop already
// knows and which was true; but "can a person use this the way the README says they can". It is a judgement,
// it needs a model, and this is the only run in the machine that sees a whole feature against the brief.
//
// LAST OF THE THREE SECTIONS, deliberately. It is read after the children and after the smoke evidence, so
// "the tasks are done and the command passed" is already in view when the question is put — which is the
// exact combination that was mistaken for an answer.
//
// AND IT IS STILL A CHECKUP. Nothing here blocks: a feature that cannot be used is reported, in the words
// the report already asks for, and a person decides. Turning this into a gate would stop the project on a
// judgement, which is what ruling 55 refused for the smoke command and refuses again here.
function usableSection(): string {
  return [
    'The tasks under this card being done is **not** the answer to this. The loop already knows they are',
    'done — that is why you were dispatched — and a feature can be entirely delivered and entirely unusable.',
    '',
    '**Can someone use this the way the README says they can?**',
    '',
    'The README at the project root is the brief. Read what it promises a person can DO, then find out',
    'whether they can. Run the thing. If it is a command, run the command; if it is a page, serve it and',
    'open it; if it is a library, write the three lines its own README tells a caller to write and execute',
    'them. Use what is already there to do it — the smoke command above, the scripts in the manifest — and',
    'if nothing runs it, that is itself the finding.',
    '',
    'Two failures to watch for, because both have shipped here green:',
    '',
    '- **Nothing executes it.** Exported functions with no entry point, a server with no route, a page',
    '  nothing serves. The tests pass because they import what the code exports, which is not the same',
    '  thing as the product working.',
    '- **The tests were written by whoever wrote the code**, against the same misunderstanding. A suite',
    '  that agrees with the implementation proves they agree, not that either is right.',
    '',
    'Say what you actually did to find out, and what happened. "The tests pass" is not an answer to this',
    'question; "I ran `npm start` and it printed nothing" is.',
  ].join('\n');
}

// The run before this one, under whichever heading fits what this run is for. The same record is a
// hand-over when the run continues it and the SUBJECT when the run is judging it, and the two must not be
// worded the same: "this continues earlier work" invites a judge to treat that work as its own.
//
// A run that produced no report is the case this exists for. What it left behind — how it ended, what
// VibeBoard noted about it, how many files it changed — IS the evidence when there is no report, and a
// judge shown nothing simply looked elsewhere.
export function previousSection(previous: NonNullable<PromptInputs['previous']>, judging: boolean): string {
  const facts = [
    `Run **${previous.run}**, skill \`${previous.skill}\`, which VibeBoard recorded as \`${previous.status}\`.`,
    ...(previous.filesChanged === undefined
      ? []
      : [`It changed ${previous.filesChanged} file${previous.filesChanged === 1 ? '' : 's'}.`]),
    ...(previous.note ? [`VibeBoard noted: ${previous.note}`] : []),
  ];
  const report = previous.report?.trim()
    ? `What it reported:\n\n${previous.report.trim()}`
    : 'It wrote no report.';
  const verdict = previous.verification ? `\n\n${verdictEvidence(previous.verification)}` : '';
  return section(
    judging ? 'The run you are judging' : 'The previous run on this card',
    `${judging ? '' : 'This continues earlier work.\n\n'}${facts.join('\n')}\n\n${report}${verdict}`,
  );
}

// WHAT WAS DECIDED ABOUT THAT RUN, and it is the whole input to a `fix`. Two renderings, because there are two
// kinds of failure and they are addressed differently: a failing COMMAND is a thing to make pass, and a
// reviewer's FINDING is a thing to change. A fix told only "this failed" cannot tell which it is looking at.
function verdictEvidence(v: Verification): string {
  const who = v.mode === 'review' ? 'The review' : `The ${v.mode}`;
  if (v.passed) return `${who} passed this run.`;
  const head = `${who} did NOT pass this run:`;
  // A GATE FAILURE carries its own command and what that command printed, which is evidence nobody has to
  // interpret. `reason` distinguishes a command that was killed or could not be spawned from one that exited
  // non-zero, and the first two are not failures of the code (core/verify.ts).
  if (v.command) {
    return [
      head,
      ...(v.reason ? ['', v.reason] : []),
      '',
      `The command that failed: \`${v.command}\``,
      ...(v.output ? ['', 'What it printed:', '', '```', v.output.trim(), '```'] : []),
    ].join('\n');
  }
  // AND A REVIEW CARRIES WORDS. This is not a tidy-up for a missing field: a fix handed no findings guesses,
  // and a guess is what turns the review loop into a random walk that spends every attempt the cap allows.
  return [
    head,
    ...(v.reason
      ? ['', v.reason]
      : ['', 'It recorded no reason, which is itself worth saying in your report.']),
    // The judging run's own report holds the findings in full, so a fix that needs more can go and read them.
    ...(v.by ? ['', `Its full findings are on run **${v.by}**.`] : []),
  ].join('\n');
}
