// The stylesheet parser the gates share. See `tools/lib/source.mjs` for why this directory exists.

import { lineOf } from './source.mjs';

// Every rule in a stylesheet, as `{ file, line, selector, body }`. Brace-MATCHED rather than
// regex-split, because `@media`/`@container`/`@supports` nest and a flat regex reads their prelude as a
// selector.
//
// Comments are BLANKED and not removed, so every offset still maps to its real line — the repair
// `check-type-scale.mjs` needed after it read a comment's prose as a declaration and reported
// `.cv-links { display: flex` as a font size.
//
// THE SELECTOR CURSOR IS RESET AT `{` AS WELL AS AT `}` AND `;`, and that line is load-bearing: without
// it a rule nested in an at-rule carries the at-rule's prelude glued to the front of its own selector,
// which hides it from any test anchored on `.name`, and the at-rule's own body — which contains every
// declaration nested inside it — is scanned a second time as a rule of its own. Both halves were live in
// `check-radius-scale.mjs` until Phase 10; `check-shape-coverage.mjs` had fixed its copy in Phase 7.
export function rulesOf(file, raw) {
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const stack = [];
  let selStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') {
      stack.push({ selector: text.slice(selStart, i).trim(), start: i + 1 });
      selStart = i + 1;
    } else if (c === '}') {
      const open = stack.pop();
      if (open) {
        out.push({
          file,
          line: lineOf(text, open.start),
          selector: open.selector,
          body: text.slice(open.start, i),
        });
      }
      selStart = i + 1;
    } else if (c === ';') selStart = Math.max(selStart, i + 1);
  }
  return out;
}

// The rules that DRAW something. An at-rule's own body text contains every rule nested inside it, so
// counting the prelude as well as its children reports the same declaration twice; dropping the prelude
// counts each one exactly once, wherever it sits.
export const shapedRules = (ruleList) => ruleList.filter((rule) => !rule.selector.startsWith('@'));

// The class tokens named in one selector.
export const classesOf = (selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
