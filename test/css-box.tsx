// THE BOX A CLASS LIST DRAWS, resolved out of the stylesheets rather than out of a browser.
//
// jsdom LOADS NO CSS and computes no cascade — `getComputedStyle` answers '' whatever the rule says —
// so the sheets are read from source and `el.matches()` does the selector work. Extracted from
// test/panel-boxes.test.tsx when test/field-boxes.test.tsx needed the same instrument: two copies of a
// cascade resolver is two things to get wrong, and `applies` below was wrong once already in a way
// that made one claim red and an identical one green.
//
// Its own correctness is asserted in test/panel-boxes.test.tsx, under *the cascade helper separates a
// state from the resting style* — the helper's two directions, on a rule that declares the same
// property at rest and on hover.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB = join(process.cwd(), 'web', 'src');
// PRIMITIVES FIRST, exactly as main.tsx imports them: a surface may override a primitive's colour at
// equal specificity, so source order is what decides. Reading them the other way round would report
// the primitive's value where the surface's is what renders.
const SHEETS = ['ui/primitives.css', 'styles.css'].map((f) => readFileSync(join(WEB, f), 'utf8'));

// The scale tokens, resolved to the pixel values themes.css gives them, so a rule that moves from
// `var(--radius)` to `var(--r-lg)` reads as the same 10px it renders as. Colour tokens are left as
// names: `--panel` is a different colour in each theme and the token IS the claim.
const TOKENS = new Map(
  [...readFileSync(join(WEB, 'themes.css'), 'utf8').matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)]
    .filter(([, name]) => /^--(t|s|r)-|^--radius$/.test(name))
    .map(([, name, value]) => [name, value.trim()]),
);

interface Rule {
  selector: string;
  body: string;
}

// Brace-matched rather than regex-split, because @media/@container/@supports nest and a flat regex
// reads their prelude as a selector — the same reason tools/check-radius-scale.mjs matches braces.
function rules(text: string): Rule[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const stack: { selector: string; start: number }[] = [];
  let from = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (c === '{') stack.push({ selector: clean.slice(from, i).trim(), start: i + 1 });
    else if (c === '}') {
      const open = stack.pop();
      if (open) out.push({ selector: open.selector, body: clean.slice(open.start, i) });
      from = i + 1;
    } else if (c === ';') from = Math.max(from, i + 1);
  }
  // At-rule preludes are not selectors; their inner rules are already in `out` from the brace scan.
  return out.filter((r) => r.selector !== '' && !r.selector.startsWith('@'));
}

const ALL = SHEETS.flatMap(rules);

export function resolve(value: string): string {
  return value.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => TOKENS.get(name) ?? whole);
}

// `:hover` and `:disabled` cannot be asked of an element that is not under a pointer, so the state
// is named instead: `box(el, ':hover')` takes the base rules PLUS the `:hover` ones and nothing else.
//
// A RULE'S STATES MUST BE A SUBSET OF THE ONE ASKED FOR, and that is the part that has to be exact.
// The first version stripped the pseudo-class out and matched what was left, so every `:hover` rule
// applied at rest: `.control-item`'s hover ground read as its RESTING ground and "a list row has no
// ground" went red, while the same bug made the identical claim pass on `.report-open` for the wrong
// reason. Both answers were wrong and only one of them was red.
const STATES = /:(hover|disabled|focus-visible|focus|first-child|last-child|last-of-type)/g;

// A `:not()` WHOSE CONTENT IS A STATE IS DROPPED; ANY OTHER `:not()` IS KEPT, and the distinction was
// forced by a planted premise rather than reasoned in. The first version dropped every `:not()` before
// matching — right for `:hover:not(:disabled)`, where the inner `:disabled` would otherwise count as a
// second state and the rule would apply to nothing — and it therefore also dropped
// `.vb-field input:not([type='checkbox']):not([type='radio']):focus`, so this resolver reported a
// checkbox in a Field as taking `outline: none`. That is exactly the defect Phase 6 fixed by writing
// those two exclusions, and the instrument that is supposed to assert the fix could not see it.
const stateOnlyNot =
  /:not\(\s*:(?:hover|disabled|focus-visible|focus|first-child|last-child|last-of-type)\s*\)/g;

function applies(el: Element, selector: string, state: string): boolean {
  // State scan first, with every `:not()` out of the way, for the reason above.
  if ([...selector.replace(/:not\([^)]*\)/g, '').matchAll(STATES)].some((m) => m[0] !== state)) return false;
  return safeMatches(el, selector.replace(stateOnlyNot, '').replace(STATES, '').trim());
}

function safeMatches(el: Element, selector: string): boolean {
  if (selector === '') return false;
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

// A COARSE SPECIFICITY, and it is not decoration: it was added because a flat source-order flatten got
// a real answer wrong. `button, input, select, textarea { font-size: inherit }` lives in styles.css,
// which is loaded AFTER ui/primitives.css — so once the input box moved into the primitive, source order
// alone reported every text box in the app as `font-size: inherit`, while the browser gives the class
// (0,1,0) the win over the type selector (0,0,1). Ids, then classes/attributes/pseudo-classes, then
// elements; equal specificity falls back to source order, which is the rule the cascade really uses.
function specificity(selector: string): number {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes =
    (selector.match(/\.[\w-]+/g)?.length ?? 0) +
    (selector.match(/\[[^\]]*\]/g)?.length ?? 0) +
    (selector.match(/:(?!:)[\w-]+/g)?.length ?? 0);
  const elements = selector.replace(/[.#[][^\s>+~]*/g, ' ').match(/[a-zA-Z][\w-]*/g)?.length ?? 0;
  return ids * 10_000 + classes * 100 + elements;
}

// Every declaration that reaches `el` through a selector that matches it, resolved by specificity and
// then by source order, flattened so the winning value for a property is the one left.
export function box(el: Element, state = ''): Record<string, string> {
  const winners: { spec: number; order: number; body: string }[] = [];
  for (const [order, rule] of ALL.entries()) {
    const matched = rule.selector
      .split(',')
      .filter((sel) => applies(el, sel.trim(), state))
      .map((sel) => specificity(sel.trim()));
    if (matched.length === 0) continue;
    winners.push({ spec: Math.max(...matched), order, body: rule.body });
  }
  winners.sort((a, b) => a.spec - b.spec || a.order - b.order);
  const out: Record<string, string> = {};
  for (const { body } of winners) {
    for (const decl of body.split(';')) {
      const at = decl.indexOf(':');
      if (at < 0) continue;
      out[decl.slice(0, at).trim()] = resolve(decl.slice(at + 1).trim());
    }
  }
  return out;
}
