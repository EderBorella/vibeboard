import { relative } from 'node:path';
import { ARCHIVE_SLUG, RESULTS_DIR } from '../core/layout.js';
import type { Skill } from '../core/skills.js';
import type { BoardName, Card } from '../core/types.js';
import type { Verification } from '../core/verify.js';
import { endpointsFor } from './auth.js';
import type { Scope } from './credentials.js';

// The dispatch prompt: everything the agent is told about one run, in one string.
//
// A pure function of its inputs — no disk, no config, no clock — so what an agent will see can be
// asserted directly. The caller does the reading and decides what to include.
//
// What is deliberately NOT here: VIBEBOARD.md, INSTRUCTIONS.md and CLAUDE.md/AGENTS.md. The turn
// machinery already appends those to the system prompt for both backends (agent-turn.ts), so
// repeating them would spend tokens saying the same thing twice.

// One board's columns as the agent must see them: the name to reason with and the slug to type into a
// path. Neither is derivable from the other — slugging is one-way — so a column carries both.
export interface BoardColumns {
  board: BoardName;
  columns: { name: string; slug: string }[];
}

export interface PromptInputs {
  skill: Skill;
  // The card this run is about, and its file verbatim. BOTH ABSENT for a PROJECT run — the bootstrap, which
  // derives the board itself and therefore has no card to be about (the `bootstrap` row of core/phases.ts).
  // Both or neither: a card with no file would render a heading over nothing, and a file with no card has
  // nothing to name.
  card?: Card;
  // The columns that exist, per board, in the order they are displayed. A list rather than a Record
  // so rendering is a plain map, and so the caller chooses which boards a run is told about.
  boardColumns: BoardColumns[];
  // The card's file, verbatim. Small and always needed, so it goes in rather than being fetched.
  cardFile?: string;
  // Cards this one links to. `body` is included only where it earns its tokens — see linkedSection.
  linked: Card[];
  // Files the user attached, as project-root-relative paths. Paths, not content: the agent has a
  // Read tool, and inlining a doc it may not need is tokens spent on nothing.
  attachments: string[];
  // External reference links from the resources registry.
  links: { title: string; url: string }[];
  // The run before this one on the same card: the work this run CONTINUES, or — when `verdict` is set —
  // the work it is JUDGING. One field for both because it is one fact; which of the two it means is
  // decided by `verdict` at the point of rendering, so the two readings cannot drift apart.
  //
  // More than the report, because a run that produced no report is exactly the case that matters. A
  // judge handed only a report saw nothing at all where a run had failed, and judged whatever else it
  // could find on the card — see the section builder.
  previous?: {
    run: string;
    skill: string;
    // VibeBoard's own word for how it ended (`success`, `attention`, `failed`, `cancelled`…), not the
    // agent's claim about its work.
    status: string;
    report?: string;
    // What VibeBoard recorded when there was no report — an exit code, a timeout, an empty answer.
    note?: string;
    filesChanged?: number;
    // WHAT WAS DECIDED ABOUT IT, where anything was. This is what a `fix` run is addressing: a gate's own
    // command and output, or the reviewer's findings. It is already on the record — the verdict path wrote it
    // there (decision 18) — so this is a render rather than a new fact, and without it a fix run is told its
    // card came back and not why, which makes the review loop a random walk bounded only by `attemptCap`.
    verification?: Verification;
  };
  // The user's own words for this dispatch.
  userPrompt?: string;
  // The documents this run is bound by. Four as paths — the agent has a Read tool, and inlining a
  // document it may not need is tokens spent on nothing — and CODE-QUALITY.md inlined, because its
  // gates bind every run and an agent that has to go and fetch them will sometimes not bother.
  // Absent when the project has no foundation yet, and then the section is left out entirely rather
  // than promising a folder with nothing in it.
  foundation?: { paths: string[]; codeQuality?: string };
  // Present when this run is a REVIEW: decision 51's second step, where a model is asked only for what a
  // command's exit code cannot express. It replaces the reporting contract with one that asks for a
  // `verdict`, and carries the two facts about the judgement that ONLY THE LOOP HOLDS — whether the gates it
  // ran in its own process passed, and whether this card is in the setup subtree, where an absent gate set is
  // expected because installing the test runner is what that card is for.
  //
  // Both are refused from every scope but `service` on the way in (ruling 63): a review agent able to send
  // `gatesPassed: true` could talk its own reviewer into a pass, which is decision 40 defeated through a
  // side door.
  review?: { gatesPassed: boolean; setupSubtree: boolean };
  // Present when this run is a CHECKUP, and every field in it was gathered BY THE LOOP (ruling 60). Three of
  // the four facts a checkup needs are unreachable from the `work` scope every card run is minted with —
  // `GET /api/suggestions`, `GET /api/runs`, and the diary, which has no read row at all — and widening the
  // scope table would grant an agent authority to solve a problem the loop can solve.
  //
  // `blocked` is separate from `children` deliberately: told only the columns, a checkup would have to know
  // which slug means blocked, which is a config fact it has no way to read.
  //
  // `smoke` is the feature checkup's alone (ruling 55), and it is a `Verification` — the same shape as the gate
  // evidence above, because "a command ran and here is what happened" is one fact and not two. Its `reason`
  // carries the endings apart: a command that was killed, one that could not be spawned, and one that exited
  // non-zero are different facts, and the first two are not failures of the code.
  checkup?: {
    children: { id: string; column: string; outcome?: string; blocked: boolean }[];
    blocked: string[];
    suggestions: { id: string; title: string }[];
    smoke?: Verification;
  };
  // Where the agent must write its report, project-root-relative.
  reportPath: string;
  projectRoot: string;
  // What this run presents to the API, and where to send it. In the prompt rather than the
  // environment because the OpenCode backend is one long-lived `opencode serve` spawned before any
  // run exists — its environment is fixed, so a per-run value cannot reach it that way.
  // Absent for a runner with no credential store, and then the section is left out entirely.
  // `scope` is carried because the endpoint list is GENERATED from it. Without it the section would
  // have to assume `work`, and a run dispatched under any other scope would be handed a list that is
  // wrong in both directions — naming rows it cannot call, omitting rows it can.
  credential?: { token: string; apiBase: string; scope: Scope };
}

function section(heading: string, body: string): string {
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
function projectSubject(): string {
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
function columnsSection(boardColumns: BoardColumns[]): string {
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
function linkedSection(linked: Card[], projectRoot: string): string {
  const lines = linked.map((c) => `${cardLine(c)}\n  file: ${relative(projectRoot, c.filePath)}`);
  const intent = linked
    .filter((c) => c.board === 'product' && c.body.trim() !== '')
    .map((c) => `### ${c.id} — ${c.title}\n\n${c.body.trim()}`);
  return [lines.join('\n'), ...intent].join('\n\n');
}

// Named as binding rather than as background reading, and as read-only rather than as a request:
// the OS denies these paths to every agent, so an agent that tries to "fix" one gets a permission
// error it would otherwise read as a broken tool.
function foundationSection(foundation: NonNullable<PromptInputs['foundation']>): string {
  const lines = [
    'These decisions are already made for this project. Follow them, do not re-open them, and do not',
    'edit these files — they are read-only to you at the operating-system level.',
    '',
    ...foundation.paths.map((p) => `- ${p}`),
  ];
  if (foundation.codeQuality?.trim()) {
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
  ].join('\n');
}

// RULING 55: the loop ran it, and this is EVIDENCE rather than a verdict — the model is told what the command
// did and decides what it means. A feature whose smoke command fails is exactly what a person needs told about,
// so blocking on it would stop the project instead of reporting it.
function smokeSection(smoke: Verification): string {
  const lines = smoke.passed
    ? ['The smoke command passed.']
    : [
        'The smoke command did NOT pass.',
        ...(smoke.reason ? ['', smoke.reason] : []),
        ...(smoke.command ? ['', `The command: \`${smoke.command}\``] : []),
        ...(smoke.output ? ['', 'What it printed:', '', '```', smoke.output.trim(), '```'] : []),
      ];
  return [
    'Auto-pilot ran this in its own process before dispatching you, and it is evidence rather than a verdict:',
    'what it means is yours to decide.',
    '',
    ...lines,
  ].join('\n');
}

// TWO SECTIONS, and separate because the smoke result is the FEATURE checkup's alone: a heading over nothing is
// worse than no heading, which is the rule this file already follows. Returned as a list rather than pushed by
// the caller so `buildRunPrompt` stays a flat sequence — a nested conditional inside it costs far more
// complexity than the length it saves, and flattening beats a suppression.
function checkupSections(checkup: PromptInputs['checkup']): string[] {
  if (!checkup) return [];
  return [
    section('What is under this card', checkupSection(checkup)),
    ...(checkup.smoke ? [section('The smoke command', smokeSection(checkup.smoke))] : []),
  ];
}

const CONTRACT_LINES = [
  'When you have finished — succeeded or not — write your report to:',
  '',
  '```',
  '<REPORT_PATH>',
  '```',
  '',
  'It is a markdown file with YAML frontmatter:',
  '',
  '```markdown',
  '---',
  'outcome: success        # or: attention',
  'summary: "one line a human can read at a glance"   # quote it: a bare colon breaks the YAML',
  'options:                # attention only: what could be done next, one per line',
  '  - ...',
  'created: [E-041]        # ids of any cards you created',
  '---',
  '## What I did',
  '',
  'The detail. This body is shown to the user as the report.',
  '```',
  '',
  'Use `outcome: attention` whenever you could not finish, the work turned out bigger than the',
  'card implies, or you found something worth a decision — and put the choices in `options`.',
  'A run with no report file counts as needing attention, so write one either way.',
  'Write ONLY that file for your report; the run record itself belongs to VibeBoard.',
];

// A JUDGING RUN ANSWERS done OR sent-back, and that contract is an ALTERNATIVE to CONTRACT_LINES rather
// than an addition: both present, the run would be told to report an outcome AND to judge, and whichever
// heading it read first would decide what it wrote.
//
// It used to ask for a SCORE against a stated threshold, on the argument that a binary verdict yields no
// distribution to judge the critic by later (S9). Decision 40 rules the other way: the number was a model's
// opinion of its own project dressed as a measurement, and the gates the loop runs in its own process are
// the measurement. A review is asked only for what an exit code cannot express.
// WHICH RUN, and this is the first hand-run's finding (2026-08-06). Told only "judge work that is already
// done", a critic dispatched after a `break-down` run that had died with `[opencode failed: fetch failed]`
// went looking for work to judge, found the PREVIOUS run's five derived cards, scored them 1 and said so in
// as many words: "I did not mark down the later, separate break-down run … that is a different card's task."
// The card advanced on a run that exited 1, wrote no report and changed no files — the failure decision 3
// exists to prevent, arriving through the judge rather than through the agent.
//
// Absent for a review a person dispatches from the card, where there is no run under judgement and the
// subject really is the card's current state. Named as `undefined` rather than defaulted, because a
// sentence naming a run that was never passed would be worse than the general one.
//
// The verdict a run that left nothing behind earns is written straight in now. It was a parameter while
// there were two judging contracts wording it differently — a score of 0, or a `sent-back` — and the
// critic's is gone.
function judgedLines(judged: NonNullable<PromptInputs['previous']>): string[] {
  return [
    `You are judging ONE run: **${judged.run}** (skill \`${judged.skill}\`), described above. Judge what THAT`,
    'run did, and nothing else.',
    '',
    'An earlier run on this card may have succeeded; its work is not this run’s work and does not count for',
    'it. If the run you are judging left nothing behind at all — it failed AND wrote no report AND produced',
    'nothing — then the verdict is `sent-back`, however good the card looks otherwise.',
    '',
    'A run that changed no FILES has not necessarily done nothing: cards are created through the API, so a',
    'run whose whole product is cards changes nothing on disk and may be perfectly complete. Judge what it',
    'produced, never how many files it touched.',
  ];
}

// The opening of both judging contracts: a judge that fixes what it is judging is grading its own work.
const JUDGE_PREAMBLE = [
  'You are judging work that is already done. Change nothing: do not edit the code, do not edit the',
  'card, and do not move it. Your report IS the verdict, and a judge that fixes what it is judging is',
  'grading its own work.',
];

// WHAT THE LOOP ALREADY DID, which the reviewer has to be told or it spends its turn doing it again. Three
// states and not two: the setup-subtree exception comes FIRST, because a card whose whole purpose is to
// install the test runner has no gate set to have passed, and telling it the suite is green would be a claim
// nothing produced.
function gateEvidence(review: NonNullable<PromptInputs['review']>): string[] {
  if (review.setupSubtree) {
    return [
      'This card is in the project’s SETUP subtree, so there is no gate set yet and that is expected:',
      'installing the toolchain and the test runner is what this card is for. So the judgement is by reading —',
      'read what the run left behind and say whether it does what the card asked.',
    ];
  }
  if (review.gatesPassed) {
    return [
      'The gates have already passed. Auto-pilot ran every command the project declares, in its own process,',
      'before dispatching you — so the suite is green and there is no need to run it again. What a gate cannot',
      'express is the one question left for you: does this do what the card asked.',
    ];
  }
  // Only reachable for a review a person dispatched by hand: the gate result is the loop's own fact and is
  // refused from every other scope, so there is none. Said plainly rather than left out — a missing sentence
  // reads as a pass.
  return [
    'Nobody has run the gates for this card, so you are judging the work without them. Say so in your report',
    'if that changes what you can conclude.',
  ];
}

// A REVIEW's contract: `done` or `sent back with findings`, and no number anywhere. Decision 51 puts a model
// here for exactly one question — does this do what the card asked — because a gate proves the suite passes
// and cannot prove the suite tests the criterion the card states.
function reviewLines(
  review: NonNullable<PromptInputs['review']>,
  judged: PromptInputs['previous'],
): string[] {
  return [
    ...JUDGE_PREAMBLE,
    '',
    ...gateEvidence(review),
    '',
    ...(judged ? [...judgedLines(judged), ''] : []),
    'Write your report to:',
    '',
    '```',
    '<REPORT_PATH>',
    '```',
    '',
    '```markdown',
    '---',
    'outcome: success        # or: attention, if you could not judge it at all',
    'verdict: done           # or: sent-back',
    'summary: "one line saying why it got that verdict"   # quote it: a bare colon breaks the YAML',
    '---',
    '## What I judged',
    '',
    'The findings: what the card asked for, what the work does, and where they differ. A `fix` run is handed',
    'exactly this, so be specific enough that someone could disagree with it.',
    '```',
    '',
    'Judge the work against the CARD, not against what you would have built. Work that does MORE than the',
    'card asked still passes — say so rather than marking it down, because failing a card for over-delivery',
    'throws away working code and spends an attempt rebuilding it.',
    'A report with no `verdict` cannot pass anything, so answer even when the answer is `sent-back`.',
  ];
}

// The run before this one, under whichever heading fits what this run is for. The same record is a
// hand-over when the run continues it and the SUBJECT when the run is judging it, and the two must not be
// worded the same: "this continues earlier work" invites a judge to treat that work as its own.
//
// A run that produced no report is the case this exists for. What it left behind — how it ended, what
// VibeBoard noted about it, how many files it changed — IS the evidence when there is no report, and a
// judge shown nothing simply looked elsewhere.
function previousSection(previous: NonNullable<PromptInputs['previous']>, judging: boolean): string {
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

// The board is changed through the API, not by writing card files. Stated as the mechanism rather
// than as a preference: a column is a folder, so a file written to the wrong one does not fail — it
// creates a folder no column maps to, and the card inside it is invisible to the board while still
// holding its id. The endpoint refuses that; a file write cannot.
//
// THE LIST ITSELF IS GENERATED from auth.ts's scope table (`endpointsFor`). It used to be typed out
// here, again for the judge below, and a third time in the VIBEBOARD.md that scaffold.ts seeds — so
// granting a scope a new row told no agent anything, and every wording fix had to be made three
// times. The seeded document no longer lists endpoints at all; it points at whatever the credential
// section says, which is this. The confinement line is generated too: it is enforced server-side either way, but an agent
// that does not know about it reads a 403 as a broken tool and falls back to editing files.
function credentialSection(apiBase: string, token: string, scope: Scope, cardId?: string): string {
  const endpoints = endpointsFor(scope, cardId);
  return [
    `Your credential: \`${token}\`. Send it as \`Authorization: Bearer <credential>\` to \`${apiBase}\`.`,
    'It stops working the moment this run ends, and it is yours alone — do not put it in a card, a',
    'report or a file.',
    '',
    ...(endpoints.length === 0
      ? [
          // A scope with no rows is not a mistake to paper over: `work` narrowed to nothing is a
          // legitimate future state, and inventing capabilities for it would be worse than silence.
          'It grants you nothing beyond reading the files, which are yours to read.',
        ]
      : [
          'Use these rather than writing files under `.vibeboard/`. A card is a file in a column folder,',
          'so a file written to a column that does not exist does not fail — it creates one, and the card',
          'in it vanishes from the board while keeping its id. These endpoints refuse that:',
          '',
          ...endpoints,
        ]),
    '',
    'Reading is unrestricted: `GET /api/state` is the whole board, and the files are yours to read.',
    'Anything not listed above is not yours — say so in your report instead.',
  ].join('\n');
}

// A JUDGING run's credential, which grants it nothing on the board.
//
// It exists because the alternative was worse in both directions. Handing a judge the section above gave
// it two contradictory REQUIRED contracts — "edit this card with PATCH" immediately followed by "do not
// edit the card" — and saying nothing at all leaves an agent to find a live token in its prompt with no
// explanation, which is an agent that will experiment with it.
//
// The scope itself is `work`, because a review is dispatched down the ordinary run path like any other card
// run. What stops it changing the board is that it is handed no board-changing endpoints at all.
function judgeCredentialSection(apiBase: string, token: string): string {
  return [
    `Your credential: \`${token}\`. Send it as \`Authorization: Bearer <credential>\` to \`${apiBase}\`.`,
    'It stops working the moment this run ends, and it is yours alone — do not put it in a card, a',
    'report or a file.',
    '',
    'It is for READING. `GET /api/state` is the whole board, and the files are yours to read. Nothing',
    'about the board is yours to change: not this card, not another one, not where any of them sit.',
    'Your report is the verdict, and it is the only thing this run produces.',
  ].join('\n');
}

// The chat copilot's, when a person has authorised it. Same generator, different scope — which is the
// point of generating it: the copilot's authority is a row in the same table as everything else.
export function assistCredentialSection(apiBase: string, token: string): string {
  return [
    `Your credential: \`${token}\`. Send it as \`Authorization: Bearer <credential>\` to \`${apiBase}\`.`,
    'It belongs to THIS conversation and dies with it. Never put it in a card, a file, or a message.',
    '',
    'You are authorised to change the board and the foundation documents through these endpoints. Use',
    'them rather than writing files under `.vibeboard/` — every one of those paths is denied to you by',
    'the OS, so a write there fails rather than doing something surprising:',
    '',
    ...endpointsFor('assist'),
  ].join('\n');
}

// ONE CONTRACT, never two. A run handed both would be told to report an outcome and to judge, and whichever
// heading it read first would decide what it wrote.
//
// Its own function so `buildRunPrompt` stays a flat sequence of sections: a nested conditional inside it costs
// far more complexity than the length it saves, and flattening beats a suppression.
function contractFor(input: PromptInputs): { heading: string; lines: string[] } {
  if (input.review) {
    return { heading: 'Judging (required)', lines: reviewLines(input.review, input.previous) };
  }
  return { heading: 'Reporting (required)', lines: CONTRACT_LINES };
}

export function buildRunPrompt(input: PromptInputs): string {
  // Every part is joined by exactly one blank line, so no part carries its own leading or trailing
  // blank — otherwise the heading and the skill body end up four newlines apart.
  const parts: string[] = [
    `# ${input.skill.name}\n\n${input.skill.prompt.trim()}`,
    input.card
      ? section(
          `The card: ${input.card.id}`,
          `File: ${relative(input.projectRoot, input.card.filePath)}\n\n\`\`\`markdown\n${(input.cardFile ?? '').trim()}\n\`\`\``,
        )
      : section('This run is about the project, not a card', projectSubject()),
  ];

  // Straight after the card, which names one column: the full set belongs next to the one example of
  // it. Omitted when empty — a heading promising "every column" above nothing would be a lie.
  if (input.boardColumns.length > 0) {
    parts.push(section("The project's columns", columnsSection(input.boardColumns)));
  }
  // Immediately after the columns and before the card's own links: the stack and the gates are the
  // frame everything else is read inside, and a decision an agent meets after the work is described
  // is one it has already reasoned past.
  if (input.foundation && input.foundation.paths.length > 0) {
    parts.push(section("The project's foundation", foundationSection(input.foundation)));
  }
  if (input.linked.length > 0) {
    parts.push(section('Linked cards', linkedSection(input.linked, input.projectRoot)));
  }
  if (input.attachments.length > 0) {
    parts.push(
      section(
        'Attached material',
        `Read these if they bear on the task:\n${input.attachments.map((p) => `- ${p}`).join('\n')}`,
      ),
    );
  }
  if (input.links.length > 0) {
    parts.push(section('Reference links', input.links.map((l) => `- [${l.title}](${l.url})`).join('\n')));
  }
  // After the linked cards and before the contract: this IS the checkup's subject.
  parts.push(...checkupSections(input.checkup));
  const judging = input.review !== undefined;
  if (input.previous) parts.push(previousSection(input.previous, judging));
  // Last of the context and immediately before the contract: the user's words are the most
  // specific instruction in the prompt and must not be buried above the card.
  if (input.userPrompt?.trim()) {
    parts.push(section('What the user asked for on top of the skill', input.userPrompt.trim()));
  }
  // Which credential section, and it is not a style choice: a judging run given the board-changing one
  // was told to PATCH its card and, three lines later, not to. Both sections are `(required)`, so there
  // was no reading of the prompt that satisfied it.
  if (input.credential) {
    parts.push(
      judging
        ? section('Your credential', judgeCredentialSection(input.credential.apiBase, input.credential.token))
        : section(
            'Changing the board (required)',
            credentialSection(
              input.credential.apiBase,
              input.credential.token,
              input.credential.scope,
              input.card?.id,
            ),
          ),
    );
  }
  const contract = contractFor(input);
  parts.push(section(contract.heading, contract.lines.join('\n').replace('<REPORT_PATH>', input.reportPath)));

  return `${parts.join('\n\n')}\n`;
}
