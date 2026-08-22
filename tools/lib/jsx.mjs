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

// ---------- what a `className` names ----------
// ONE READER, because two gates ask the same question of it from opposite directions:
// `check-shape-coverage.mjs` wants the call site of a class it found in the CSS, and
// `check-name-resolution.mjs` wants every class named in the code so it can ask whether the CSS
// defines it. Two copies would be two things to break, and only one of them would get planted at.

// The braced expression after `className=`, brace-matched. Scoped to the ATTRIBUTE'S OWN VALUE and not
// to the rest of the tag, because a `title="two words"` in the same tag would otherwise contribute two
// class names that do not exist.
function bracedAt(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(from + 1, i);
    }
  }
  return '';
}

// A `${…}` hole is blanked: a composed name cannot be resolved here, and the half that survives ends in
// `-`, which is what tells a caller it is a PREFIX rather than a whole name.
const tokensOf = (text) =>
  text
    .replace(/\$\{[^}]*\}/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

// A STRING BEING COMPARED IS A VALUE, NOT A CLASS, and this line was written because the reader
// reported `.rail` as a class named at `molecules/Field.tsx` — the operand of `layout === 'rail'` in the
// ternary that CHOOSES the class list. A gate reading code → CSS then had a finding that was an artefact
// of its own parser rather than anything in the tree. Blanked rather than dropped, so offsets keep
// meaning lines, and both orders, because `'x' === y` is the same expression written the other way.
const blankComparisons = (text) =>
  text
    .replace(/([=!]==?\s*)(['"])[^'"\n]*\2/g, (m, lead) => lead + ' '.repeat(m.length - lead.length))
    .replace(/(['"])[^'"\n]*\1(?=\s*[=!]==?)/g, (m) => ' '.repeat(m.length));

// ANY `…ClassName=` ATTRIBUTE, not only `className=`, and the widening is the whole reason the
// `.conn-pop` defect could exist: a class handed to a COMPONENT through a prop of its own is still a
// class on an element. `Popover` takes `triggerClassName`, and `.conn-status` and `.ap-agent-state`
// reach the DOM through it — invisible to a reader anchored on the exact string `className=`.
const CLASS_ATTR = /\b\w*[cC]lassName=/g;

// The class tokens named anywhere in one `…ClassName=`'s value, whatever shape the expression is. A
// plain string, a template literal, and a TERNARY — `.popover`'s own call site is
// `className={className ? `popover ${className}` : 'popover'}`, and a reader that only understood the
// first two forms reported that rule as having no call site at all.
//
// `from` is the offset of the VALUE, not of the attribute name: the first version added
// `'className='.length` to the attribute's own index, which is wrong by eight characters for
// `triggerClassName=` and reads the value from the middle of the name.
export function classNameTokens(code, from) {
  if (code[from] === '"') return tokensOf(code.slice(from + 1, code.indexOf('"', from + 1)));
  if (code[from] !== '{') return [];
  // Every string in the expression, whichever branch of a ternary it is in.
  return [...blankComparisons(bracedAt(code, from)).matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].flatMap(
    (m) => tokensOf(m[1] ?? m[2] ?? m[3] ?? ''),
  );
}

// The class tokens in one opening tag's class attributes, through the SAME reader the call-site lookup
// uses — so a class reaching a primitive through a ternary is not visible to one and invisible to the
// other.
export function classesInTag(attrs) {
  return [...attrs.matchAll(CLASS_ATTR)].flatMap((m) => classNameTokens(attrs, m.index + m[0].length));
}

// class name -> every `file:line` whose `className` names it, first one first.
//
// SCOPED TO `className` AND NOT A BARE TOKEN GREP, and the first version was the bare grep. It reported
// `.markdown code` as used at `cards/CardView.tsx:1`, which is the `markdown` MODULE in an import
// statement — a search that matched something other than what it claimed.
export function classSites(sources) {
  const sites = new Map();
  for (const { file, code } of sources) {
    for (const m of code.matchAll(CLASS_ATTR)) {
      const at = `${file}:${lineOf(code, m.index)}`;
      for (const cls of classNameTokens(code, m.index + m[0].length)) {
        if (!sites.has(cls)) sites.set(cls, []);
        if (!sites.get(cls).includes(at)) sites.get(cls).push(at);
      }
    }
  }
  return sites;
}
