import type { WizardState } from '../../store/project/wizard.js';

// THE WIZARD'S VOICE CONTRACT AND ITS BRIEF, prepended to the model's copy of each message while the
// documents are being written — the same seam and the same split as the credential section: the
// transcript keeps the person's words. It exists because this is the person's FIRST CONTACT with the
// product (decision 77): a wall of text here teaches them the assistant is work to read.
export function wizardFrame(state: WizardState | null): string | undefined {
  if (state?.step !== 'docs') return undefined;
  const a = state.answers ?? {};
  return [
    '## Project setup is running — before anything else, how to speak',
    '',
    'You are helping someone set up their project, and this may be their first contact with the',
    'product. Answer in under 200 words, in plain human language. No technicalities unless they ask;',
    'offer depth ("want the technical detail?") rather than delivering it.',
    '',
    '## What they told the setup form',
    '',
    `- What it is: ${a.what ?? '(not answered)'}`,
    `- Who it is for: ${a.who ?? '(not answered)'}`,
    `- What done looks like: ${a.done ?? '(not answered)'}`,
    `- The agreed stack: ${state.stack ?? '(not agreed yet)'}`,
    '',
    '## Your job in this conversation',
    '',
    'Write the README at the project root (at least 200 characters of real description) and the five',
    'foundation documents through `PUT /api/control/foundation/:name`, from their answers and the',
    'agreed stack. Where you cannot infer something, say so IN the document, loudly and plainly',
    '("**I couldn\'t work out:** how you want this tested — tell me in a sentence") — an admitted gap',
    'beats a plausible blank, because these documents decide whether auto-pilot may start.',
    'CODE-QUALITY.md carries the `gates:` list and TESTING.md the `smoke:` command, in YAML',
    'frontmatter — docs/foundation-bootstrap.md in this project states both contracts.',
    '',
    'After writing or changing any of those documents, also store a 2–3 sentence plain-language',
    'summary with `PUT /api/wizard/resumes/:name` — the person reads the summaries first.',
  ].join('\n');
}
