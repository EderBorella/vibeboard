import { FOUNDATION_FILES, foundationRel } from '../../core/layout.js';
import type { WizardState } from '../../store/project/wizard.js';

// THE SIX DOCUMENTS A NAME MAY POINT AT, and the reason this is a fixed set rather than a path check:
// the name arrives from the browser, so a page that has been tampered with can put any string in it.
// Anything else is DROPPED rather than framed, which is what stops this field smuggling a path into a
// prompt. The same six `PUT /api/wizard/resumes/:name` accepts, built from the same constant so only
// `README.md` — the one that is not a foundation document — could ever drift between them.
const ATTACHABLE = new Set<string>([...FOUNDATION_FILES.map((f) => f.name), 'README.md']);

function attachLine(attach: string | undefined): string | undefined {
  if (!attach || !ATTACHABLE.has(attach)) return undefined;
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
  if (state?.step !== 'docs') return undefined;
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
