// The JSX opening-tag reader the gates share. See `tools/lib/source.mjs` for why this directory exists.

import { lineOf } from './source.mjs';

// The end of an element's opening tag: the first `>` outside any `{}`. A naive `indexOf('>')` stops
// inside `onClick={() => x > 1 && go()}` and reads half a tag, which silently loses every `className`
// written after a handler — not hypothetical, it is what forced this function into existence.
export function openTagEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

// Every opening tag of `tag` in `text`, as `{ index, attrs, line }`. A tag whose `>` cannot be found is
// dropped rather than read half-way.
//
// `(?![\w-])` and not `\b`: `\b` would let `<Button` match `<ButtonRow` and `<Field` match `<Fieldset`,
// which would sweep unrelated components into a census. The next character must not continue the name.
export function openTagsOf(text, tag) {
  return [...text.matchAll(new RegExp(`${tag}(?![\\w-])`, 'g'))]
    .map((open) => ({ open: open.index, end: openTagEnd(text, open.index + tag.length) }))
    .filter(({ end }) => end >= 0)
    .map(({ open, end }) => ({ index: open, attrs: text.slice(open, end), line: lineOf(text, open) }));
}
