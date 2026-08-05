import { relative } from 'node:path';
import { ARCHIVE_SLUG, RESULTS_DIR } from '../core/layout.js';
import type { Skill } from '../core/skills.js';
import type { BoardName, Card } from '../core/types.js';

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
  card: Card;
  // The columns that exist, per board, in the order they are displayed. A list rather than a Record
  // so rendering is a plain map, and so the caller chooses which boards a run is told about.
  boardColumns: BoardColumns[];
  // The card's file, verbatim. Small and always needed, so it goes in rather than being fetched.
  cardFile: string;
  // Cards this one links to. `body` is included only where it earns its tokens — see linkedSection.
  linked: Card[];
  // Files the user attached, as project-root-relative paths. Paths, not content: the agent has a
  // Read tool, and inlining a doc it may not need is tokens spent on nothing.
  attachments: string[];
  // External reference links from the resources registry.
  links: { title: string; url: string }[];
  // The previous run's report, when this run continues one.
  previousReport?: string;
  // The user's own words for this dispatch.
  userPrompt?: string;
  // The documents this run is bound by. Four as paths — the agent has a Read tool, and inlining a
  // document it may not need is tokens spent on nothing — and CODE-QUALITY.md inlined, because its
  // gates bind every run and an agent that has to go and fetch them will sometimes not bother.
  // Absent when the project has no foundation yet, and then the section is left out entirely rather
  // than promising a folder with nothing in it.
  foundation?: { paths: string[]; codeQuality?: string };
  // Present when this run is JUDGING finished work rather than doing it — the critic. It replaces the
  // reporting contract with one that asks for a score, and states the threshold that score will be
  // compared against. Absent for every other run, and then nothing about judging appears at all.
  verdict?: { threshold: number };
  // Where the agent must write its report, project-root-relative.
  reportPath: string;
  projectRoot: string;
  // What this run presents to the API, and where to send it. In the prompt rather than the
  // environment because the OpenCode backend is one long-lived `opencode serve` spawned before any
  // run exists — its environment is fixed, so a per-run value cannot reach it that way.
  // Absent for a runner with no credential store, and then the section is left out entirely.
  credential?: { token: string; apiBase: string };
}

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body}`;
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
  'summary: one line a human can read at a glance',
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

// A judging run reports a SCORE, not a pass. A binary verdict yields no distribution, and the promise
// to judge the critic itself from data later needs the numbers to have been written down (S9).
//
// The threshold is stated in the prompt deliberately: a judge that does not know the bar cannot
// calibrate to it, and a bar nobody can see is one nobody can argue with afterwards.
//
// It is an ALTERNATIVE to CONTRACT_LINES, never an addition. Both present, the run would be told to
// report an outcome and to score, and whichever heading it read first would decide what it wrote.
function verdictLines(threshold: number): string[] {
  return [
    'You are judging work that is already done. Change nothing: do not edit the code, do not edit the',
    'card, and do not move it. Your report IS the verdict, and a judge that fixes what it is judging is',
    'grading its own work.',
    '',
    'Write your report to:',
    '',
    '```',
    '<REPORT_PATH>',
    '```',
    '',
    '```markdown',
    '---',
    'outcome: success        # or: attention, if you could not judge it at all',
    `score: 0.0              # 0 to 1. At or above ${threshold} passes this card.`,
    'summary: one line saying why it scored that',
    'overshoot: one line     # only if the work did MORE than the card asked for',
    '---',
    '## What I judged',
    '',
    'The reasoning: what the card asked for, what the work does, and where they differ.',
    '```',
    '',
    'Score the work against the CARD, not against what you would have built. Work that does more than',
    'the card asked still passes — note it under `overshoot` rather than marking it down, because',
    'failing a card for over-delivery throws away working code and spends an attempt rebuilding it.',
    'A report with no `score` cannot pass anything, so answer even when the answer is 0.',
  ];
}

// The board is changed through the API, not by writing card files. Stated as the mechanism rather
// than as a preference: a column is a folder, so a file written to the wrong one does not fail — it
// creates a folder no column maps to, and the card inside it is invisible to the board while still
// holding its id. The endpoint refuses that; a file write cannot.
//
// The confinement is named on purpose. It is enforced server-side either way, but an agent that
// does not know about it reads a 403 as a broken tool and falls back to editing files.
function credentialSection(apiBase: string, token: string, cardId: string): string {
  return [
    `Your credential: \`${token}\`. Send it as \`Authorization: Bearer <credential>\` to \`${apiBase}\`.`,
    'It stops working the moment this run ends, and it is yours alone — do not put it in a card, a',
    'report or a file.',
    '',
    'Use these rather than writing card files. A card is a file in a column folder, so a file written',
    'to a column that does not exist does not fail — it creates one, and the card in it vanishes from',
    'the board while keeping its id. These endpoints refuse that:',
    '',
    '- `POST /api/cards` — `{ board, columnSlug, title, description?, body?, links? }`. The id is',
    '  assigned for you; never choose one.',
    `- \`PATCH /api/cards/:board/:id\` — edit title, description, tags, group or body. You may edit **${cardId}** and no other card.`,
    '- `PUT /api/cards/:board/:id/links` — `{ links: [id, ...] }`, the complete list. Links are',
    '  symmetric and the far side is written for you.',
    '',
    'Reading is unrestricted: `GET /api/state` is the whole board, and the files are yours to read.',
    'Moving and archiving cards are not yours — say so in your report instead.',
  ].join('\n');
}

export function buildRunPrompt(input: PromptInputs): string {
  // Every part is joined by exactly one blank line, so no part carries its own leading or trailing
  // blank — otherwise the heading and the skill body end up four newlines apart.
  const parts: string[] = [
    `# ${input.skill.name}\n\n${input.skill.prompt.trim()}`,
    section(
      `The card: ${input.card.id}`,
      `File: ${relative(input.projectRoot, input.card.filePath)}\n\n\`\`\`markdown\n${input.cardFile.trim()}\n\`\`\``,
    ),
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
  if (input.previousReport?.trim()) {
    parts.push(
      section(
        'The previous run on this card',
        `This continues earlier work. What that run reported:\n\n${input.previousReport.trim()}`,
      ),
    );
  }
  // Last of the context and immediately before the contract: the user's words are the most
  // specific instruction in the prompt and must not be buried above the card.
  if (input.userPrompt?.trim()) {
    parts.push(section('What the user asked for on top of the skill', input.userPrompt.trim()));
  }
  if (input.credential) {
    parts.push(
      section(
        'Changing the board (required)',
        credentialSection(input.credential.apiBase, input.credential.token, input.card.id),
      ),
    );
  }
  // One or the other, never both — see verdictLines.
  const contract = input.verdict
    ? { heading: 'Judging (required)', lines: verdictLines(input.verdict.threshold) }
    : { heading: 'Reporting (required)', lines: CONTRACT_LINES };
  parts.push(section(contract.heading, contract.lines.join('\n').replace('<REPORT_PATH>', input.reportPath)));

  return `${parts.join('\n\n')}\n`;
}
