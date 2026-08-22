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
  // THE HOLE IN `overflow`, CLOSED. See `pageClipping`.
  clipping: Findings;
  contrast: Findings;
  tokens: TokenFindings;
  rows: Findings;
}

// The token check's own findings, plus what it EXCUSED and why it could. See RUN_TIME_TOKENS.
export interface TokenFindings extends Findings {
  // The run-time tokens this surface did not measure, because the view that supplies each one is not
  // on it. Returned rather than swallowed: the surface that OWNS a token asserts its own name is
  // absent from this list, which is what stops the excuse becoming a licence.
  excused: string[];
}

export interface FocusAudit {
  examined: number;
  // Present so the two numbers can be read together: an interactive element that cannot take focus
  // is not a finding, but a run where most of them could not would mean the board was not ready.
  unfocusable: number;
  offenders: Offender[];
}

// The FIVE steps of docs/design-system.md, BY NAME. The pixel values are deliberately not written
// here: they are read back out of the page, so this check cannot disagree with design/tokens.css about
// what `--t-body` is. A token whose value is wrong is drift's business; an element whose size is not on
// the scale at all is this one's.
//
// `--t-display` WAS THE SIXTH AND IS GONE. It carried one consumer — a markdown `h1` — and not the one
// it was named for, so the heading ladder in atoms/prose.css slid down onto the three steps below it.
// Removing the NAME here narrows this check: a 24px computed size is now a finding, which is the point.
export const TYPE_SCALE = ['--t-micro', '--t-small', '--t-body', '--t-lead', '--t-title'] as const;

// The four radius steps of docs/design-system.md, BY NAME, for the reason the type scale is: the pixel
// values are read back out of the page, so this check cannot disagree with themes.css about them.
export const RADIUS_SCALE = ['--r-sm', '--r-md', '--r-lg', '--r-pill'] as const;

// THE ROOT IS THE UNIT, NOT A SURFACE, and every walk below skips it. Every step of both scales is
// expressed in `rem`, which is root-relative, so asking whether the root's own font-size is on the
// scale is circular — and "fixing" it to a step would rescale every rem in the stylesheet, including
// the steps themselves. It carries no text and no corner of its own.
//
// WHICH SURFACE IS BEING MEASURED. `null` is the whole document, which is what every check measured
// before Phase 6 and is what the four top-level views still measure — a view IS the page.
//
// A selector is given for the four surfaces that are OVERLAYS: the settings modal, the model picker,
// the confirm dialog and the archive drawer all render with the board still behind them, so a
// whole-document walk would report the board's numbers again under a second name. That is the exact
// failure this phase exists to avoid — a harness that measures the board five times and calls it five
// surfaces is worse than one that measures it once, because the numbers would look like coverage.
//
// An unmatched selector yields an EMPTY population rather than falling back to the document, so a
// surface whose root stopped existing fails its floor instead of silently measuring the board.
export interface AuditOptions {
  root?: string | null;
}

// A TOKEN SUPPLIED AT RUN TIME BY THE SURFACE THAT USES IT IS NOT A FINDING, and that is the ruling
// Phase 10 was asked to make. Phase 0 recorded `--exec-cols` as *"a gap in the harness's coverage
// rather than a defect"* and Phase 6 closed the coverage half by rendering all ten surfaces; what was
// left was the question itself, and the honest answer is that there is nothing here to fix. Neither
// token can be defined in a stylesheet without becoming a lie: `--max-cols` is the number of columns
// the widest board has and `--exec-cols` is the length of `ExecutionView`'s own `COLUMNS`, so a CSS
// definition would be a second copy of a fact React already owns — which is exactly the class of
// defect the `--track-fit` comment in styles.css records. Counting them as findings on the nine
// surfaces that do not render their view was the instrument mistaking its own scope for a fault, and a
// gate that reports a correct design gets switched off.
//
// SO EACH ONE IS NAMED HERE, WITH THE ELEMENT THAT SUPPLIES IT AND THE SURFACE THAT PROVES IT, and the
// excuse is worth exactly as much as those two clauses make it:
//   - `supplier` — the excuse applies ONLY where that element is absent. Render the view and supply
//     nothing and the token is a finding again, so a React change that dropped the inline style is
//     caught on the one surface that can see it.
//   - `owner` — the surface where the supplier IS rendered asserts the token is neither excused nor a
//     finding there. That is what stops the list rotting into an allow-list: rename the element and
//     the owner surface stops being able to prove its own token, and fails.
// A token that no surface supplies is unaffected: `--ink` was referenced at `.ap-remedy-btn`, defined
// by no theme and supplied by nothing, and rendered the wrong colour for weeks. It is not on this list
// and nothing like it can be — every entry has to name an element that really sets it.
export interface RunTimeToken {
  name: string;
  supplier: string;
  owner: string;
  why: string;
}

export const RUN_TIME_TOKENS: RunTimeToken[] = [
  {
    name: '--max-cols',
    supplier: 'main.boards',
    owner: 'boards',
    why: "The widest board's column count, from BoardsView.tsx: the shared grid's track count cannot disagree with the component's own column list.",
  },
  {
    name: '--exec-cols',
    supplier: 'main.execution',
    owner: 'execution',
    why: "The length of ExecutionView.tsx's own COLUMNS constant, for the same reason: a CSS copy of it would be a second place to change.",
  },
];

// Type and radius counts. Every visible element, because every element computes a font size: an
// off-scale container hands its size to any descendant that does not set one, which is how 94
// elements sat on the UA's 16px default before Phase 2.
function pageBoxes(root: string | null): { elements: number; fontSizes: Tally; radii: Tally } {
  // Repeated in every walk below, and it has to be: this function is serialised into the page, so a
  // shared helper would be `undefined` by the time the page ran it. Same reason `describe` appears
  // seven times.
  function population(scope: string | null): Element[] {
    if (!scope) return Array.from(document.querySelectorAll('*'));
    const host = document.querySelector(scope);
    return host ? [host, ...Array.from(host.querySelectorAll('*'))] : [];
  }

  const fontSizes: Tally = {};
  const radii: Tally = {};
  const bump = (tally: Tally, key: string): void => {
    tally[key] = (tally[key] ?? 0) + 1;
  };
  let elements = 0;
  for (const el of population(root)) {
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
function pageType(arg: { names: string[]; root: string | null }): { scale: string[]; type: Findings } {
  function population(scope: string | null): Element[] {
    if (!scope) return Array.from(document.querySelectorAll('*'));
    const host = document.querySelector(scope);
    return host ? [host, ...Array.from(host.querySelectorAll('*'))] : [];
  }

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
  const scale = arg.names.map((name) => {
    probe.style.fontSize = `var(${name})`;
    return getComputedStyle(probe).fontSize;
  });
  probe.remove();

  const offenders: Offender[] = [];
  let examined = 0;
  for (const el of population(arg.root)) {
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
function pageRadius(arg: { names: string[]; root: string | null }): {
  radiusScale: string[];
  radius: Findings;
} {
  function population(scope: string | null): Element[] {
    if (!scope) return Array.from(document.querySelectorAll('*'));
    const host = document.querySelector(scope);
    return host ? [host, ...Array.from(host.querySelectorAll('*'))] : [];
  }

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
  const scale = arg.names.map((name) => {
    probe.style.borderRadius = `var(${name})`;
    return getComputedStyle(probe).borderTopLeftRadius;
  });
  probe.remove();

  const offenders: Offender[] = [];
  let examined = 0;
  for (const el of population(arg.root)) {
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
function pageOverflow(root: string | null): {
  textElements: number;
  fontSizesOnText: Tally;
  overflow: Findings;
} {
  function population(scope: string | null): Element[] {
    if (!scope) return Array.from(document.querySelectorAll('*'));
    const host = document.querySelector(scope);
    return host ? [host, ...Array.from(host.querySelectorAll('*'))] : [];
  }

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
  for (const el of population(root)) {
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

// CLIPPING — a box wider than the box that clips it. This is a SEPARATE QUESTION from `pageOverflow`
// above, and the difference is a hole that let a real fault through.
//
// `pageOverflow` asks "is any TEXT wider than its own box?" — and it only examines elements with a
// text node of their own, deliberately, because an element whose text lives in a child is not the
// element that sized it. That is the right question and it cannot see this one: a scroll container has
// no text of its own, so it is never examined, and the text INSIDE it is not overflowing anything —
// its own box is the size it asked for. The ancestor is what cut it off.
//
// The fault it missed, measured at 1440×900: each of the three `.board-columns` rows was its own
// horizontal scroller, each clipping 40px of its fifth column at the container edge, cutting "Drop a
// card here" mid-word. The overflow check reported **0 findings across 120 text elements** and the
// document did not scroll sideways at any of 900/1200/1440. Both answers were true; neither was the
// question. At 900px the same rows clipped 580px each.
//
// `text-overflow: ellipsis` is skipped for the reason it is skipped above: it is a DELIBERATE
// statement that this text may be cut, and counting it would fill the list with the correct cases —
// `.ap-status` in the auto-pilot bar is one, at 211px of content in a 126px box on purpose.
function pageClipping(root: string | null): Findings {
  function population(scope: string | null): Element[] {
    if (!scope) return Array.from(document.querySelectorAll('*'));
    const host = document.querySelector(scope);
    return host ? [host, ...Array.from(host.querySelectorAll('*'))] : [];
  }

  function describe(el: Element): string {
    const parts: string[] = [];
    for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
      const id = node.getAttribute('data-testid');
      const name = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : '';
      parts.unshift(`${node.tagName.toLowerCase()}${id ? `[${id}]` : name ? `.${name}` : ''}`);
    }
    return parts.join(' > ');
  }

  const offenders: Offender[] = [];
  let examined = 0;
  for (const el of population(root)) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    const style = getComputedStyle(el);
    // `visible` means nothing is cut and nothing scrolls, so there is no question to ask.
    if (style.overflowX === 'visible' || style.textOverflow === 'ellipsis') continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    examined += 1;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    offenders.push({
      where: describe(el),
      detail: `overflow-x: ${style.overflowX}, scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
    });
  }
  return { examined, offenders };
}

// THE BOARD'S COLUMN GRID, measured. Phase 4's gate: three boards stacked, reading as one table, so
// every row must lay out on the SAME tracks — and a row that scrolled on its own would move its
// columns out from under the row above even with identical tracks, which is why the scroll regions are
// counted too.
//
// Returned as data rather than asserted here, because everything in this file runs inside the page and
// a failure message belongs where the test is.
export interface GridAudit {
  rows: { tracks: string; columns: { x: number; width: number }[] }[];
  // Every element that scrolls sideways, by the `describe` path. The board area is allowed to be one
  // of these and nothing else is: see the check.
  scrollers: string[];
  // The narrowest track the grid gave out, so a floor lowered by accident is a failure and not a
  // silent change of look.
  narrowestTrack: number;
  // EVERY COLUMN HEAD THAT DOES NOT FIT INSIDE ITS COLUMN, and the count of heads examined beside it.
  //
  // This is a THIRD kind of overflow, and none of the walks above can see it. The text walk asks
  // whether text is wider than its own box; the clipping walk asks whether a box is wider than the box
  // that clips it. A flex row with no text of its own and `overflow: visible` neither clips nor
  // scrolls — its children simply render outside it, and every existing check reports zero.
  //
  // It is here because it is the fault this phase made and then found by screenshot rather than by
  // measurement. Lowering the track floor to 144px put the column head's `+` button outside the
  // column's border, in the gutter between columns, at 1200px and 900px. The text sweep the floor was
  // chosen from reported 0 findings at every floor from 144px to 200px.
  headsExamined: number;
  headOverflows: Offender[];
}

function pageGrid(): Omit<GridAudit, 'headsExamined' | 'headOverflows'> {
  const rows = Array.from(document.querySelectorAll('.board-columns')).map((el) => ({
    tracks: getComputedStyle(el).gridTemplateColumns,
    columns: Array.from(el.children).map((child) => {
      const b = child.getBoundingClientRect();
      // Rounded to the pixel: sub-pixel track arithmetic differs by 0.016px between the first track
      // and the rest, which is not a misalignment anybody can see and would fail every run.
      return { x: Math.round(b.x), width: Math.round(b.width) };
    }),
  }));

  const scrollers: string[] = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const style = getComputedStyle(el);
    if (style.overflowX === 'visible' || style.textOverflow === 'ellipsis') continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const name = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    scrollers.push(`${el.tagName.toLowerCase()}${name ? `.${name}` : ''}`);
  }
  const widths = rows.flatMap((r) => r.tracks.split(' ')).map((t) => Number.parseFloat(t));
  return { rows, scrollers, narrowestTrack: widths.length > 0 ? Math.min(...widths) : 0 };
}

// EVERY COLUMN HEAD THAT DOES NOT FIT INSIDE ITS COLUMN. Its own page walk rather than a branch inside
// `pageGrid`, for the reason this file's header gives about the other seven: one function doing both
// scored over the cognitive-complexity gate, and raising the gate to fit it would be the wrong repair.
// Composed with the grid in node by `auditGrid`.
function pageHeads(): { headsExamined: number; headOverflows: Offender[] } {
  // The CONTENT box, which is what a child has to fit inside. Border and padding are subtracted
  // because `getBoundingClientRect` is the BORDER box, and a child inside the border but outside the
  // padding is still inside the box.
  function content(el: Element): { left: number; right: number } {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      left: box.left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft),
      right: box.right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight),
    };
  }

  // Half a pixel of slack, because a flex gap resolved from a rem lands on fractions.
  function outside(child: Element, inner: { left: number; right: number }): boolean {
    const c = child.getBoundingClientRect();
    if (c.width === 0 || c.height === 0) return false;
    return c.right > inner.right + 0.5 || c.left < inner.left - 0.5;
  }

  function name(el: Element): string {
    return typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
  }

  const headOverflows: Offender[] = [];
  const heads = Array.from(document.querySelectorAll('.column > .vb-panel-head'));
  for (const head of heads) {
    const inner = content(head);
    const column = head.parentElement?.querySelector('.column-title')?.textContent ?? '?';
    // Filtered rather than nested with a `continue`, because the complexity metric punishes NESTING
    // far more than length.
    for (const child of Array.from(head.children).filter((c) => outside(c, inner))) {
      const c = child.getBoundingClientRect();
      headOverflows.push({
        where: `${column} > .${name(child)}`,
        detail: `renders at ${Math.round(c.left)}..${Math.round(c.right)} outside its head's ${Math.round(inner.left)}..${Math.round(inner.right)}`,
      });
    }
  }
  return { headsExamined: heads.length, headOverflows };
}

// THE DOCK'S HEIGHT, and whether it is DEFINITE. `.dock-body` is `max-height: 38vh` — content-sized —
// EXCEPT where a pane exists to be filled, and those get `height: 38vh` back. A flex child asking for
// `flex: 1` needs a parent with a definite height to take a share of, so under `max-height` alone the
// raw editor collapsed to its own `min-height`: measured at 128px holding 289px of text inside a dock
// body of 230px, with 250px of the cap going spare. That is the fault this measures, and jsdom cannot
// see it — every box it reports is zero by zero.
export interface DockAudit {
  bodyHeight: number;
  paneHeight: number;
  // The CONTENT height of the box the pane is actually given — its parent's `clientHeight` less that
  // parent's own padding. The pane can never equal `bodyHeight`: the tab strip and the pane box's inset
  // are inside the dock body too. This is what "the pane fills what it was given" is measured against,
  // and it is measured rather than derived so a padding change cannot silently become slack.
  paneBoxHeight: number;
  viewport: number;
  pane: string | null;
}

function pageDock(): DockAudit {
  const body = document.querySelector('[data-testid="dock-body"]');
  const pane = body?.querySelector('.raw-pane, .control-editor') ?? null;
  const host = pane?.parentElement ?? null;
  const inset = host ? getComputedStyle(host) : null;
  return {
    bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : 0,
    paneHeight: pane ? Math.round(pane.getBoundingClientRect().height) : 0,
    paneBoxHeight:
      host && inset
        ? Math.round(host.clientHeight - parseFloat(inset.paddingTop) - parseFloat(inset.paddingBottom))
        : 0,
    viewport: window.innerHeight,
    pane: pane ? pane.className.trim().split(/\s+/)[0] : null,
  };
}

// Contrast, on the pairs the stylesheet actually forms. themes.css states measured ratios in prose;
// this is what pins them.
function pageContrast(root: string | null): Findings {
  type Colour = [number, number, number, number];

  function population(scope: string | null): Element[] {
    if (!scope) return Array.from(document.querySelectorAll('*'));
    const host = document.querySelector(scope);
    return host ? [host, ...Array.from(host.querySelectorAll('*'))] : [];
  }

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
  for (const el of population(root)) {
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
function pageTokens({ root, runtime }: { root: string | null; runtime: RunTimeToken[] }): TokenFindings {
  function population(scope: string | null): Element[] {
    if (!scope) return Array.from(document.querySelectorAll('*'));
    const host = document.querySelector(scope);
    return host ? [host, ...Array.from(host.querySelectorAll('*'))] : [];
  }

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
  // Scoped to the surface, like every other walk. `--exec-cols` is the case that makes this matter: it
  // arrives as an inline style on `main.execution`, so it is a finding on every surface EXCEPT the
  // Execution view, where the element that supplies it is in the population. Phase 0 recorded it as a
  // gap in the harness's coverage; Phase 6 is where it stops being one.
  const elements = population(root);
  const offenders: Offender[] = [];
  const excused: string[] = [];
  const atRoot = getComputedStyle(document.documentElement);
  for (const name of referenced) {
    if (atRoot.getPropertyValue(name).trim()) continue;
    // Defined somewhere but not at the root is a SCOPED token, which is legitimate; defined nowhere
    // is the fault — `--warn` fell through to a hardcoded fallback that way before it existed.
    if (defined.has(name)) continue;
    // A token may also be supplied at RUN TIME: `--max-cols` arrives as an inline style from React,
    // so the grid's track count cannot disagree with the component's own column list. Supplied HERE
    // and it is no finding — that is a correct design, and flagging it is how a check earns the
    // reputation that gets it switched off.
    if (elements.some((el) => getComputedStyle(el).getPropertyValue(name).trim())) continue;
    // NOT SUPPLIED HERE, AND NAMED AS A RUN-TIME TOKEN WHOSE SUPPLIER IS NOT IN THIS WALK'S OWN
    // POPULATION: excused, and listed. See RUN_TIME_TOKENS for the ruling. The `supplier` clause is what
    // keeps it honest — if the element that supplies the token IS in the population and still supplies
    // nothing, the excuse does not apply and the token falls through to a finding below.
    //
    // MEASURED AGAINST THE POPULATION AND NOT THE DOCUMENT, which is a distinction the four overlay
    // surfaces force: the settings modal, the model picker, the confirm dialog and the open card all
    // render with the board still behind them, so `main.boards` exists in the document while being no
    // part of what is being measured. Asking the document reported `--max-cols` as a fault on four
    // surfaces that neither use it nor could supply it.
    const named = runtime.find((token) => token.name === name);
    if (named && !elements.some((el) => el.matches(named.supplier))) {
      excused.push(name);
      continue;
    }
    offenders.push({
      where: name,
      detail: 'referenced by a rule, defined by no stylesheet and set by no element',
    });
  }
  return { examined: referenced.size, offenders, excused };
}

// One line where one line is meant. A row is a flex container laying children out horizontally;
// "one line" means the band its children occupy is no taller than the tallest of them.
//
// Measured that way and NOT by comparing top edges: the first version compared rounded tops and
// reported 22 of 25 rows as wrapped, because `align-items: center` gives children of different
// heights different tops. It was measuring vertical centring and calling it wrapping.
function pageRows(root: string | null): Findings {
  function population(scope: string | null): Element[] {
    if (!scope) return Array.from(document.querySelectorAll('*'));
    const host = document.querySelector(scope);
    return host ? [host, ...Array.from(host.querySelectorAll('*'))] : [];
  }

  function describe(el: Element): string {
    const id = el.getAttribute('data-testid');
    const name = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : name ? `.${name}` : ''}`;
  }
  const offenders: Offender[] = [];
  let examined = 0;
  for (const el of population(root)) {
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
function pageFocus(root: string | null): FocusAudit {
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

  // An unmatched root yields NOTHING rather than falling back to the whole document, so a surface
  // whose root stopped existing fails its floor instead of quietly reporting the board's fifty-five
  // focusables under another name. Extracted rather than written inline because the ternary it
  // replaces took this function to 17 on the cognitive-complexity gate, and the metric punishes
  // nesting far harder than length.
  function found(scope: string | null): Element[] {
    if (!scope) return Array.from(document.querySelectorAll(SELECTOR));
    const host = document.querySelector(scope);
    if (!host) return [];
    const inside = Array.from(host.querySelectorAll(SELECTOR));
    return host.matches(SELECTOR) ? [host, ...inside] : inside;
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

  for (const el of found(root)) {
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
export async function auditStyles(page: Page, options: AuditOptions = {}): Promise<StyleAudit> {
  const root = options.root ?? null;
  const boxes = await page.evaluate(pageBoxes, root);
  const type = await page.evaluate(pageType, { names: [...TYPE_SCALE], root });
  const radius = await page.evaluate(pageRadius, { names: [...RADIUS_SCALE], root });
  const text = await page.evaluate(pageOverflow, root);
  const clipping = await page.evaluate(pageClipping, root);
  const contrast = await page.evaluate(pageContrast, root);
  const tokens = await page.evaluate(pageTokens, { root, runtime: RUN_TIME_TOKENS });
  const rows = await page.evaluate(pageRows, root);
  return { ...boxes, ...type, ...radius, ...text, clipping, contrast, tokens, rows };
}

export async function auditGrid(page: Page): Promise<GridAudit> {
  const grid = await page.evaluate(pageGrid);
  const heads = await page.evaluate(pageHeads);
  return { ...grid, ...heads };
}

export async function auditDock(page: Page): Promise<DockAudit> {
  return page.evaluate(pageDock);
}

export async function auditFocus(page: Page, options: AuditOptions = {}): Promise<FocusAudit> {
  return page.evaluate(pageFocus, options.root ?? null);
}

export async function documentOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(pageDocument);
}

export interface ReadoutAudit {
  readouts: number;
  // Two stacked readouts of the same digit COUNT and different digits. Tabular numerals mean one advance
  // per digit, so these are equal — which is the claim, and it is a claim about widths and not about a
  // font name.
  digitWidths: [number, number];
  // The same two, in the widest and narrowest letters the face has. In a MONOSPACED face these are also
  // equal; in the proportional body face they are not, by a mile.
  glyphWidths: [number, number];
  // The control: the identical pair measured in the surface's own type instead of a readout's. It exists
  // because the assertion above is only worth anything if the measurement can tell the two apart at all
  // — a check that compares two numbers a proportional face also renders identically is vacuous, and
  // this is the number that proves it is not.
  controlWidths: [number, number];
}

// THE SIGNATURE'S OWN CLAIM, MEASURED. `font-variant-numeric: tabular-nums` and a monospaced face are
// what make a column of figures line up on the digit; asserting the `font-family` string back would
// assert that a declaration exists, which is not the same thing and would pass with the numerals still
// proportional. So two clones are stacked and their advance compared.
function pageReadouts(): ReadoutAudit {
  const source = document.querySelector('.vb-readout');
  if (!source) return { readouts: 0, digitWidths: [0, 0], glyphWidths: [0, 0], controlWidths: [0, 0] };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre;';
  document.body.appendChild(host);
  const measure = (template: Element, text: string): number => {
    const probe = template.cloneNode(false) as HTMLElement;
    probe.style.whiteSpace = 'pre';
    probe.textContent = text;
    host.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  };
  // The surface the readout sits in, for the control pair: its own type, whatever that is.
  const surface = source.parentElement ?? document.body;
  const audit: ReadoutAudit = {
    readouts: document.querySelectorAll('.vb-readout').length,
    digitWidths: [measure(source, '1111111111'), measure(source, '8888888888')],
    glyphWidths: [measure(source, 'iiiiiiiiii'), measure(source, 'MMMMMMMMMM')],
    controlWidths: [measure(surface, 'iiiiiiiiii'), measure(surface, 'MMMMMMMMMM')],
  };
  host.remove();
  return audit;
}

export async function auditReadouts(page: Page): Promise<ReadoutAudit> {
  return page.evaluate(pageReadouts);
}
