import { relative } from 'node:path';
import type { Skill } from '../core/skills.js';
import type { Card } from '../core/types.js';

// The dispatch prompt: everything the agent is told about one run, in one string.
//
// A pure function of its inputs — no disk, no config, no clock — so what an agent will see can be
// asserted directly. The caller does the reading and decides what to include.
//
// What is deliberately NOT here: VIBEBOARD.md, INSTRUCTIONS.md and CLAUDE.md/AGENTS.md. The turn
// machinery already appends those to the system prompt for both backends (agent-turn.ts), so
// repeating them would spend tokens saying the same thing twice.

export interface PromptInputs {
  skill: Skill;
  card: Card;
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
  // Where the agent must write its report, project-root-relative.
  reportPath: string;
  projectRoot: string;
}

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body}`;
}

function cardLine(card: Card): string {
  const where = `${card.board}/${card.columnSlug}`;
  return `- **${card.id}** (${where}) — ${card.title}${card.description ? `: ${card.description}` : ''}`;
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
  parts.push(
    section('Reporting (required)', CONTRACT_LINES.join('\n').replace('<REPORT_PATH>', input.reportPath)),
  );

  return `${parts.join('\n\n')}\n`;
}
