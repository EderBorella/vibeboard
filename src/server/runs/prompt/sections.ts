import { relative } from 'node:path';
import { ARCHIVE_SLUG, RESULTS_DIR } from '../../../core/layout.js';
import type { Card } from '../../../core/types.js';
import type { Verification } from '../../../core/verify.js';
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
export function linkedSection(linked: Card[], projectRoot: string): string {
  const lines = linked.map((c) => `${cardLine(c)}\n  file: ${relative(projectRoot, c.filePath)}`);
  const intent = linked
    .filter((c) => c.board === 'product' && c.body.trim() !== '')
    .map((c) => `### ${c.id} — ${c.title}\n\n${c.body.trim()}`);
  return [lines.join('\n'), ...intent].join('\n\n');
}

// Named as binding rather than as background reading, and as read-only rather than as a request:
// the OS denies these paths to every agent, so an agent that tries to "fix" one gets a permission
// error it would otherwise read as a broken tool.
export function foundationSection(foundation: NonNullable<PromptInputs['foundation']>): string {
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
    'failure**, on the engineering board, each naming what was expected and what happened. Quote the real',
    'strings the command printed rather than describing them — a card written from the failure reproduces it,',
    'a card written from a guess sends the next run somewhere else.',
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
