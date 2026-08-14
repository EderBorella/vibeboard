import type { PromptInputs } from './index.js';

// WHAT THE RUN IS ASKED TO PRODUCE, and there is never more than one of these in a prompt. A run handed
// both contracts would be told to report an outcome AND to judge, and whichever heading it read first
// would decide what it wrote — so `contractFor` in index.ts picks exactly one.

export const CONTRACT_LINES = [
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
export function reviewLines(
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
