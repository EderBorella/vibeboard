#!/usr/bin/env node
//
// Every `font-size` authored in web/src/*.css must be one of the six steps of the type scale, and no
// `gap` or `padding` may sit in the 0.25–0.6rem band the space scale replaced.
//
// Run it with: npm run check:type-scale
//
// WHY THIS EXISTS BESIDE THE BROWSER GATE, WHICH ALREADY ASSERTS THE SAME THING.
//
// It does not assert the same thing. `npm run visual` measures COMPUTED font sizes on the board, and
// Phase 0 found 15 of them against 27 authored in the stylesheet. The other twelve live on surfaces
// the harness never visits — the Execution tab, settings, drawers, card panes, the dock's other
// states — so a browser gate alone cannot verify "27 became 6": it would pass with a dozen off-scale
// values still in the file, and the sweep in Phase 5 would then find them by hand.
//
// So the two gates make different claims and both are needed:
//   the harness  — "nothing the eye can reach on the board is off the scale", including sizes no rule
//                  authored (a UA default on a control, an inherited size from a container).
//   this check   — "nothing in the FILE is off the scale", including surfaces no test opens.
// Neither subsumes the other. This one cannot see an element that never names a size; that one cannot
// see a rule it never renders.
//
// It is BLOCKING and at zero, because it is a claim about a file rather than about a backlog.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
// The scale's definitions live here, and the six names are checked AGAINST it rather than merely
// looking right: `var(--t-bdoy)` matches any `--t-*` pattern, resolves to nothing, and makes the
// declaration invalid at computed-value time — so the element silently inherits and the file passes a
// check that only ever read the shape of the name.
const TOKENS_FILE = 'web/src/themes.css';
const TYPE_SCALE = ['--t-micro', '--t-small', '--t-body', '--t-lead', '--t-title', '--t-display'];

// The band Phase 2 closed, in rem. Below 0.25rem the nearest step is a 2–6x change on what is a
// hairline rather than a space, and above 0.6rem is a band this phase does not claim; both are
// deliberately out of scope and NOT silently allowed — see the report for what remains.
const SPACE_BAND = { lo: 0.25, hi: 0.6 };

// A VALUE MAY BE OFF THE SCALE ON PURPOSE, and then it is written here with its reason rather than
// left to be rediscovered. Empty is the honest state today: all 27 authored sizes mapped onto a step.
// A relative unit is the case to expect — `em` has no fixed pixel value, so "nearest step" is not
// defined for it and the judgement has to be recorded by a person.
/** @type {Map<string, string>} */
const OFF_SCALE_ON_PURPOSE = new Map([
  [
    'inherit',
    'On the scale BY CONSTRUCTION rather than by exception: it defers to the ancestor, and every ' +
      'ancestor that names a size is checked here, with the chain terminating at `body`, which names ' +
      '`--t-body`. Used by the form-control reset at the top of styles.css, which exists to stop a ' +
      "control taking the UA's off-scale 13.3333px.",
  ],
]);

// `font: 14px/1.2 sans-serif` SETS A FONT SIZE AND THE PATTERN ABOVE CANNOT SEE IT — the shorthand is
// the way round this check, so it is closed here rather than left as a hole. `font: inherit` and
// `font: 400 …` carry no length and are fine; the file uses the former in a dozen places deliberately.
const FONT_SHORTHAND = /(?:^|[;{\s])font:([^;}]*)/g;
const LENGTH = /\d*\.?\d+(?:px|rem|em|pt|%)/;

// The floors. A REGEX THAT STOPS MATCHING IS THE FAILURE MODE OF A CHECK LIKE THIS: it reports zero
// findings, exits 0, and looks exactly like success. Reformatting the stylesheet (which Phase 2 also
// did, taking it from 1,980 lines to 4,347) is precisely the kind of change that could do it. Set well
// under what the file holds, so they catch "matched nothing" and not ordinary editing.
const FLOOR = { fontSize: 150, space: 150 };

const cssFiles = () =>
  readdirSync(join(ROOT, CORPUS), { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.css'))
    .map((entry) => join(CORPUS, entry))
    .sort();

// The tokens the stylesheet actually defines, so a name can be resolved and not merely recognised.
const defined = () => {
  const text = readFileSync(join(ROOT, TOKENS_FILE), 'utf8');
  return new Set([...text.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
};

const lineOf = (text, offset) => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
};

const FONT_SIZE = /font-size:\s*([^;}]+?)\s*(?=[;}])/g;
// `gap` and its long forms, and `padding` and its sides. Anchored on a boundary so `--tile-gap:` and
// `grid-template-columns:` cannot match.
const SPACE = /(?:^|[;{\s])(gap|row-gap|column-gap|padding(?:-top|-right|-bottom|-left)?):([^;}]*)/g;
const REM = /(\d*\.?\d+)rem/g;

const known = defined();
/** @type {{ site: string, detail: string }[]} */
const findings = [];
let fontSizes = 0;
let spaces = 0;

for (const file of cssFiles()) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const site = (offset) => `${file}:${lineOf(text, offset)}`;

  for (const match of text.matchAll(FONT_SIZE)) {
    fontSizes += 1;
    const value = match[1];
    if (OFF_SCALE_ON_PURPOSE.has(value)) continue;
    const token = /^var\((--t-[\w-]+)\)$/.exec(value)?.[1];
    if (!token) {
      findings.push({ site: site(match.index), detail: `font-size: ${value} — not a step on the scale` });
    } else if (!TYPE_SCALE.includes(token)) {
      findings.push({
        site: site(match.index),
        detail: `font-size: var(${token}) — not one of the six steps`,
      });
    } else if (!known.has(token)) {
      findings.push({
        site: site(match.index),
        detail: `font-size: var(${token}) — defined in no stylesheet`,
      });
    }
  }

  for (const match of text.matchAll(FONT_SHORTHAND)) {
    if (!LENGTH.test(match[1])) continue;
    findings.push({
      site: site(match.index),
      detail: `font:${match[1]} — the shorthand sets a font size; name the step with font-size instead`,
    });
  }

  for (const match of text.matchAll(SPACE)) {
    spaces += 1;
    for (const length of match[2].matchAll(REM)) {
      const rem = Number(length[1]);
      if (rem < SPACE_BAND.lo || rem > SPACE_BAND.hi) continue;
      findings.push({
        site: site(match.index),
        detail: `${match[1]}: ${length[0]} — inside the ${SPACE_BAND.lo}–${SPACE_BAND.hi}rem band the space scale replaced`,
      });
    }
  }
}

console.log(
  `type scale: ${fontSizes} font-size and ${spaces} gap/padding declaration(s) across ${cssFiles().length} file(s) in ${CORPUS}`,
);

// Before the findings, because a green run on a regex that matched nothing is the worse failure.
for (const [what, seen, floor] of [
  ['font-size', fontSizes, FLOOR.fontSize],
  ['gap/padding', spaces, FLOOR.space],
]) {
  if (seen >= floor) continue;
  console.error(`\nonly ${seen} ${what} declaration(s) found, against a floor of ${floor}.`);
  console.error(`This check is vacuous: the pattern has stopped matching the stylesheet. Fix the`);
  console.error(`pattern in tools/check-type-scale.mjs — do NOT lower the floor.`);
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n${findings.length} declaration(s) off the scale:\n`);
  for (const { site, detail } of findings) console.error(`  ${site} — ${detail}`);
  console.error(`\nGive each one the nearest step: --t-micro 11px, --t-small 12px, --t-body 13px,`);
  console.error(`--t-lead 15px, --t-title 18px, --t-display 24px; --s-1 2px … --s-7 24px.`);
  console.error(`Do NOT add a step. If a surface looks wrong on the nearest one, the surface is wrong —`);
  console.error(`see docs/design-system.md. A value that is off the scale ON PURPOSE goes in`);
  console.error(`OFF_SCALE_ON_PURPOSE with its reason.`);
  process.exit(1);
}

console.log(
  `all ${fontSizes} font-size declarations are one of the ${TYPE_SCALE.length} steps; the ${SPACE_BAND.lo}–${SPACE_BAND.hi}rem gap/padding band is empty`,
);
