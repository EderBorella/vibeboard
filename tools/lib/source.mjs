// The corpus, and where in a file something is. Shared by every gate in `tools/`.
//
// WHY THERE IS A `tools/lib/` AT ALL: `lineOf` existed in FOUR copies and `walk` in three, and the
// duplication was not free. `rulesOf` did not reset its selector cursor at a `{`, so a rule nested in
// an `@media` read as `@media (min-width: 1px) { .zeta` — `check-shape-coverage.mjs` found that,
// removed the cause, and wrote so in its own comments; `check-radius-scale.mjs` kept the bug and
// recorded it as a latent over-report it could live with. One copy fixed and two left is the whole
// argument for this directory. Phase 10 of docs/design-system.md.
//
// EVERY GATE'S SELF-TEST GOES THROUGH THESE FUNCTIONS, which is the other half of the reason they are
// one copy: a self-test that carries its own regex has no opinion about the code under test, and that
// mistake has been made twice in this repository already.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Every file under `<root>/<corpus>` with this extension, as a path RELATIVE to the root, sorted — so
// a finding's `file:line` reads the way a person would type it.
//
// `atLeast` IS NOT OPTIONAL, AND IT IS THE WHOLE POINT OF PASSING IT HERE. A gate whose corpus comes
// back empty reports zero findings and exits 0, which is indistinguishable from a clean tree — and
// only one of the five gates had a floor of its own, so a `walk` that matched nothing would have been
// caught by one and silently believed by four. Now the discovery is the one place it can be caught for
// all of them. The floor is a smoke alarm and not a target: set it far below the real count, because a
// floor near the true number fails the run the first time somebody legitimately deletes a file — which
// is the mistake two anti-vacuity floors in this repository already made, each failing a run FOR
// SUCCEEDING as its backlog cleared.
// A STORY IS NOT APPLICATION CODE, AND EVERY GATE HERE WOULD BELIEVE IT WAS.
//
// `check-class-budget.mjs` calls a class REFERENCED when its name appears as a token in
// `web/src/**/*.tsx`. Storybook's stories live beside the components they show, so without this a class
// used by nothing but a story reads as live — which is precisely the dead class that gate exists to find,
// and the workbench would have quietly switched off the check it was built to serve. The same argument
// holds for `check-name-resolution.mjs` (a story's className is not a surface's), for
// `check-shape-coverage.mjs` (a story is not an adoption site, and counting it inflates the ratio the
// censuses print) and for `check-radius-scale.mjs` (a `className` on a `<Button>` in a story is a
// demonstration, not a geometry decision a surface made).
//
// EXCLUDED IN THE ONE PLACE THE CORPUS IS DISCOVERED, rather than in five callers: `tools/lib/` exists
// because `lineOf` had four copies and `rulesOf` three, and one of those copies carried a bug the others
// had fixed. A rule about what the corpus IS belongs with the walk.
const STORY = '.stories.';

// A STYLESHEET MANIFEST IS NOT APPLICATION CODE EITHER, and it is excluded here for the same reason and
// in the same place. `web/src/styles.ts` is 50 bare `import './x/y.css';` lines, and every gate that
// counts a class name as REFERENCED when it appears as a token reads those paths as references: the
// specifier `'./organisms/dock/dock.css'` names `dock`, and 16 of the classes in this tree now have a
// stylesheet called after them. In `check-class-budget.mjs` that excuses a dead class — the ratchet
// would go green on a class whose last real consumer had gone — and in `check-layers.mjs` it produced 7
// findings of the form ".ap-chip read from web/src/styles.ts", which name a filename and cannot be
// acted on. Nothing in it declares or wears a class, so no gate loses a reader by its absence.
const MANIFEST = join('web', 'src', 'styles.ts');

export const walk = (root, corpus, ext, atLeast) => {
  const files = readdirSync(join(root, corpus), { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith(ext) && !entry.includes(STORY))
    .map((entry) => join(corpus, entry))
    .filter((file) => file !== MANIFEST)
    .sort();
  if (files.length < atLeast) {
    throw new Error(
      `walk(${corpus}, ${ext}) found ${files.length} file(s), against a floor of ${atLeast}. ` +
        `The corpus is missing, so any count taken from it is meaningless rather than clean.`,
    );
  }
  return files;
};

// Which line an offset is on, 1-based. Counted rather than derived from a split, because every caller
// blanks its comments to spaces instead of deleting them precisely so that offsets keep meaning lines.
export const lineOf = (text, offset) => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
};

// Source with its comments BLANKED — every character replaced by a space, so offsets still map to
// lines. Blanking rather than deleting is what keeps a finding's `file:line` correct.
//
// A class named only in a comment is not a reference, and that is the case this exists for: several
// comments in this repository name classes they have just removed, and a comment must not keep a rule
// alive. `[^:\w]` before `//` is what stops a URL in a string being read as a line comment.
export function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\w])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}
