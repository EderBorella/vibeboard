import {
  auditDock,
  auditFocus,
  auditGrid,
  auditStyles,
  documentOverflow,
  type Offender,
} from '../support/audit.js';
import { type Baseline, expect, readBaseline, recording, test, writeBaseline } from '../support/fixtures.js';

// The seven checks of docs/design-system.md, per theme.
//
// CHECKS 1 AND 2 MAKE TWO DIFFERENT CLAIMS, AND THEY ARE GATED SEPARATELY.
//
// CONFORMANCE — "every computed font-size is one of the six scale values", "every radius is one of
// the four" — becomes blocking in the phase that drives its count to zero, and not before: a gate
// pointed at a backlog has to be bypassed on every commit, which teaches everyone to ignore it.
//   TYPE is BLOCKING as of Phase 2, the commit that took its count from 15 distinct computed sizes
//   (94 elements alone sitting on the 16px default) to the scale. It is the assertion that would have
//   caught the 10.88px-inside-a-12.16px-bar defect on the commit that introduced it.
//   RADIUS is BLOCKING as of Phase 3, the commit that took its count from 6 distinct computed values
//   (6px, 999px, 10px, 8px, 50%, 3px) to the four steps plus 50%. It asserts on `border-radius` and
//   deliberately NOT on `border-style`: the ghost Button's DASHED border is the owner's ruling of
//   2026-08-20, because dashed reads as explanatory rather than actionable and keeps the box the same
//   width as a solid button — a borderless ghost is 2px narrower and shifts the row it sits in.
//
// DRIFT — "the set of computed values is exactly the set in visual/baseline/<theme>.json" — is
// BLOCKING, on all three themes, because its count is zero today, which is the same condition that
// licenses the ratchets below. Without it the reporting checks printed a regression by name and the
// run still exited 0, so a defect reached the commit unless a person read a log line: exactly the
// failure mode this harness exists to remove.
//
// THE OTHER FIVE RATCHET against a recorded baseline rather than against zero, for the same reason
// pointed the other way: their counts are not zero today either, and a gate that cannot be green is
// not a gate. A ratchet is the honest form — it cannot be satisfied by a regression, and it says
// exactly what the number was on the day it was written.
//
// EVERY CHECK ASSERTS A FLOOR ON WHAT IT EXAMINED, because the failure mode of a check like this is
// not a wrong answer, it is a vacuous one: a selector that matches nothing passes silently, and a
// green harness that measured zero elements is worse than no harness. The floors are set well under
// what the board actually renders, so they catch "the page did not load" and not ordinary drift.
const FLOOR = {
  elements: 150,
  text: 80,
  overflow: 70,
  // Every element with an `overflow-x` other than `visible`. There are far more than this — the board
  // area, every column body, the card panes — and the floor is set where it catches "the walk stopped
  // matching" rather than ordinary editing.
  clipping: 10,
  contrast: 80,
  tokens: 15,
  focus: 30,
  rows: 10,
};

// THE BOARD AREA IS THE ONE THING ALLOWED TO SCROLL SIDEWAYS, and it is named rather than counted.
//
// It has to scroll at 900px and there is no arrangement in which it does not: the board area is 465px
// wide with the copilot open, and five columns at the 144px legibility floor plus their gaps want
// 764.8px. What is NOT allowed is what was there before Phase 4 — three separate scrollers, one per
// board row, each clipping its own content. Three rows that read as one table cannot each have their
// own scroll offset: the shared grid is only true while every row sits at zero.
const SCROLL_REGION = 'main.boards';

// THE MEASURED LEGIBILITY FLOOR OF A COLUMN TRACK, from web/src/styles.css: a `.column`'s own
// min-content width, 179px, rounded up. Asserted so a floor lowered by accident is a failure rather
// than a silent change of look — and it has already been lowered by accident once, to 144px, which put
// the column head's `+` button outside the column's border in the gutter. See `headOverflows`.
const TRACK_FLOOR = 180;

// WHAT THE RAW PANE LEAVES UNUSED INSIDE THE DEFINITE DOCK BODY, at 1440×900: 79px of 342px. A
// RATCHET and not zero, because it is a fault this check FOUND rather than one Phase 4 introduced —
// see check 10 for the cause. Drive it down; never raise it.
const DOCK_SHORTFALL = 79;

// The three widths the board's shared grid is designed around, and the ones the dock's `38vh` is
// measured against.
const WIDTHS = [900, 1200, 1440];

// Printed whether or not the count is within the ratchet: a finding list nobody sees is a finding
// list nobody fixes, and the phases after this one are the ones that have to fix them.
function report(theme: string, check: string, examined: number, offenders: Offender[]): void {
  const head = `[${theme}] ${check}: ${offenders.length} finding(s) across ${examined} examined`;
  console.log(offenders.length > 0 ? `${head}\n${lines(offenders)}` : head);
}

function lines(offenders: Offender[]): string {
  return offenders.map((o) => `  ${o.where} — ${o.detail}`).join('\n');
}

// The command that re-records the baseline. Named in the failure message on purpose: a blocking gate
// with no supported way to update it is a gate that gets deleted the first time somebody legitimately
// needs to change it, and Phase 2 changes 27 font sizes on purpose. The message has to tell "you
// broke something" apart from "you meant this, now record it".
const RECORD = 'npm run visual:record';

// What moved since the baseline was recorded, by value.
function drift(now: Record<string, number>, then: Record<string, number>): string[] {
  return [
    ...Object.keys(now)
      .filter((value) => !(value in then))
      .map((value) => `NEW ${value}`),
    // GONE fails as loudly as NEW. A value disappearing is usually progress — and in Phase 2 it is
    // the normal case, which is what `visual:record` is for — but it is also how a whole surface
    // stops rendering: a container that collapsed takes its text's font sizes with it, and the
    // element floors above are set too low to notice one collapsed row. "Zero difference from the
    // baseline" is not a one-directional claim, so the gate is symmetric.
    ...Object.keys(then)
      .filter((value) => !(value in now))
      .map((value) => `GONE ${value}`),
  ];
}

function driftLine(moved: string[]): string {
  return moved.length === 0 ? 'no change from the baseline' : `drift: ${moved.join(', ')}`;
}

// BLOCKING, unlike the conformance count printed beside it. See the header.
function expectNoDrift(theme: string, check: string, moved: string[]): void {
  expect(
    moved,
    `[${theme}] ${check} values drifted from visual/baseline/${theme}.json.\n` +
      `  If this was NOT deliberate, the values above are the regression.\n` +
      `  If it WAS deliberate, re-record the baseline with \`${RECORD}\` and commit it.`,
  ).toEqual([]);
}

function tallyLine(tally: Record<string, number>): string {
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => `${value}×${count}`)
    .join('  ');
}

// Recorded first, so the ratchets below have something to read. `npm run visual:record` writes the
// file; an ordinary run leaves it alone and compares against it.
test('record the baseline', async ({ board, theme }) => {
  test.skip(!recording, 'recording only — run npm run visual:record');
  const styles = await auditStyles(board);
  // The SAME preparation the focus check does, or the recorded number is not the number the check
  // will measure: without the Tab press Chromium refuses `:focus-visible` on a programmatic focus,
  // and the baseline would be a count of a different thing that happens to have the same name.
  await board.keyboard.press('Tab');
  const focus = await auditFocus(board);
  report(theme, 'focus', focus.examined, focus.offenders);
  const baseline: Baseline = {
    recorded: new Date().toISOString().slice(0, 10),
    fontSizes: styles.fontSizes,
    fontSizesOnText: styles.fontSizesOnText,
    radii: styles.radii,
    examined: {
      elements: styles.elements,
      textElements: styles.textElements,
      overflow: styles.overflow.examined,
      clipping: styles.clipping.examined,
      contrast: styles.contrast.examined,
      tokens: styles.tokens.examined,
      rows: styles.rows.examined,
      focus: focus.examined,
      focusUnfocusable: focus.unfocusable,
    },
    findings: {
      overflow: styles.overflow.offenders.length,
      clipping: styles.clipping.offenders.length,
      contrast: styles.contrast.offenders.length,
      tokens: styles.tokens.offenders.length,
      rows: styles.rows.offenders.length,
      focus: focus.offenders.length,
    },
  };
  await writeBaseline(theme, baseline);
});

// The offender list, grouped: 233 elements can share one off-scale value, and a failure message that
// repeats it 233 times buries the one fact that matters — which VALUES are off the scale, and one
// place each to go and look. Sorted by count, so the default that leaked into everything comes first.
function offScale(offenders: Offender[]): string {
  const byValue = new Map<string, string[]>();
  for (const o of offenders) {
    if (!byValue.has(o.detail)) byValue.set(o.detail, []);
    byValue.get(o.detail)?.push(o.where);
  }
  return [...byValue.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(
      ([value, where]) => `  ${value} on ${where.length} element(s), e.g. ${where.slice(0, 3).join(' | ')}`,
    )
    .join('\n');
}

test('1. type — conformance BLOCKING, drift BLOCKING', async ({ board, theme }) => {
  const styles = await auditStyles(board);
  // The floor stops the check being vacuous. So does this: six DISTINCT resolved steps. A token that
  // stopped resolving would make `font-size: var(--t-x)` invalid on the probe, the probe would fall
  // back to its inherited size, and the "allowed" set would quietly become the page's own default —
  // an allow-list that permits exactly what it is meant to refuse.
  expect(styles.elements).toBeGreaterThan(FLOOR.elements);
  expect(styles.textElements).toBeGreaterThan(FLOOR.text);
  expect(new Set(styles.scale).size, `the type scale did not resolve to six steps: ${styles.scale}`).toBe(6);
  // The tally and the conformance list are two separate walks of the page (see audit.ts). This is
  // what stops them diverging: a conformance walk that examined a different population from the one
  // the tally reports could pass while the printed numbers said otherwise.
  expect(styles.type.examined, 'the type walk and the tally walk examined different populations').toBe(
    styles.elements,
  );
  const sizes = Object.keys(styles.fontSizes);
  const onText = Object.keys(styles.fontSizesOnText);
  const baseline = await readBaseline(theme);
  const moved = drift(styles.fontSizes, baseline.fontSizes);
  console.log(
    [
      `[${theme}] type: ${sizes.length} distinct computed font-size values across ${styles.elements} visible elements`,
      `  scale        : ${styles.scale.join('  ')}`,
      `  all elements : ${tallyLine(styles.fontSizes)}`,
      `  text-bearing (${styles.textElements} elements, ${onText.length} values): ${tallyLine(styles.fontSizesOnText)}`,
      `  ${driftLine(moved)}`,
    ].join('\n'),
  );
  // BLOCKING as of Phase 2. Asserted before drift, because an off-scale value is the more specific
  // fault of the two: it says both "this moved" and "where it moved to was never allowed".
  expect(
    styles.type.offenders.length,
    `[${theme}] computed font sizes that are not one of the six steps (${styles.scale.join(', ')}):\n` +
      `${offScale(styles.type.offenders)}\n` +
      `  Give the rule a var(--t-*) from the scale. Do NOT add a seventh step — if a surface looks\n` +
      `  wrong on the nearest step, the surface is wrong. See docs/design-system.md.`,
  ).toBe(0);
  expectNoDrift(theme, 'font-size', moved);
});

test('2. radius — conformance BLOCKING, drift BLOCKING', async ({ board, theme }) => {
  const styles = await auditStyles(board);
  expect(styles.elements).toBeGreaterThan(FLOOR.elements);
  // The same two anti-vacuity guards the type check carries, for the same reasons. Four DISTINCT
  // resolved steps: a token that stopped resolving would make `border-radius: var(--r-x)` invalid on
  // the probe, the probe would report `0px`, and the "allowed" set would quietly become `{0px}` —
  // which permits nothing and would fail loudly, but three tokens collapsing onto one value would
  // permit less than it claims and pass.
  expect(
    new Set(styles.radiusScale).size,
    `the radius scale did not resolve to four steps: ${styles.radiusScale}`,
  ).toBe(4);
  expect(styles.radius.examined, 'the radius walk and the tally walk examined different populations').toBe(
    styles.elements,
  );
  const values = Object.keys(styles.radii);
  const baseline = await readBaseline(theme);
  const moved = drift(styles.radii, baseline.radii);
  console.log(
    [
      `[${theme}] radius: ${values.length} distinct non-zero corner values across ${styles.elements} visible elements`,
      `  scale        : ${styles.radiusScale.join('  ')}  (and 50%)`,
      `  ${tallyLine(styles.radii)}`,
      `  ${driftLine(moved)}`,
    ].join('\n'),
  );
  // BLOCKING as of Phase 3 — the commit that took this from 6 distinct computed values to 4. Asserted
  // before drift for the reason the type check is: an off-scale value is the more specific fault, since
  // it says both "this moved" and "where it moved to was never allowed".
  expect(
    styles.radius.offenders.length,
    `[${theme}] computed corner radii that are not one of the four steps (${styles.radiusScale.join(', ')}) or 50%:\n` +
      `${offScale(styles.radius.offenders)}\n` +
      `  Give the rule a var(--r-*) from the scale. Do NOT add a fifth step — see docs/design-system.md.\n` +
      `  NOTE: this asserts on border-radius and NOT on border-style. The ghost Button's DASHED border\n` +
      `  is deliberate (owner's ruling, 2026-08-20) and is nothing to do with this check.`,
  ).toBe(0);
  expectNoDrift(theme, 'border-radius', moved);
});

test('3. nothing overflows', async ({ board, theme }) => {
  const styles = await auditStyles(board);
  expect(styles.overflow.examined).toBeGreaterThan(FLOOR.overflow);
  report(theme, 'overflow', styles.overflow.examined, styles.overflow.offenders);
  const baseline = await readBaseline(theme);
  expect(
    styles.overflow.offenders.length,
    `text elements overflowing their box:\n${lines(styles.overflow.offenders)}`,
  ).toBeLessThanOrEqual(baseline.findings.overflow);

  // AND THE SECOND QUESTION, WHICH THIS CHECK DID NOT ASK UNTIL PHASE 4: is any BOX wider than the box
  // that clips it? The walk above asks whether text overflows its OWN box, and only of elements with a
  // text node of their own — so a scroll container, which has no text, was never examined, and the text
  // inside one is not overflowing anything. Both halves were true and neither was the question.
  //
  // What it missed: three `.board-columns` rows, each its own horizontal scroller, each cutting 40px
  // off its fifth column at 1440×900 and 580px at 900px, with "Drop a card here" clipped mid-word.
  // This check reported 0 of 120 and the document did not scroll. See `pageClipping` in audit.ts.
  expect(styles.clipping.examined).toBeGreaterThan(FLOOR.clipping);
  report(theme, 'clipping', styles.clipping.examined, styles.clipping.offenders);
  // THE BOARD AREA IS EXEMPT BY NAME, and nothing else is — the same allowance check 9 makes, for the
  // same reason. It is the board's one scroll region and it has to scroll below about 1345px: five
  // columns at the 180px legibility floor plus their gaps want 944.8px, and this harness's default
  // viewport leaves the board area 880px. Matched on the LAST SEGMENT of the path rather than by
  // substring, so a descendant of the board area cannot be excused by its ancestor's name.
  const clipped = styles.clipping.offenders.filter(
    (o) => (o.where.split(' > ').pop() ?? '') !== SCROLL_REGION,
  );
  expect(
    clipped.map((o) => `${o.where} — ${o.detail}`),
    `boxes clipped by an ancestor that scrolls:\n${lines(styles.clipping.offenders)}`,
  ).toEqual([]);

  // And the document itself, at the three widths the board's shared column grid is designed around.
  // A horizontal scrollbar on a cockpit is the fault that has been reported by eye and that jsdom
  // cannot see: it has no layout engine, so every box it measures is zero by zero.
  for (const width of WIDTHS) {
    await board.setViewportSize({ width, height: 900 });
    const doc = await documentOverflow(board);
    expect(doc.scrollWidth, `the document scrolls sideways at ${width}px`).toBeLessThanOrEqual(
      doc.clientWidth,
    );
  }
});

test('4. contrast is at least 4.5:1', async ({ board, theme }) => {
  const styles = await auditStyles(board);
  expect(styles.contrast.examined).toBeGreaterThan(FLOOR.contrast);
  report(theme, 'contrast', styles.contrast.examined, styles.contrast.offenders);
  const baseline = await readBaseline(theme);
  expect(
    styles.contrast.offenders.length,
    `text/ground pairs under 4.5:1:\n${lines(styles.contrast.offenders)}`,
  ).toBeLessThanOrEqual(baseline.findings.contrast);
});

test('5. no unresolved token', async ({ board, theme }) => {
  const styles = await auditStyles(board);
  expect(styles.tokens.examined).toBeGreaterThan(FLOOR.tokens);
  report(theme, 'tokens', styles.tokens.examined, styles.tokens.offenders);
  const baseline = await readBaseline(theme);
  expect(
    styles.tokens.offenders.length,
    `custom properties referenced and never defined:\n${lines(styles.tokens.offenders)}`,
  ).toBeLessThanOrEqual(baseline.findings.tokens);
});

test('6. focus is visible', async ({ board, theme }) => {
  // Tab first, and the reason is in audit.ts: Chromium matches `:focus-visible` on a programmatic
  // focus only when the last interaction was a keypress. Without this line every element reports no
  // focus style and the check fails everywhere, which is as uninformative as passing everywhere.
  await board.keyboard.press('Tab');
  const focus = await auditFocus(board);
  expect(focus.examined).toBeGreaterThan(FLOOR.focus);
  report(theme, 'focus', focus.examined, focus.offenders);
  const baseline = await readBaseline(theme);
  expect(
    focus.offenders.length,
    `interactive elements with no discernible focus style:\n${lines(focus.offenders)}`,
  ).toBeLessThanOrEqual(baseline.findings.focus);
});

// THE PRIMITIVES, REACHED BY TAB AND MEASURED WHILE FOCUSED. Phase 3 of docs/design-system.md.
//
// Check 6 above already walks every focusable element, so why this one: because check 6 is a RATCHET
// against a recorded count, and a primitive that fell out of the tab order entirely would take its
// own row out of the population and leave the ratchet satisfied. This asserts the population — every
// `.vb-btn` the board renders is reachable by Tab — before it asserts the ring.
//
// AND IT PRESSES TAB RATHER THAN CALLING `focus()`. Chromium matches `:focus-visible` on a
// programmatic focus only when the last interaction was a keypress, which is the trap that made
// check 6's first version fail on all 55 elements. This walks the real tab order, so a control that
// is only reachable with a mouse is a finding here and cannot be one there.
//
// The ring is read as a CHANGE against the element's own resting style, not against a literal
// `2px solid`, and `outline-offset` is deliberately not compared — see the PROPS list in audit.ts.
// Comparing it is what made check 6 vacuous: the app sets both `outline` and `outline-offset`, so a
// planted `outline: none` still moved the offset and every element went on reporting a focus style it
// no longer had.
test('8. every primitive shows a focus ring when tabbed to', async ({ board, theme }) => {
  // ENABLED ONLY. A disabled control cannot take focus, so Tab skips it and `focus()` is a no-op —
  // the same distinction `pageFocus` in audit.ts draws, and for the same reason: counting them as
  // findings reports a disabled emergency stop as having no focus style. The board renders the stop
  // and the transport disabled while nothing is running.
  const enabled = await board.locator('.vb-btn:not(:disabled)').count();
  const total = await board.locator('.vb-btn').count();
  // A floor, because the failure mode of this check is a selector that matches nothing: the auto-pilot
  // bar alone renders the transport, the emergency stop, "How it works" and Settings.
  expect(total, 'no .vb-btn on the board — has the selector stopped matching?').toBeGreaterThan(3);
  expect(enabled, 'every .vb-btn on the board is disabled — nothing would be measured').toBeGreaterThan(1);

  // MARKED ON THE ELEMENT, not collected into a map keyed on the class list. The first version did
  // the latter and it was a fixture too thin to distinguish two outcomes: the bar's ghost buttons
  // carried byte-identical class lists (`vb-btn vb-btn-ghost vb-btn-sm ap-inline`), so several
  // elements collapsed into one entry and the check reported "3 of 5 reached" against a board where
  // every one of them had been tabbed to and had a ring. The population is now 30 rather than 5 —
  // finishing the adoption took it there — and the 14 column-head `+` buttons alone are 14 identical
  // class lists, so the fixture is far thinner now than when it first misled.
  //
  // Walk the real tab order. The bound is generous rather than tight: the board has 55 focusable
  // elements and the order is not ours to predict, so this presses Tab enough times to visit them all
  // twice over.
  for (let press = 0; press < 140; press += 1) {
    await board.keyboard.press('Tab');
    await board.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || !el.classList.contains('vb-btn')) return;
      // Measured against ITSELF unfocused, which is the only comparison that means anything: a theme
      // may give a resting element an outline of its own.
      const focused = getComputedStyle(el);
      const ring = [focused.outlineStyle, focused.outlineWidth, focused.outlineColor].join(' ');
      const matched = el.matches(':focus-visible');
      el.blur();
      const resting = getComputedStyle(el);
      const bare = [resting.outlineStyle, resting.outlineWidth, resting.outlineColor].join(' ');
      el.focus();
      el.dataset.vbTabbed = ring !== bare && matched ? `ring ${ring}` : `NONE (focus-visible ${matched})`;
    });
  }

  const found = await board.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.vb-btn')).map((el) => ({
      id: Array.from(el.classList).join('.'),
      disabled: el.matches(':disabled'),
      tabbed: el.dataset.vbTabbed ?? null,
    })),
  );
  const live = found.filter((p) => !p.disabled);
  const reached = live.filter((p) => p.tabbed !== null);
  const ringless = reached.filter((p) => !p.tabbed?.startsWith('ring '));

  console.log(
    `[${theme}] primitives: ${reached.length} of ${live.length} enabled .vb-btn reached by Tab ` +
      `(${found.length - live.length} disabled, skipped), ${ringless.length} without a ring\n` +
      found.map((p) => `  ${p.id} — ${p.disabled ? 'disabled' : (p.tabbed ?? 'NOT REACHED')}`).join('\n'),
  );

  expect(
    reached.length,
    `${live.length - reached.length} enabled .vb-btn could not be reached by Tab at all. A control only ` +
      `a mouse can reach is invisible to check 6, which walks the DOM rather than the tab order.`,
  ).toBe(live.length);
  expect(
    ringless.map((p) => `${p.id}: ${p.tabbed}`),
    `these primitives showed no focus ring when tabbed to, on ${theme}`,
  ).toEqual([]);
});

test('7. one line where one line is meant', async ({ board, theme }) => {
  const styles = await auditStyles(board);
  expect(styles.rows.examined).toBeGreaterThan(FLOOR.rows);
  report(theme, 'rows', styles.rows.examined, styles.rows.offenders);
  const baseline = await readBaseline(theme);
  expect(
    styles.rows.offenders.length,
    `flex rows whose children sit on more than one line:\n${lines(styles.rows.offenders)}`,
  ).toBeLessThanOrEqual(baseline.findings.rows);

  // The two rows the incident was about, named and blocking at zero: the auto-pilot bar is where a
  // borrowed class rendered at 10.88px inside a 12.16px row, and the top bar is the other row that
  // has wrapped in front of the owner.
  // `.ap-bar-row` rather than the bar itself: the bar is a one-child wrapper, and a row assertion
  // against a container with one child is vacuous — it passed on a single element and proved nothing.
  for (const selector of ['[data-testid="ap-bar"] .ap-bar-row', 'header.topbar']) {
    // The band the children occupy against the tallest of them — the same measure audit.ts uses, and
    // for the same reason: comparing top edges measures `align-items: center`, not wrapping. That
    // version reported this row as five lines when it is one.
    const row = await board.locator(selector).evaluate((el) => {
      const boxes = Array.from(el.children)
        .map((child) => child.getBoundingClientRect())
        .filter((box) => box.height > 0);
      const band = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
      return { count: boxes.length, band, tallest: Math.max(...boxes.map((b) => b.height)) };
    });
    expect(row.count, `${selector} rendered no children`).toBeGreaterThan(1);
    expect(
      row.band,
      `${selector} wrapped: its ${row.count} children span ${row.band}px against a tallest child of ${row.tallest}px`,
    ).toBeLessThanOrEqual(row.tallest + 1);
  }
});

// CHECK 9 — THE BOARD'S THREE COLUMN ROWS ARE ONE SHARED GRID. Phase 4 of docs/design-system.md.
//
// The three boards are stacked and read as one table, so their column edges have to line up down the
// page. The stylesheet says so — one grid of `--max-cols` tracks per row, the count taken from the
// widest board's CONFIG — and the claim was still false, in a way nothing in this harness could see.
//
// WHAT WAS ACTUALLY WRONG, measured at 1440×900 before this check existed. Every row's tracks were
// identical, and every row was ALSO its own horizontal scroller: `overflow-x: auto` on
// `.board-columns`, with the grid 1044.8px wide inside a 1005px box. So each row clipped 40px of its
// fifth column, cutting "Drop a card here" mid-word, and any row could be scrolled independently of
// the two above it — which makes "one shared grid" true only while all three sit at offset zero. At
// 900px each row clipped 580px. Check 3 reported 0 findings across 120 text elements and no document
// scroll, because it asks whether text overflows its OWN box and this is an ancestor clipping it.
//
// So this asserts three separable things, and the first two would each have passed on the old code:
//   1. every row reports the SAME `grid-template-columns`;
//   2. column i sits at the same x with the same width in every row that has one;
//   3. the ONLY thing scrolling sideways is the board area — one region, not three.
// And a fourth, which is what makes the fit real rather than a fit bought by squeezing: no track is
// narrower than the measured legibility floor.
test('9. the three board rows are one shared grid', async ({ board, theme }) => {
  let rowsExamined = 0;
  let columnsExamined = 0;
  let headsExamined = 0;
  for (const width of WIDTHS) {
    await board.setViewportSize({ width, height: 900 });
    const grid = await auditGrid(board);
    // A FLOOR, because the failure mode of a layout assertion is a selector that matches nothing: a
    // check that examined no rows agrees with every claim made about them.
    expect(grid.rows.length, `no .board-columns rows at ${width}px — has the board rendered?`).toBe(3);
    rowsExamined += grid.rows.length;

    const tracks = new Set(grid.rows.map((r) => r.tracks));
    expect([...tracks], `the three board rows do not share one set of tracks at ${width}px`).toHaveLength(1);

    // Per COLUMN INDEX rather than per row, because that is the claim a reader makes with their eye:
    // BACKLOG is above BACKLOG. A row with fewer columns than the widest simply ends early, which is
    // honest — the Features board really does have one fewer column.
    const widest = Math.max(...grid.rows.map((r) => r.columns.length));
    expect(widest, `no columns rendered at ${width}px`).toBeGreaterThan(1);
    for (let i = 0; i < widest; i += 1) {
      const seen = grid.rows.map((r) => r.columns[i]).filter((c) => c !== undefined);
      columnsExamined += seen.length;
      const places = new Set(seen.map((c) => `${c.x}+${c.width}`));
      expect([...places], `column ${i} does not line up across the three boards at ${width}px`).toHaveLength(
        1,
      );
    }

    expect(
      grid.narrowestTrack,
      `a column track is ${grid.narrowestTrack}px at ${width}px, under the ${TRACK_FLOOR}px floor at ` +
        `which nothing on the board overflows its own box`,
    ).toBeGreaterThanOrEqual(TRACK_FLOOR);

    // ONE REGION. The board area may be in this list; nothing else may.
    expect(
      grid.scrollers.filter((who) => who !== SCROLL_REGION),
      `something other than ${SCROLL_REGION} scrolls sideways at ${width}px — three board rows each ` +
        `scrolling on their own is how the shared grid stopped being shared`,
    ).toEqual([]);

    // AND THE HEAD FITS INSIDE THE COLUMN. A third kind of overflow, invisible to every other check:
    // a flex row with no text of its own and `overflow: visible` neither clips nor scrolls, so its
    // children just render outside it. This is the fault a 144px floor made — the `+` in the gutter
    // between columns — and the text walk reported 0 findings at every floor from 144px to 200px.
    expect(
      grid.headsExamined,
      `no column heads found at ${width}px — has .vb-panel-head stopped matching?`,
    ).toBe(14);
    headsExamined += grid.headsExamined;
    expect(
      grid.headOverflows.map((o) => `${o.where} — ${o.detail}`),
      `column heads whose contents render outside the column at ${width}px`,
    ).toEqual([]);

    console.log(
      `[${theme}] grid @${width}: 3 rows, ${widest} tracks, narrowest ${grid.narrowestTrack}px, ` +
        `${grid.headsExamined} heads, scrollers [${grid.scrollers.join(', ')}]`,
    );
  }
  console.log(
    `[${theme}] grid: ${rowsExamined} row(s), ${columnsExamined} column(s) and ${headsExamined} head(s) examined`,
  );
  // Stated so a run that quietly stopped visiting a width cannot look like a pass: 3 rows × 3 widths,
  // 4 + 5 + 5 columns at each of them, and one head per column.
  expect(rowsExamined).toBe(9);
  expect(columnsExamined).toBe(42);
  expect(headsExamined).toBe(42);
});

// CHECK 10 — THE DOCK KEEPS ITS DEFINITE HEIGHT. Phase 4 of docs/design-system.md.
//
// `.dock-body` is `max-height: 38vh` — content-sized, so a one-line "No card open." does not reserve
// 414px of empty panel — EXCEPT where a pane exists to be filled, and those get `height: 38vh` back.
// The reason is not obvious and is exactly what this pins: a flex child asking for `flex: 1` needs a
// parent with a DEFINITE height to take a share of. Under `max-height` alone the raw editor collapsed
// to its own `min-height` — 128px holding 289px of text, inside a dock body of 230px, with 250px of the
// cap going spare. The pane wanted to fill the box and the box wanted to fit the pane.
//
// jsdom cannot see either state: it has no layout engine, so both are zero by zero.
test('10. the dock is content-sized until a pane asks to be filled', async ({ board, theme }) => {
  await board.setViewportSize({ width: 1440, height: 900 });
  const resting = await auditDock(board);
  expect(resting.pane, 'the dock already had a fillable pane open — this measures the resting case').toBe(
    null,
  );
  const cap = Math.round(resting.viewport * 0.38);
  expect(resting.bodyHeight, 'the dock body rendered nothing').toBeGreaterThan(0);
  expect(
    resting.bodyHeight,
    `the dock body is ${resting.bodyHeight}px at rest, over its ${cap}px cap`,
  ).toBeLessThanOrEqual(cap + 1);
  // STRICTLY under the cap, not merely within it. `height: 38vh` for everything is what this replaced,
  // and a regression to it would satisfy "≤ cap" exactly.
  expect(
    resting.bodyHeight,
    `the dock body is at its ${cap}px cap with nothing in it that asks to be filled — it is reserving ` +
      `height for a one-line empty state, which is what content-sizing replaced`,
  ).toBeLessThan(cap);

  // Open a card, then its file. Through the real controls rather than by injecting state: the pane is
  // selected by `.dock-body:has(.raw-pane)`, so a fabricated DOM would be measuring a different rule.
  await board.locator('.tile').first().click();
  await board.locator('[data-testid="cards-raw"]').click();
  await board.locator('.raw-pane').waitFor({ state: 'visible' });
  const filled = await auditDock(board);
  expect(filled.pane, 'the raw pane did not open').toBe('raw-pane');
  expect(
    filled.bodyHeight,
    `the dock body is ${filled.bodyHeight}px with a raw pane open, and 38vh of ${filled.viewport}px is ` +
      `${cap}px. A pane that asks to be filled needs a parent with a DEFINITE height to fill.`,
  ).toBe(cap);
  // AND WHAT THE PANE DOES WITH IT, WHICH IS A RATCHET AND NOT ZERO — because the first run of this
  // check found that it does not take all of it, and that is a pre-existing fault rather than
  // something Phase 4 moved.
  //
  // Measured at 1440×900: the dock body is 342px and the raw pane is 263px, so 79px of a definite box
  // goes unused. The cause is the same one the `height: 38vh` comment in styles.css describes, one
  // level further down: `.raw-pane`'s `flex: 1` needs a FLEX parent, and its parent is `.cards-body`,
  // which is a scrolling block. So the pane sits at its own content height, floored by
  // `.raw-pane .raw-area`'s `min-height: 14rem` — 224px, which is large enough to hide the collapse.
  // Phase 4's gate is that the dock BODY's height is definite, and it is, exactly. Fixing the chain
  // below it is a change to the dock's internals that this phase has no business making, so the number
  // is recorded and any increase blocks.
  const shortfall = filled.bodyHeight - filled.paneHeight;
  expect(filled.paneHeight, 'the raw pane rendered nothing').toBeGreaterThan(0);
  expect(
    filled.paneHeight,
    `the raw pane is ${filled.paneHeight}px, taller than the ${filled.bodyHeight}px box it sits in`,
  ).toBeLessThanOrEqual(filled.bodyHeight);
  expect(
    shortfall,
    `the raw pane leaves ${shortfall}px of a ${filled.bodyHeight}px definite dock body unused, against ` +
      `${DOCK_SHORTFALL}px when this was measured. Its \`flex: 1\` has no flex parent — .cards-body is a ` +
      `scrolling block — so it sits at its content height. Do not raise this number.`,
  ).toBeLessThanOrEqual(DOCK_SHORTFALL);
  console.log(
    `[${theme}] dock: ${resting.bodyHeight}px at rest, ${filled.bodyHeight}px with ${filled.pane} ` +
      `(38vh of ${filled.viewport} = ${cap}), pane ${filled.paneHeight}px`,
  );
});
