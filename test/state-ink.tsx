// THE COLOUR A STATE ACTUALLY RENDERS AS, in a named theme, resolved through `--tone`.
//
// Extracted from test/chip-boxes.test.tsx when test/state-inks.test.tsx needed the same instrument —
// the same reason test/css-box.tsx was extracted from test/panel-boxes.test.tsx: two copies of a
// resolver is two things to get wrong, and that file records a case where its own copy was wrong in a
// way that made one claim red and an identical one green.
//
// WHY IT IS NEEDED AT ALL, AND WHY `box()` IS NOT ENOUGH. Phase 13 put one custom property between a
// surface and its colour: a rule says `color: var(--tone)` and five `.vb-tone-*` rules say what `--tone`
// is. So `box(el).color` is the SAME STRING for every state on every surface — which is the point, and
// which makes a test comparing declaration strings blind to the difference it exists to measure. The
// tone has to be resolved out of the element's own cascade, and it INHERITS, so the walk goes up the
// ancestors: the connection light sets `--tone` on the wrapper and the dot inside it takes the fill.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { box } from './css-box.js';

export const THEMES = ['cyberpunk', 'marshmallow', 'classic-dark'];

// The palettes only. Geometry left this file for design/tokens.css in Phase 1 of
// notes/atomic-revamp-plan.md, and a colour resolver has no business reading it.
const THEMES_CSS = readFileSync(join(process.cwd(), 'web', 'src', 'design', 'themes.css'), 'utf8');

// The palette a theme really has: `:root` carries the shared block and each `[data-theme=…]` overrides
// it, exactly as the cascade does.
export function paletteOf(theme: string): Map<string, string> {
  const vars = new Map<string, string>();
  const clean = THEMES_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1];
    const shared = /(^|,)\s*:root\s*(,|$)/.test(selector);
    if (!shared && !selector.includes(`[data-theme="${theme}"]`)) continue;
    for (const decl of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) vars.set(decl[1], decl[2].trim());
  }
  return vars;
}

// `var(--warn, #b8860b)` is one of these: a fallback is taken only when the name is undefined, which is
// the browser's rule. The nested-parenthesis alternation in the fallback group is load-bearing — the
// live declarations are `var(--tone, var(--muted))` and `var(--tone, var(--border))`, and a `[^)]*`
// fallback group stops at the INNER `)` and leaves a stray bracket in the answer.
export function resolveColour(value: string, ...scopes: Map<string, string>[]): string {
  let out = value;
  for (let i = 0; i < 8 && out.includes('var('); i += 1) {
    out = out.replace(
      /var\((--[\w-]+)(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g,
      (whole, name: string, fallback?: string) => {
        for (const scope of scopes) {
          const defined = scope.get(name);
          if (defined !== undefined) return defined;
        }
        return fallback ?? whole;
      },
    );
  }
  return out;
}

// Every custom property in scope for this element: its own, then each ancestor's, nearest first —
// which is what inheritance does. `document.body` is the stop, as in test/css-box.tsx's own callers.
export function scopeOf(el: Element): Map<string, string> {
  const scope = new Map<string, string>();
  for (let node: Element | null = el; node && node.tagName !== 'BODY'; node = node.parentElement) {
    for (const [prop, value] of Object.entries(box(node))) {
      if (prop.startsWith('--') && !scope.has(prop)) scope.set(prop, value);
    }
  }
  return scope;
}

// THE TOKEN A CHIP'S INK NAMES, without resolving it to a hex. Used where the claim is about which
// token the surface reaches — `.tile-setup` takes the accent and `.tile-problem` takes danger — rather
// than about what that token is worth in a particular palette. `--tone` first: a toned element's `color`
// is always `var(--tone)`, so the token is one level down.
export function inkToken(el: Element, property = 'color'): string {
  const drawn = box(el);
  const declared = drawn[property] ?? '';
  return declared.includes('var(--tone') ? (drawn['--tone'] ?? declared) : declared;
}

// `color` INHERITS AND THE OTHERS DO NOT, and the distinction is why this is a list rather than a
// boolean on every property. `.conn-text` declares a width and a `white-space` and no colour at all:
// the ink is `.conn-status`'s, set once on the wrapper so the pip and the word are tinted together,
// which is the construction nine deleted rules agreed about. A resolver that stopped at the element
// answered `<none>` for the word and made four of the five tones unmeasurable.
//
// A `background` or a `border-left-color` genuinely does not inherit: an ancestor's fill is not this
// element's fill, and walking up would report the panel behind a dot as the dot's colour.
const INHERITS = ['color'];

// A `-color` LONGHAND MAY BE WRITTEN AS A SHORTHAND, and two of the nine roles are: `.ap-bar` and
// `.filed-entry` say `border-left: 3px solid var(--tone, var(--border))` in one declaration, where the
// twenty-six rules they replaced each set `border-left-color` on its own. `box()` flattens declarations
// by name and has no opinion about shorthands, so asking for the longhand answered `<none>` — which the
// callers' anti-vacuity guard caught, and which would otherwise have made the rail's tone unmeasurable
// on the two surfaces where it is the whole statement of the state.
//
// The colour is what is left after a width and a style keyword. Sliced off the FRONT rather than taken
// from the back, because a `var()` contains spaces and a last-token split cuts it in half.
const SHORTHAND: Record<string, string> = {
  'border-left-color': 'border-left',
  'border-color': 'border',
};

function colourInShorthand(value: string): string | undefined {
  const rest = value
    .trim()
    .replace(/^[\d.]+(?:px|rem|em)\s+/, '')
    .replace(/^(?:solid|dashed|dotted|none|hidden|double|groove|ridge|inset|outset)\s+/, '')
    .trim();
  return rest === '' ? undefined : rest;
}

// THE RESOLVED COLOUR, in a theme. `#rrggbb` for anything the palette defines; whatever was declared
// for anything it does not, which is what the anti-vacuity assertions in the callers check for.
export function inkIn(el: Element, theme: string, property = 'color'): string {
  const scope = scopeOf(el);
  const drawn = box(el);
  let declared: string | undefined = drawn[property];
  const shorthand = SHORTHAND[property];
  if (declared === undefined && shorthand !== undefined && drawn[shorthand] !== undefined) {
    declared = colourInShorthand(drawn[shorthand]);
  }
  if (declared === undefined && INHERITS.includes(property)) {
    for (let node = el.parentElement; node && node.tagName !== 'BODY'; node = node.parentElement) {
      declared = box(node)[property];
      if (declared !== undefined) break;
    }
  }
  if (declared === undefined) return '<none>';
  return resolveColour(declared, scope, paletteOf(theme));
}

// Does this look like a colour a browser could paint? An unresolved `var(--x)` compares unequal to
// another unresolved one, so a resolver that silently stopped working would report every state as a
// distinct colour and every distinctness claim would pass. Asserted BEFORE any comparison in every
// caller, for that reason.
export const isColour = (value: string): boolean => /^#[0-9a-fA-F]{3,8}$|^rgb|^color-mix\(/.test(value);
