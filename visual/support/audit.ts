import type { Page } from '@playwright/test';

// What the browser measures, and nothing else lives here.
//
// Every function named `pageXxx` below is SERIALISED AND EVALUATED IN THE PAGE, so it may not
// reference anything outside its own body — no imports, no module constants, no helper from a
// sibling function. That is why `visible` and `describe` appear more than once: a shared helper
// would be `undefined` by the time the page ran it. The audit is split into four of them rather
// than one because one function doing all four checks scored 53 on the cognitive-complexity gate,
// and raising the gate to fit it would have been the wrong repair.
//
// The reason any of this exists is in docs/design-system.md: every UI test today runs in jsdom,
// which has no layout engine, so it reports every box as zero by zero and an assertion about
// position compares zeroes and passes whatever the CSS does. A defect that shipped — one button
// rendering at 10.88px inside a 12.16px bar — was invisible to 2,000 green tests and obvious to one
// measurement in a real browser.

export interface Tally {
  [value: string]: number;
}

export interface Offender {
  // A path, not a selector: the point is for a person to find the element again, and `.tile > span`
  // matches forty things.
  where: string;
  detail: string;
}

interface Findings {
  examined: number;
  offenders: Offender[];
}

export interface StyleAudit {
  elements: number;
  textElements: number;
  fontSizes: Tally;
  fontSizesOnText: Tally;
  radii: Tally;
  // The six scale steps as the BROWSER resolves them, and the elements that compute something else.
  // Both come out of the same page walk as `fontSizes`, so the gate cannot disagree with the tally
  // printed beside it.
  scale: string[];
  type: Findings;
  // The four radius steps as the BROWSER resolves them, and the elements that compute something else.
  // Same construction as `scale`/`type` above and for the same reason: the pixel values are read back
  // out of the page, so this check cannot disagree with themes.css about what `--r-md` is.
  radiusScale: string[];
  radius: Findings;
  overflow: Findings;
  contrast: Findings;
  tokens: Findings;
  rows: Findings;
}

export interface FocusAudit {
  examined: number;
  // Present so the two numbers can be read together: an interactive element that cannot take focus
  // is not a finding, but a run where most of them could not would mean the board was not ready.
  unfocusable: number;
  offenders: Offender[];
}

// The six steps of docs/design-system.md, BY NAME. The pixel values are deliberately not written
// here: they are read back out of the page, so this check cannot disagree with themes.css about what
// `--t-body` is. A token whose value is wrong is drift's business; an element whose size is not on
// the scale at all is this one's.
export const TYPE_SCALE = [
  '--t-micro',
  '--t-small',
  '--t-body',
  '--t-lead',
  '--t-title',
  '--t-display',
] as const;

// The four radius steps of docs/design-system.md, BY NAME, for the reason the type scale is: the pixel
// values are read back out of the page, so this check cannot disagree with themes.css about them.
export const RADIUS_SCALE = ['--r-sm', '--r-md', '--r-lg', '--r-pill'] as const;

// THE ROOT IS THE UNIT, NOT A SURFACE, and every walk below skips it. Every step of both scales is
// expressed in `rem`, which is root-relative, so asking whether the root's own font-size is on the
// scale is circular — and "fixing" it to a step would rescale every rem in the stylesheet, including
// the steps themselves. It carries no text and no corner of its own.
//
// Type and radius counts. Every visible element, because every element computes a font size: an
// off-scale container hands its size to any descendant that does not set one, which is how 94
// elements sat on the UA's 16px default before Phase 2.
function pageBoxes(): { elements: number; fontSizes: Tally; radii: Tally } {
  const fontSizes: Tally = {};
  const radii: Tally = {};
  const bump = (tally: Tally, key: string): void => {
    tally[key] = (tally[key] ?? 0) + 1;
  };
  let elements = 0;
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el === document.documentElement) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    elements += 1;
    bump(fontSizes, style.fontSize);
    // All four corners, because a rule may round one and not the others.
    const corners = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ];
    for (const corner of corners) {
      if (corner !== '0px') bump(radii, corner);
    }
  }
  return { elements, fontSizes, radii };
}

// Type CONFORMANCE, which blocks as of Phase 2 — the phase that drove its count to zero. A separate
// walk from the tally above rather than a branch inside it, for the reason `pageContrast` is also its
// own walk: one function doing both scored 19 on the cognitive-complexity gate, and raising the gate
// to fit it would be the wrong repair. Two walks of 232 elements cost nothing measurable, and the
// caller asserts the two examined the same population so they cannot silently diverge.
//
// It names the offending ELEMENTS and not only the value. A blocking gate that says "13.6px is not on
// the scale" without saying where cannot be acted on, and a gate nobody can act on gets bypassed.
function pageType(names: string[]): { scale: string[]; type: Findings } {
  function describe(el: Element): string {
    const parts: string[] = [];
    for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
      const id = node.getAttribute('data-testid');
      const name = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : '';
      parts.unshift(`${node.tagName.toLowerCase()}${id ? `[${id}]` : name ? `.${name}` : ''}`);
    }
    return parts.join(' > ');
  }

  // The scale in the unit the elements report it in: a probe carrying `font-size: var(--t-x)` and
  // then measured — not the token's own `0.8125rem` text, which no computed style is ever equal to.
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  const scale = names.map((name) => {
    probe.style.fontSize = `var(${name})`;
    return getComputedStyle(probe).fontSize;
  });
  probe.remove();

  const offenders: Offender[] = [];
  let examined = 0;
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el === document.documentElement) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    examined += 1;
    if (!scale.includes(style.fontSize)) offenders.push({ where: describe(el), detail: style.fontSize });
  }
  return { scale, type: { examined, offenders } };
}

// Radius CONFORMANCE, which blocks as of Phase 3 — the phase that drove its count to zero. Its own
// walk for the same reason `pageType` is: one function doing both scored over the cognitive-complexity
// gate, and raising the gate to fit it would be the wrong repair.
//
// IT NAMES THE OFFENDING ELEMENTS AND NOT ONLY THE VALUE. Phase 2 learned that on the type check: a
// blocking gate that says "8px is not on the scale" without saying where cannot be acted on, and a gate
// nobody can act on gets bypassed. `8px` was on 56 corners when this was written and the first question
// anybody asks is which fourteen elements those were.
//
// `50%` IS ALLOWED AND IS NOT A STEP. A circle is a circle at any size, so a dot cannot be expressed as
// a length without knowing its width — `--r-pill`'s 999px would be a claim about a stadium. It is
// checked as a literal because there is no token to read back.
function pageRadius(names: string[]): { radiusScale: string[]; radius: Findings } {
  function describe(el: Element): string {
    const parts: string[] = [];
    for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
      const id = node.getAttribute('data-testid');
      const name = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : '';
      parts.unshift(`${node.tagName.toLowerCase()}${id ? `[${id}]` : name ? `.${name}` : ''}`);
    }
    return parts.join(' > ');
  }

  // The scale in the unit the elements report it in, measured off a probe rather than read out of the
  // token's own text — the same construction, and the same reason, as the type scale above.
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  const scale = names.map((name) => {
    probe.style.borderRadius = `var(${name})`;
    return getComputedStyle(probe).borderTopLeftRadius;
  });
  probe.remove();

  const offenders: Offender[] = [];
  let examined = 0;
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el === document.documentElement) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    examined += 1;
    // `0px` is not a radius: an element with square corners has made no claim about the scale. `50%`
    // is a circle and is allowed — see the header. Written as a filter rather than a nested loop with
    // a `continue`, because the complexity metric punishes NESTING far more than length.
    const off = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].filter((corner) => corner !== '0px' && corner !== '50%' && !scale.includes(corner));
    for (const corner of off) offenders.push({ where: describe(el), detail: corner });
  }
  return { radiusScale: scale, radius: { examined, offenders } };
}

// Overflow, and the font sizes of the elements that carry text. Split from the contrast walk below
// rather than sharing one pass: together they needed nine nested helpers and scored 17 on the
// cognitive-complexity gate, and the honest repair for that is fewer things in one function — not a
// higher ceiling. Two walks of 233 elements cost nothing measurable.
function pageOverflow(): { textElements: number; fontSizesOnText: Tally; overflow: Findings } {
  function describe(el: Element): string {
    const parts: string[] = [];
    for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
      const id = node.getAttribute('data-testid');
      const name = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : '';
      parts.unshift(`${node.tagName.toLowerCase()}${id ? `[${id}]` : name ? `.${name}` : ''}`);
    }
    return parts.join(' > ');
  }

  // Visible, and with text of ITS OWN. An element whose text lives in a child is not the element
  // that sets that text's size, and counting it would make every ancestor a finding about its
  // descendant.
  function eligible(el: Element, style: CSSStyleDeclaration): boolean {
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)
      return false;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()) return true;
    }
    return false;
  }

  const fontSizesOnText: Tally = {};
  const offenders: Offender[] = [];
  let textElements = 0;
  let examined = 0;
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const style = getComputedStyle(el);
    if (!eligible(el, style)) continue;
    textElements += 1;
    fontSizesOnText[style.fontSize] = (fontSizesOnText[style.fontSize] ?? 0) + 1;
    // `text-overflow: ellipsis` is a DELIBERATE statement that this text may be cut, so counting it
    // as an overflow fault would fill the list with the cases that are correct and bury the rest.
    if (style.textOverflow === 'ellipsis') continue;
    examined += 1;
    if (el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 1) continue;
    offenders.push({
      where: describe(el),
      detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
    });
  }
  return { textElements, fontSizesOnText, overflow: { examined, offenders } };
}

// Contrast, on the pairs the stylesheet actually forms. themes.css states measured ratios in prose;
// this is what pins them.
function pageContrast(): Findings {
  type Colour = [number, number, number, number];

  function describe(el: Element): string {
    const parts: string[] = [];
    for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
      const id = node.getAttribute('data-testid');
      const name = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : '';
      parts.unshift(`${node.tagName.toLowerCase()}${id ? `[${id}]` : name ? `.${name}` : ''}`);
    }
    return parts.join(' > ');
  }

  function eligible(el: Element, style: CSSStyleDeclaration): boolean {
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)
      return false;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()) return true;
    }
    return false;
  }

  function parse(value: string): Colour | null {
    const nums = value.match(/[\d.]+/g);
    if (!nums || nums.length < 3) return null;
    return [Number(nums[0]), Number(nums[1]), Number(nums[2]), nums.length > 3 ? Number(nums[3]) : 1];
  }

  function over(top: Colour, bottom: Colour): Colour {
    const a = top[3] + bottom[3] * (1 - top[3]);
    const mix = (i: number): number => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / (a || 1);
    return [mix(0), mix(1), mix(2), a];
  }

  // The ground the text is actually drawn on: the stack of backgrounds behind it, composited.
  // Reading only the element's own `background-color` is what makes a naive contrast check useless —
  // almost everything in this app is transparent and sits on a panel that sits on the theme wash.
  function ground(el: Element): Colour {
    const layers: Colour[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const colour = parse(getComputedStyle(node).backgroundColor);
      if (!colour || colour[3] === 0) continue;
      layers.push(colour);
      if (colour[3] > 0.999) break;
    }
    // Nothing opaque up the chain means the canvas shows through, and the canvas is white.
    let result: Colour = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i -= 1) result = over(layers[i], result);
    return result;
  }

  function ratio(fg: Colour, bg: Colour): number {
    const channel = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: Colour): number =>
      0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    const a = lum(fg);
    const b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  const offenders: Offender[] = [];
  let examined = 0;
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const style = getComputedStyle(el);
    if (!eligible(el, style)) continue;
    const fg = parse(style.color);
    // Transparent text is not a contrast question — it is the unresolved-token check's business.
    if (!fg || fg[3] === 0) continue;
    examined += 1;
    const bg = ground(el);
    // Composited on both sides, because an `--accent` at 70% over a panel is what the eye gets
    // rather than what the token says.
    const value = ratio(over(fg, bg), bg);
    if (value >= 4.5) continue;
    const ink = bg
      .slice(0, 3)
      .map((c) => Math.round(c))
      .join(', ');
    offenders.push({ where: describe(el), detail: `${value.toFixed(2)}:1 (${style.color} on rgb(${ink}))` });
  }
  return { examined, offenders };
}

// Unresolved custom properties. NOT "is the computed colour empty" — a `var()` that resolves to
// nothing makes the declaration invalid at computed-value time and the property falls back to what
// it inherited, which looks like a deliberate value. So the reference is checked against the
// definitions instead, which is the form that can actually fail.
function pageTokens(): Findings {
  function ruleText(): string[] {
    const texts: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) texts.push(rule.cssText);
      } catch {
        // A cross-origin sheet. This app has none, and one appearing must not be fatal.
      }
    }
    return texts;
  }
  const referenced = new Set<string>();
  const defined = new Set<string>();
  for (const text of ruleText()) {
    for (const hit of text.matchAll(/var\((--[\w-]+)/g)) referenced.add(hit[1]);
    for (const hit of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(hit[1]);
  }
  const elements = Array.from(document.querySelectorAll('*'));
  const offenders: Offender[] = [];
  const root = getComputedStyle(document.documentElement);
  for (const name of referenced) {
    if (root.getPropertyValue(name).trim()) continue;
    // Defined somewhere but not at the root is a SCOPED token, which is legitimate; defined nowhere
    // is the fault — `--warn` fell through to a hardcoded fallback that way before it existed.
    if (defined.has(name)) continue;
    // A token may also be supplied at RUN TIME: `--max-cols` arrives as an inline style from React,
    // so the grid's track count cannot disagree with the component's own column list. Flagging that
    // reported a correct design as a fault, which is how a check earns the reputation that gets it
    // switched off. A token supplied that way by a view this harness does not visit still lands in
    // the finding list — `--exec-cols` belongs to the Execution tab, and Phase 0 measures the board.
    // That is a gap in the harness's coverage, and it sits in the baseline as one rather than being
    // silently excluded.
    if (elements.some((el) => getComputedStyle(el).getPropertyValue(name).trim())) continue;
    offenders.push({
      where: name,
      detail: 'referenced by a rule, defined by no stylesheet and set by no element',
    });
  }
  return { examined: referenced.size, offenders };
}

// One line where one line is meant. A row is a flex container laying children out horizontally;
// "one line" means the band its children occupy is no taller than the tallest of them.
//
// Measured that way and NOT by comparing top edges: the first version compared rounded tops and
// reported 22 of 25 rows as wrapped, because `align-items: center` gives children of different
// heights different tops. It was measuring vertical centring and calling it wrapping.
function pageRows(): Findings {
  function describe(el: Element): string {
    const id = el.getAttribute('data-testid');
    const name = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : name ? `.${name}` : ''}`;
  }
  const offenders: Offender[] = [];
  let examined = 0;
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const style = getComputedStyle(el);
    if (style.display !== 'flex' && style.display !== 'inline-flex') continue;
    if (!style.flexDirection.startsWith('row')) continue;
    const boxes = Array.from(el.children)
      .map((child) => child.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    if (boxes.length < 3) continue;
    examined += 1;
    const band = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
    const tallest = Math.max(...boxes.map((b) => b.height));
    if (band > tallest + 1) {
      offenders.push({
        where: describe(el),
        detail: `${boxes.length} children span ${band.toFixed(1)}px, tallest is ${tallest.toFixed(1)}px`,
      });
    }
  }
  return { examined, offenders };
}

// Focus, which cannot be read off a static tree: `:focus-visible` only applies to a focused element,
// so each one has to be focused and measured against itself unfocused.
//
// The caller presses Tab first. Chromium matches `:focus-visible` on a programmatic focus only when
// the most recent interaction was a keypress, so without that every element in the app reports no
// focus style — and a check that fails everywhere is as uninformative as one that passes everywhere.
function pageFocus(): FocusAudit {
  const SELECTOR =
    'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]';
  const PROPS = [
    'outlineStyle',
    'outlineWidth',
    'outlineColor',
    // `outlineOffset` is DELIBERATELY NOT HERE, and leaving it in made this check vacuous. The app's
    // focus rules set both `outline` and `outline-offset`, so a planted `outline: none !important`
    // still changed the offset — an invisible property, since there is no outline to offset — and
    // every one of the 55 elements went on reporting a focus style it no longer had.
    'boxShadow',
    'borderTopColor',
    'borderBottomColor',
    'borderTopWidth',
    'backgroundColor',
    'color',
    'textDecorationLine',
  ] as const;

  function describe(el: Element): string {
    const id = el.getAttribute('data-testid');
    const name = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : name ? `.${name}` : ''}`;
  }

  function snapshot(el: Element): string {
    const style = getComputedStyle(el);
    return PROPS.map((prop) => style[prop]).join('|');
  }

  function candidate(el: Element): el is HTMLElement {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  const offenders: Offender[] = [];
  let examined = 0;
  let unfocusable = 0;
  // The caller's Tab press left something focused, and an element measured while it already holds
  // focus reports its focused style as its RESTING style — so it looks as though nothing changed.
  // That exact false positive named `.conn-status`, first in the tab order, as the app's one element
  // with no focus style.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

  for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
    if (!candidate(el)) continue;
    const before = snapshot(el);
    el.focus();
    // A DISABLED control cannot take focus, so `focus()` is a no-op and the two snapshots are
    // trivially equal. Counting those as findings reported a disabled button as having no focus
    // style; counting them as examined would inflate the floor with elements nothing measured.
    if (document.activeElement !== el) {
      unfocusable += 1;
      continue;
    }
    examined += 1;
    const after = snapshot(el);
    const matched = el.matches(':focus-visible');
    el.blur();
    if (before !== after) continue;
    offenders.push({
      where: describe(el),
      detail: matched ? 'focus-visible matched but no property changed' : 'no focus-visible style',
    });
  }
  return { examined, unfocusable, offenders };
}

// The document must not scroll sideways. Asserted at three widths because the board's columns are a
// shared grid and the dock is a definite height: those widths are where the two decisions meet.
function pageDocument(): { scrollWidth: number; clientWidth: number } {
  const el = document.documentElement;
  return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
}

// The four page walks, composed here in node rather than in the page, so each in-page function stays
// small enough to read and to score under the complexity gate.
export async function auditStyles(page: Page): Promise<StyleAudit> {
  const boxes = await page.evaluate(pageBoxes);
  const type = await page.evaluate(pageType, [...TYPE_SCALE]);
  const radius = await page.evaluate(pageRadius, [...RADIUS_SCALE]);
  const text = await page.evaluate(pageOverflow);
  const contrast = await page.evaluate(pageContrast);
  const tokens = await page.evaluate(pageTokens);
  const rows = await page.evaluate(pageRows);
  return { ...boxes, ...type, ...radius, ...text, contrast, tokens, rows };
}

export async function auditFocus(page: Page): Promise<FocusAudit> {
  return page.evaluate(pageFocus);
}

export async function documentOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(pageDocument);
}
