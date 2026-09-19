import { foundationRel, RESUMABLE_DOCUMENTS } from '../../core/layout.js';
import type { WizardState } from '../../store/project/wizard.js';

// THE SIX DOCUMENTS A NAME MAY POINT AT, and the reason this is a fixed set rather than a path check:
// the name arrives from the browser, so a page that has been tampered with can put any string in it.
// Anything else is DROPPED rather than framed, which is what stops this field smuggling a path into a
// prompt. The set is `core/layout.ts`'s — the same one `PUT /api/wizard/resumes/:name` accepts — and one
// home rather than two, because a second copy of a list this short is how the two doors come to disagree
// about what a document is.
function attachLine(attach: string | undefined): string | undefined {
  if (!attach || !RESUMABLE_DOCUMENTS.has(attach)) return undefined;
  // The README is the one of the six at the project root; the rest are under the foundation folder.
  const path = attach === 'README.md' ? 'README.md' : foundationRel(attach);
  // A name and a path, never the content: the model has a Read tool, and the person may be about to
  // talk about one line of it. decision 78.
  return `The person is looking at ${path} right now — "it" and "this document" mean that file.`;
}

// THE WIZARD'S VOICE CONTRACT AND ITS BRIEF, prepended to the model's copy of each message while the
// documents are being written — the same seam and the same split as the credential section: the
// transcript keeps the person's words. It exists because this is the person's FIRST CONTACT with the
// product (decision 77): a wall of text here teaches them the assistant is work to read.
//
// `attach` is REQUIRED though it is usually nothing: it is the only thing between a browser-supplied
// name and the prompt, so a new call site has to decide about it rather than inherit a default.
export function wizardFrame(state: WizardState | null, attach: string | undefined): string | undefined {
  if (!state) return undefined;
  // THE IMPORT IS THE COPILOT UNDER A FRAME, NEVER A RUN (decision 79), which makes this text the only
  // thing confining it: `assist` may create a card on any board, and nothing else says it must stop at
  // cards. No attachment reaches it — the six documents are the other step's subject, and what this
  // conversation is about is a list the product has no copy of.
  if (state.step === 'import') {
    return [
      '## Project setup is running — before anything else, how to speak',
      '',
      'You are helping someone bring their existing task list into this project, and this may be',
      'their first contact with the product. Answer in under 200 words, plain human language, no',
      'technicalities unless they ask.',
      '',
      '## Your job in this conversation',
      '',
      'Their message carries the list (or where it lives) and a one-liner about how to read it.',
      'Create cards on the right boards, nothing deeper: features on `features`, user-facing work on',
      "`product`, technical work on `engineering`, everything into each board's first column. Use",
      'their words for titles; do not invent bodies past what the list says; skip finished items',
      'unless asked. When you cannot tell where something goes, ask — one question, not a form.',
      'When you are done, say plainly how many cards you made on which boards.',
    ].join('\n');
  }
  if (state.step !== 'docs') return undefined;
  const a = state.answers ?? {};
  const looking = attachLine(attach);
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
    ...(looking ? ['', looking] : []),
  ].join('\n');
}
