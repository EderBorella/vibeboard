import { relative } from 'node:path';
import type { Skill } from '../../../core/skills.js';
import type { BoardName, Card } from '../../../core/types.js';
import type { Verification } from '../../../core/verify.js';
import type { Scope } from '../../auth/credentials.js';
import { CONTRACT_LINES, reviewLines } from './contracts.js';
import { credentialSection, judgeCredentialSection } from './credential.js';
import {
  boxSection,
  checkupSections,
  columnsSection,
  expressSection,
  foundationSection,
  linkedSection,
  previousSection,
  projectSubject,
  section,
} from './sections.js';

// The dispatch prompt: everything the agent is told about one run, in one string. Split by subject —
// the input contract and the assembly here, the per-section builders in `sections.ts`, what the run is
// asked to produce in `contracts.ts`, and the one part that reaches the scope table in `credential.ts`.
//
// This directory USED to sit behind a barrel at `server/run-prompt.ts`, kept because NodeNext has no
// directory-index resolution: `import … from './run-prompt.js'` cannot be pointed at `prompt/index.js`
// (`TS2307`, verified), so the barrel is what made the original split cost its importers nothing. The
// barrel is gone now, and only because it had stopped buying anything: filing the prompt under `runs/`
// changed the specifier for every one of its four importers anyway, so a file whose whole purpose was
// to keep a specifier stable was preserving a path nobody could still use.
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
    // THE FEATURE CHECKUP, which is asked one question no other run is asked. Ruling 66's second fix, and
    // the one that answers the incident: a project reached `complete` with every gate green and the tool it
    // built printed nothing, because every layer was asking whether the tasks were done rather than whether
    // the thing worked. Only this run sees a whole feature against the brief.
    feature?: true;
    // Whether a failed smoke may refuse this feature's close — true only for the last open feature.
    // See `smokeSection`: it decides whether the failure is this card's problem or a later card's.
    smokeGates?: true;
  };
  // Where the agent must write its report, project-root-relative.
  // Whether this project runs the express lifecycle (`autopilot.mode`). COMPUTED BY THE SERVER from the
  // project's own config rather than accepted on the wire — ruling 63's precedent, and the same reason
  // `reviewFor` computes the judging contract: a caller that could ask for standard prompts on an express
  // project would be a second answer to a question the config already answers.
  express?: true;
  // Whether this project's box has a browser in it — the web layer, which `game` and `research` boxes
  // are not built from. REQUIRED rather than optional with a default, because the honest answer lives
  // where the image is chosen: a caller that forgot to work it out would otherwise silently claim a
  // browser, which is the exact sentence this exists to stop. decision 75.
  browser: boolean;
  reportPath: string;
  // The run's own id, asked for INSIDE the report as well as being in the path it writes to. A report
  // that does not know which run it belongs to is not folded in — see `checkReportIdentity` in
  // `store/run-store.ts` for why that is a file check rather than the per-run mount decision 10 wanted.
  runId: string;
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

// ONE CONTRACT, never two. A run handed both would be told to report an outcome and to judge, and whichever
// heading it read first would decide what it wrote.
//
// Its own function so `buildRunPrompt` stays a flat sequence of sections: a nested conditional inside it costs
// far more complexity than the length it saves, and flattening beats a suppression.
export function contractFor(input: PromptInputs): { heading: string; lines: string[] } {
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

  // IMMEDIATELY AFTER THE SKILL AND BEFORE THE CARD, and the order is the behaviour. The seeded
  // `break-down` skill says "one acceptance criterion per card" in its own words; express contradicts that
  // on purpose, so it has to be read AFTER the sentence it overrides — placed above the skill body it would
  // be the instruction the agent reasons past. And before the card, because it is about how to size what
  // this run produces rather than about the subject.
  const express = input.express ? expressSection(input.skill.slug, input.card?.board) : undefined;
  if (express) parts.splice(1, 0, section('How this project sizes its cards', express));

  // Straight after the card, which names one column: the full set belongs next to the one example of
  // it. Omitted when empty — a heading promising "every column" above nothing would be a lie.
  if (input.boardColumns.length > 0) {
    parts.push(section("The project's columns", columnsSection(input.boardColumns)));
  }
  // WHAT THE MACHINE IT IS STANDING IN ALREADY HAS, beside the columns for the same reason: this is the
  // frame, not the work. Placed before the foundation rather than after because a run that is going to
  // fetch a browser decides to early, while it is still working out how to approach the card at all.
  parts.push(section('What this container already has', boxSection(input.browser)));

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
  parts.push(
    section(
      contract.heading,
      contract.lines.join('\n').replace('<REPORT_PATH>', input.reportPath).replace('<RUN_ID>', input.runId),
    ),
  );

  return `${parts.join('\n\n')}\n`;
}
