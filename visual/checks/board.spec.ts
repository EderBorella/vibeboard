import {
  auditDock,
  auditFocus,
  auditGrid,
  auditReadouts,
  auditStyles,
  documentOverflow,
  type Offender,
  RUN_TIME_TOKENS,
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
  // Phase 6's per-surface entries are carried over rather than rebuilt: they are written by
  // surfaces.spec.ts, and a record pass that dropped them would leave nine surfaces with no ceiling
  // at all — every ratchet would go quiet on the run after the next `visual:record`.
  const previous = await readBaseline(theme).catch(() => null);
  const baseline: Baseline = {
    recorded: new Date().toISOString().slice(0, 10),
    ...(previous?.surfaces ? { surfaces: previous.surfaces } : {}),
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
  // THE BOARD PROVES ITS OWN RUN-TIME TOKEN, which is what keeps RUN_TIME_TOKENS from being an
  // allow-list. `--max-cols` is supplied by `main.boards`, and this is the one surface where that
  // element is rendered — so here the excuse must NOT apply: the token has to really resolve. Rename
  // the element or drop the inline style and this line fails rather than the token quietly becoming
  // excusable everywhere. See RUN_TIME_TOKENS in visual/support/audit.ts.
  const owned = RUN_TIME_TOKENS.filter((token) => token.owner === 'boards');
  expect(owned.length, 'RUN_TIME_TOKENS names no token this surface owns — has `owner` moved?').toBe(1);
  for (const token of owned) {
    // THE SUPPLIER IS ASSERTED PRESENT, and this is the half that stops the ruling decaying into a
    // plain allow-list. A `supplier` selector that matches nothing makes the excuse UNCONDITIONAL on
    // every surface — the token would be waved through wherever it appeared — and nothing else here
    // can see that, because on this surface the token resolves either way.
    expect(
      await board.locator(token.supplier).count(),
      `${token.name}'s supplier \`${token.supplier}\` matches nothing on the surface that owns it, so ` +
        `the excuse in RUN_TIME_TOKENS is now unconditional. Fix the selector.`,
    ).toBeGreaterThan(0);
  }
  expect(
    styles.tokens.excused.filter((name) => owned.some((token) => token.name === name)),
    `${owned.map((t) => t.name).join(', ')} is supplied by this surface, so it must resolve HERE rather ` +
      `than be excused. The element named in RUN_TIME_TOKENS is not rendering it.`,
  ).toEqual([]);
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

  // EVERY CARD TILE IS IN THAT POPULATION, which is Phase 10's claim and needs saying separately: the
  // count above is a RATCHET, and until this phase the board's primary control was not in it at all —
  // `.tile` was a `<div>` with an `onClick`, no `tabIndex` and no `onKeyDown`, so no card could be
  // reached or opened without a mouse and every tile was invisible to this check. A ratchet cannot see
  // that: an element absent from the population takes its own row out of the count.
  //
  // The selector is the walk's own, read out of the same place (`pageFocus` in audit.ts). A tile made
  // focusable by some other means would still be absent from what this gate protects.
  const tiles = await board.evaluate(() => {
    const SELECTOR =
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]';
    const all = Array.from(document.querySelectorAll('.tile'));
    return { total: all.length, focusable: all.filter((el) => el.matches(SELECTOR)).length };
  });
  expect(tiles.total, 'no .tile on the board — has the fixture stopped rendering cards?').toBeGreaterThan(0);
  expect(
    tiles.focusable,
    `${tiles.total - tiles.focusable} of ${tiles.total} card tiles cannot be reached from the keyboard, ` +
      `and are absent from the ${focus.examined} elements this check protects`,
  ).toBe(tiles.total);
  console.log(`[${theme}] tiles: ${tiles.focusable} of ${tiles.total} reachable from the keyboard`);

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

  // THE GHOST'S DASHED BORDER, WHICH NOTHING HELD UNTIL NOW. It is an owner ruling with a reason —
  // dashed reads as explanatory rather than actionable, which is what a help affordance is — and the
  // radius check says in its own NOTE that it asserts border-radius and deliberately NOT border-style,
  // precisely so a dashed ghost is not a conformance failure. The gap between those two facts is that
  // the ruling was gated by nothing: an audit found 20 of 20 ghosts still dashed, by luck rather than
  // by anything refusing the alternative. Solid is the regression this refuses.
  const ghosts = await board.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.vb-btn-ghost')).map((el) => ({
      id: Array.from(el.classList).join('.'),
      style: getComputedStyle(el).borderStyle,
    })),
  );
  expect(ghosts.length, 'no ghost Button on the board — this check would pass on nothing').toBeGreaterThan(0);
  const solid = ghosts.filter((g) => g.style !== 'dashed');
  expect(
    solid.length,
    `ghost Buttons whose border is not dashed:\n${solid.map((g) => `  ${g.id} — ${g.style}`).join('\n')}`,
  ).toBe(0);
  console.log(`[${theme}] ghosts: ${ghosts.length} of ${ghosts.length} dashed`);
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
  // AND THE PANE TAKES ALL OF IT, EXACTLY, which is Phase 10's half of this check. It used to be a
  // RATCHET at 79px, because the first run of this check found the pane leaving that much of a definite
  // box unused: `.raw-pane`'s `flex: 1` had no flex parent — `.cards-body` was a scrolling BLOCK — so
  // the pane sat at its content height, floored by `.raw-area`'s `min-height: 14rem` (224px), which was
  // large enough to hide the collapse. `.cards-body` is a flex column now and the shortfall is gone, so
  // the ratchet and its constant are gone with it: an exact equality is available and a ratchet at a
  // number nobody has to live with is slack.
  //
  // MEASURED AGAINST THE BOX THE PANE WAS GIVEN, not against the dock body: the tab strip and
  // `.cards-body`'s own inset are inside the body too, so `paneHeight === bodyHeight` is unsatisfiable
  // and asserting it would be asserting a number rather than the behaviour. `paneBoxHeight` is that
  // parent's content height, read in the page — see `pageDock` in visual/support/audit.ts.
  expect(filled.paneHeight, 'the raw pane rendered nothing').toBeGreaterThan(0);
  expect(filled.paneBoxHeight, 'the pane has no measurable box to fill').toBeGreaterThan(0);
  expect(
    filled.paneHeight,
    `the raw pane is ${filled.paneHeight}px, taller than the ${filled.bodyHeight}px dock body it sits in`,
  ).toBeLessThanOrEqual(filled.bodyHeight);
  expect(
    filled.paneHeight,
    `the raw pane is ${filled.paneHeight}px inside the ${filled.paneBoxHeight}px box it was given, in a ` +
      `${filled.bodyHeight}px definite dock body: it is leaving ` +
      `${filled.paneBoxHeight - filled.paneHeight}px of it unused. A pane with \`flex: 1\` needs a FLEX ` +
      `parent — .cards-body is one, and it must stay one.`,
  ).toBe(filled.paneBoxHeight);
  console.log(
    `[${theme}] dock: ${resting.bodyHeight}px at rest, ${filled.bodyHeight}px with ${filled.pane} ` +
      `(38vh of ${filled.viewport} = ${cap}), pane ${filled.paneHeight}px of a ${filled.paneBoxHeight}px box`,
  );
});

// CHECK 11 — NUMBERS ALIGN IN A COLUMN, and it is measured rather than asserted by font name. A
// `font-family` assertion says a declaration exists; it does not say the digits line up, and it would
// pass with `font-variant-numeric` deleted. So two clones of a real readout are stacked off-screen and
// their advance is compared: ten `1`s against ten `8`s (tabular numerals), and ten `i`s against ten `M`s
// (a monospaced face). The CONTROL is the same letter pair measured in the surface's own type — it has to
// differ, or the instrument cannot tell two widths apart and both claims above are vacuous.
//
// WHAT THIS CHECK CANNOT SEE, verified rather than assumed: deleting `font-variant-numeric: tabular-nums`
// from `.vb-readout` leaves it GREEN. In a monospaced face every digit already has one advance, so the
// declaration is belt-and-braces while the family holds — an equivalent mutant, probed once and recorded
// here rather than left as a hole for someone to rediscover. It is kept because it is what makes the
// claim true of a readout whose surface re-faces it. Changing the family to `var(--font-body)` exits 1.
test('11. numbers align in a column', async ({ board, theme }) => {
  const audit = await auditReadouts(board);
  expect(
    audit.readouts,
    'the board rendered no readouts at all — this check has nothing to measure',
  ).toBeGreaterThan(0);
  const [ones, eights] = audit.digitWidths;
  const [narrow, wide] = audit.glyphWidths;
  const [cNarrow, cWide] = audit.controlWidths;

  // ANTI-VACUITY FIRST, because a green run on an instrument that cannot see is the worse failure.
  expect(
    Math.abs(cWide - cNarrow),
    `the control pair measured ${cNarrow}px against ${cWide}px in the surrounding type — if a
     proportional face renders 'iiii' and 'MMMM' at the same width, this whole check compares numbers
     that are equal whatever the readout does`,
  ).toBeGreaterThan(1);

  expect(
    Math.abs(eights - ones),
    `two stacked readouts of ten digits each measured ${ones}px and ${eights}px — the digits do not
     share an advance, so a column of figures will not line up. That is what tabular-nums buys.`,
  ).toBeLessThan(0.01);
  expect(
    Math.abs(wide - narrow),
    `ten 'i's measured ${narrow}px against ten 'M's at ${wide}px in a readout — the face is not
     monospaced, so "if it is monospaced the machine measured it" is not true of this element`,
  ).toBeLessThan(0.01);

  console.log(
    `[${theme}] readouts: ${audit.readouts} on the board; digits ${ones}/${eights}px, ` +
      `glyphs ${narrow}/${wide}px, proportional control ${cNarrow}/${cWide}px`,
  );
});

// CHECK 12 — THE THINGS A PERSON HAS TO SEE ARE BIG ENOUGH TO SEE. The owner's report, in three parts,
// and not one of the three was visible to any check in this file.
//
// Every one of them is a claim about RENDERED GEOMETRY, which is why it is here and not in the suite:
// jsdom loads no CSS and computes no layout, so `-webkit-line-clamp: 2` inside a `height: 112px` box
// reads as two perfectly good declarations there. What it drew was one line of text and one line of
// half-glyphs — the box clipped the second line through the middle — and 4,465 green tests said nothing.
//
//   1. A CARD TITLE OCCUPIES EXACTLY ONE LINE. Asserted as the element's own height over its computed
//      `line-height`, and NOT as a computed `white-space` — `nowrap` is the mechanism and one line is the
//      behaviour, so a clamp that reached two lines by another route would keep the declaration and break
//      the claim. Which is precisely what happened: the first version of this counted
//      `getClientRects().length`, which is one rect per line box of an INLINE formatting context and
//      exactly one rect for a block element whatever it contains. Planting the old `-webkit-line-clamp: 2`
//      back left it green. A check that cannot see the defect it was written for is the thing this
//      harness exists to stop shipping, and it shipped for the length of one commit.
//   2. NOTHING IN A TILE IS CUT. Every child's bottom edge sits inside the tile's content box. This is
//      the half that names the actual defect, and the long-titled fixture card in visual/run.mjs is what
//      makes it able to fail — on a title that fits, both the old clamp and the new one pass.
//   3. A COLUMN THAT SCROLLS ASKS FOR A SCROLLBAR OF ITS OWN, and this one is asserted more weakly than
//      the other two — deliberately, and it is worth saying exactly how. The first instrument here was
//      the gutter the browser reserves, `offsetWidth - clientWidth`, which is the only thing that would
//      prove pixels. It reads 0 in this harness: headless Chromium draws OVERLAY scrollbars, and it does
//      so under `--disable-features=OverlayScrollbar` too — measured, both spellings, plus the Fluent
//      variants. There is no arrangement of flags that makes a headless scrollbar occupy layout.
//      So what is held here is the CASCADE and not the paint: `.column-body` computes the `auto` width
//      and the two-token colour pair it declares, rather than the `thin`/`--border` the app-wide `*` rule
//      would give it. That is the way this regresses in practice — a rule deleted, or one that loses to
//      the star selector — and it is not proof that the bar is wide enough to see. That part was checked
//      by eye.
const TWIST_FLOOR = 14; // --t-lead is 15px; a step below it would be --t-body at 13px.

test('12. the affordances are big enough to see', async ({ board, theme }) => {
  const seen = await board.evaluate(
    ({ twistFloor }) => {
      const rect = (el: Element) => el.getBoundingClientRect();
      const titles = Array.from(document.querySelectorAll<HTMLElement>('.tile-title'));
      const twists = Array.from(document.querySelectorAll<HTMLElement>('.vb-twist'));
      const bodies = Array.from(document.querySelectorAll<HTMLElement>('.column-body'));

      // A tile is `overflow: hidden`, so a clipped child still reports its own full rect — which is
      // exactly what makes this measurable: the child's bottom against the PADDING box of the tile.
      const cut: string[] = [];
      for (const tile of Array.from(document.querySelectorAll<HTMLElement>('.tile'))) {
        const box = rect(tile);
        const inner = box.bottom - Number.parseFloat(getComputedStyle(tile).paddingBottom || '0');
        for (const child of Array.from(tile.children)) {
          const c = rect(child);
          if (c.height > 0 && c.bottom > inner + 1) {
            cut.push(`${child.className} bottom ${c.bottom.toFixed(1)} past ${inner.toFixed(1)}`);
          }
        }
      }

      const scrolling = bodies.filter((b) => b.scrollHeight > b.clientHeight + 1);
      // Every control on the auto-pilot bar's row, as computed sizes. The transport was a step taller
      // than everything beside it.
      //
      // `:not(.vb-seg-cell)` AND THE EXCLUSION IS MEASURED RATHER THAN ASSUMED: with it left in, this
      // reported `vb-seg-cell-sm 11px` against everything else's 12px. A segmented control's cells are
      // one primitive with one border and one corner, sized a step down on purpose — they are the parts
      // of a single control, not controls sitting on this row, and folding them in would make the claim
      // "everything is one size" false by construction and therefore unassertable.
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="ap-bar"] .ap-bar-row button:not(.vb-seg-cell)'),
      ).map((b) => ({
        id: b.dataset.testid ?? b.className,
        px: getComputedStyle(b).fontSize,
        h: rect(b).height,
      }));
      // The bordered group around the backend selector and the agent's state. Its own height, because a
      // group drawn to make two things read as a pair must not become the tallest thing on the row —
      // which it was, at 29.8px against 20px buttons, until the padding came off it. Found by taking a
      // screenshot of the live board and looking at it, which no assertion in this file was doing.
      const group = document.querySelector<HTMLElement>('[data-testid="ap-bar"] .ap-agent');
      return {
        controls,
        group: group ? rect(group).height : null,
        titles: titles.length,
        // HEIGHT OVER LINE-HEIGHT, rounded. A `-webkit-box` clamped to two lines is twice as tall as a
        // `nowrap` one and reports the same single client rect, so height is the only thing that tells
        // them apart from outside.
        multiline: titles
          .map((t) => {
            const lead = Number.parseFloat(getComputedStyle(t).lineHeight);
            const lines = Math.round(rect(t).height / lead);
            return { lines, text: (t.textContent ?? '').slice(0, 40) };
          })
          .filter((t) => t.lines !== 1),
        twists: twists.length,
        small: twists
          .map((t) => ({ cls: t.className, px: Number.parseFloat(getComputedStyle(t).fontSize) }))
          .filter((t) => t.px < twistFloor),
        columns: bodies.length,
        scrolling: scrolling.length,
        bars: scrolling.map((b) => {
          const style = getComputedStyle(b);
          return { width: style.scrollbarWidth, color: style.scrollbarColor };
        }),
      };
    },
    { twistFloor: TWIST_FLOOR },
  );

  // THE THREE ANTI-VACUITY FLOORS, and the third one is the whole reason visual/run.mjs grew three
  // cards: a board whose columns all fit reports `scrolling: 0` and passes the gutter claim by having
  // nothing to measure.
  expect(seen.titles, 'no card titles on the board').toBeGreaterThan(3);
  expect(seen.twists, 'no disclosure glyphs on the board').toBeGreaterThan(3);
  expect(
    seen.scrolling,
    'no column on the board overflows, so the scrollbar claim would measure nothing — see the crowd cards in visual/run.mjs',
  ).toBeGreaterThan(0);

  expect(
    seen.multiline,
    `card titles rendering on more than one line inside a fixed-height tile, where the box cuts the
     second line through the middle:\n  ${seen.multiline.map((t) => `${t.lines} lines — ${t.text}`).join('\n  ')}`,
  ).toEqual([]);
  expect(seen.small, 'disclosure glyphs below the legible floor').toEqual([]);
  // 4. ONE SIZE ACROSS THE TRANSPORT ROW. `Button size="md"` on the play control made it a step taller
  //    than the emergency stop, Settings and How it works beside it — `primary` is what says which control
  //    is the action, and it says it in a colour rather than in a box. The set is asserted rather than a
  //    value, for check 13's reason: a deliberate step change belongs in the drift baseline, not here.
  expect(seen.controls.length, 'the auto-pilot bar rendered no controls').toBeGreaterThan(3);
  expect(
    new Set(seen.controls.map((c) => c.px)).size,
    `the auto-pilot bar's controls are not one size: ${seen.controls.map((c) => `${c.id} ${c.px}`).join(', ')}`,
  ).toBe(1);
  // 5. AND NOTHING ON THE ROW IS MEANINGFULLY TALLER THAN THE TRANSPORT. The bordered group around the
  //    backend selector came out 29.8px against 20px buttons — the box drawn to make two things read as a
  //    pair was the tallest thing on the strip, which is the inconsistency it was added to remove.
  //
  //    AGAINST THE TRANSPORT AND NOT AGAINST THE TALLEST, which was the first version and was weaker than
  //    it looked: `ap-expand` measures 21px because the bigger disclosure glyph inside it sets its line
  //    box, so a ceiling of `max + 1` was 22px and the group slid under it. The reference has to be a
  //    control whose height nothing in this change moved.
  const transport = seen.controls.find((c) => c.id === 'ap-transport')?.h ?? 0;
  expect(transport, 'no transport button on the row to measure against').toBeGreaterThan(0);
  expect(seen.group, 'the auto-pilot bar has no .ap-agent group').not.toBeNull();
  const tall = [
    ...seen.controls.map((c) => ({ id: c.id, h: c.h })),
    { id: '.ap-agent', h: seen.group ?? 0 },
  ].filter((c) => c.h > transport + 2);
  expect(
    tall,
    `taller than the ${transport}px transport by more than 2px: ${tall.map((c) => `${c.id} ${c.h}px`).join(', ')}`,
  ).toEqual([]);
  for (const bar of seen.bars) {
    // `auto` and not `thin`: the app-wide rule is `thin`, so this is the assertion that the column's own
    // rule is reaching the element at all.
    expect(bar.width, 'a scrolling column fell back to the app-wide thin scrollbar').toBe('auto');
    // TWO COLOURS, and neither is `transparent`. The `*` rule pairs a `--border` thumb with a transparent
    // track — a bar you cannot see against the panel it sits on, which is what the owner reported. The
    // pair is asserted rather than the exact tokens: those are per-theme and this check runs on all three.
    // MATCHED, NOT SPLIT ON WHITESPACE, and the first version of this line was wrong in the way that
    // proves the point about verifying what a pattern matched: `rgb(127, 154, 163) rgb(17, 28, 34)` splits
    // into SIX tokens on `\s+`, because the commas inside a colour function carry spaces of their own.
    const parts = bar.color.match(/(?:rgba?|color|oklch|hsla?)\([^)]*\)|[a-z]+/g) ?? [];
    expect(parts.length, `scrollbar-color did not resolve to a pair: ${bar.color}`).toBe(2);
    // ZERO ALPHA, NOT THE KEYWORD, and this is the second half of the same lesson: `getComputedStyle`
    // resolves `transparent` to `rgba(0, 0, 0, 0)`, so `not.toContain('transparent')` — which is what
    // was written first — could never have fired against the app-wide rule it exists to reject. Verified
    // by feeding both forms through this pattern rather than by reading the spec.
    const invisible = parts.filter((p) => /,\s*0\)$/.test(p) || p === 'transparent');
    expect(invisible, `scrollbar-color leaves part of the bar invisible: ${bar.color}`).toEqual([]);
  }

  console.log(
    `[${theme}] affordances: ${seen.titles} titles all on one line, ${seen.twists} glyphs at or above ` +
      `${TWIST_FLOOR}px, ${seen.controls.length} controls at ${seen.controls[0]?.px}, group ${seen.group}px, ` +
      `${seen.scrolling}/${seen.columns} columns scrolling, asking for ` +
      `${seen.bars.map((b) => `${b.width} ${b.color}`).join(' | ')}`,
  );
});

// CHECK 13 — THE STATE INDICATORS ARE ONE SHAPE. The owner counted four implementations in one glance
// across two rows of chrome, and the merge in ui/StatusChip.tsx is what this holds in place.
//
// THE CLAIM IS NOT "they share a colour" — Phase 13 already did that, and it is asserted by
// test/state-tones.test.tsx without a browser. It is that they share a BOX and an AFFORDANCE: same
// element type, same computed size, same drawn edge, and every one of them opens. Three of those four
// are computed values, so this is the only place they can be held.
//
// WHY `<button>` IS ASSERTED RATHER THAN INFERRED FROM A CLICK: the agent chip was a `<span>` in its
// healthy state and a `<button>` once something broke, so a check that clicked whatever it found would
// have passed on the shape the owner objected to.
//
// AND WHAT THIS CHECK CANNOT SEE, measured by planting it: the harness runs with `VIBEBOARD_DOCKER_BIN`
// pointed at `/bin/false`, so the agent chip on this board is always `blocked` — it has advice, and it
// was a `<button>` even before the merge. Reverting the healthy branch to a `<span>` leaves this test
// green. The state that matters there is covered in jsdom, by test/autopilot-bar.test.tsx's *is a button
// you can open in the ready state too*, which fails on that plant. What is genuinely held HERE is the
// part jsdom cannot compute: that the indicators agree on a size, an edge and a corner.
test('13. the state indicators are one shape', async ({ board, theme }) => {
  const chips = await board.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.vb-status')).map((el) => {
      const style = getComputedStyle(el);
      return {
        id: el.dataset.testid ?? el.className,
        tag: el.tagName,
        fontSize: style.fontSize,
        borderWidth: style.borderTopWidth,
        // A pill. `--r-pill` is 999px and the browser clamps it to half the box height.
        radius: Number.parseFloat(style.borderTopLeftRadius),
        opens: el.getAttribute('aria-haspopup'),
      };
    }),
  );

  expect(chips.length, 'no status chip on the board — the merge left nothing to measure').toBeGreaterThan(1);
  expect(chips.map((c) => c.tag)).toEqual(chips.map(() => 'BUTTON'));
  expect(chips.map((c) => c.opens)).toEqual(chips.map(() => 'dialog'));
  // ONE SIZE, and it is the set that is asserted rather than a value: the point is that they agree, and
  // pinning 12px here would make a deliberate step change look like a regression in this check as well
  // as in the drift baseline, which is where a font-size change belongs.
  expect(
    new Set(chips.map((c) => c.fontSize)).size,
    `sizes: ${chips.map((c) => c.fontSize).join(', ')}`,
  ).toBe(1);
  expect(new Set(chips.map((c) => c.borderWidth)).size).toBe(1);
  for (const chip of chips) {
    expect(Number.parseFloat(chip.borderWidth), `${chip.id} draws no edge`).toBeGreaterThan(0);
    expect(chip.radius, `${chip.id} is not a pill`).toBeGreaterThan(4);
  }

  console.log(
    `[${theme}] indicators: ${chips.length} status chips — ${chips.map((c) => c.id).join(', ')} — all ` +
      `BUTTON at ${chips[0]?.fontSize} with a ${chips[0]?.borderWidth} edge`,
  );
});

// CHECK 14 — THE AUTO-PILOT BAR READS AS THREE GROUPS. The owner's layout, drawn by him as
// `|Start|Emergency stop|   |Backend selector|   |How it works|Settings|`.
//
// IT IS A REGRESSION GUARD ON A ROW THAT HAS NOW BEEN WRONG IN BOTH DIRECTIONS, which is why it is worth
// a check of its own rather than a line in check 12. First everything was jammed at the right: `.ap-status`
// held `flex: 1`, so the sentence took every spare pixel and the selector, the state and the three buttons
// after it were pushed hard against the right-hand edge in one queue. Removing the state chip from the top
// bar then moved the whole queue to the LEFT and left the right half of the strip empty. Neither shape was
// chosen; both were what one `flex` declaration happened to produce.
//
// MEASURED AS EDGES, not as `justify-content`. The layout is two `margin-left: auto` declarations, and a
// computed style would only report that they are there — it would not catch a `flex: 1` reappearing on a
// sibling, which is exactly what would silently eat them. So this reads where the boxes actually land.
const EDGE_SLACK = 2; // sub-pixel, plus the padding box vs the border box on the row itself.

test('14. the auto-pilot bar reads as three groups', async ({ board, theme }) => {
  const seen = await board.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-testid="ap-bar"] .ap-bar-row');
    if (!row) return null;
    const style = getComputedStyle(row);
    const box = row.getBoundingClientRect();
    const at = (sel: string) => {
      const el = row.querySelector<HTMLElement>(sel);
      return el ? { left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right } : null;
    };
    // THE LEFT GROUP'S RIGHT EDGE IS THE RIGHTMOST OF EVERYTHING THAT IS NOT ONE OF THE OTHER TWO GROUPS,
    // and computing it this way rather than naming a control is what makes the gap below a GAP. The first
    // version measured from the emergency stop, which is not the last thing in that group — the loop's state
    // chip and its sentence follow it — so it was measuring the distance ACROSS those, not the space after
    // them. It passed with the middle group's `push` deleted, on the chip's own width. Planted and caught.
    const left = Array.from(row.children)
      .filter((c) => !c.classList.contains('ap-agent') && !c.classList.contains('ap-bar-end'))
      .map((c) => c.getBoundingClientRect().right);
    return {
      content: {
        left: box.left + Number.parseFloat(style.paddingLeft),
        right: box.right - Number.parseFloat(style.paddingRight),
      },
      leftGroup: { count: left.length, right: Math.max(...left) },
      transport: at('[data-testid="ap-transport"]'),
      kill: at('[data-testid="ap-kill"]'),
      agent: at('[data-testid="ap-agent"]'),
      end: at('.ap-bar-end'),
    };
  });

  expect(seen, 'no auto-pilot bar row on the board').not.toBeNull();
  const { content, transport, kill, agent, end } = seen ?? {};
  for (const [name, part] of Object.entries({ transport, kill, agent, end })) {
    expect(part, `${name} is not on the row`).not.toBeNull();
  }
  if (!content || !transport || !kill || !agent || !end) return;

  // THE LEFT GROUP STARTS AT THE LEFT EDGE, and the emergency stop is beside it rather than adrift.
  expect(
    Math.abs(transport.left - content.left),
    'the transport is not at the row’s left edge',
  ).toBeLessThanOrEqual(EDGE_SLACK);
  expect(kill.left).toBeGreaterThan(transport.right - 1);

  // THE RIGHT GROUP ENDS AT THE RIGHT EDGE. This is the half the owner asked for twice, from both sides.
  expect(
    Math.abs(end.right - content.right),
    'the explanations are not at the row’s right edge',
  ).toBeLessThanOrEqual(EDGE_SLACK);

  // AND THE AGENT GROUP IS BETWEEN THEM, WITH REAL SPACE ON BOTH SIDES. The gaps are what make this three
  // groups rather than three adjacent things: a bar whose middle group is touching one of its neighbours is
  // the queue this check exists to refuse. Floored well under the ~200px each gap measures at 1440, so
  // ordinary content growth cannot fail it — a queue reads as single-digit gaps, not as a hundred pixels.
  expect(seen?.leftGroup.count, 'nothing in the left group to measure from').toBeGreaterThan(1);
  const before = agent.left - (seen?.leftGroup.right ?? 0);
  const after = end.left - agent.right;
  expect(agent.left, 'the agent group is left of the controls that act').toBeGreaterThan(kill.right);
  expect(end.left, 'the agent group is right of the explanations').toBeGreaterThan(agent.right);
  expect(before, `only ${before.toFixed(1)}px between the left group and the agent group`).toBeGreaterThan(
    24,
  );
  expect(after, `only ${after.toFixed(1)}px between the agent group and the explanations`).toBeGreaterThan(
    24,
  );

  // AND EVERY CONTROL SHARES THE ROW'S CENTRE LINE. Its own claim rather than part of check 7: that one
  // asks whether the row WRAPPED — the band its children occupy against the tallest of them — and a chip
  // sitting three pixels high passes it comfortably, which is how this shipped. The owner saw it.
  //
  // NESTED ONE LEVEL, because the offender was nested: `.pop-wrap` inside `.ap-agent` was off by 1.88px
  // while `.ap-agent` itself was exactly centred, so a direct-children-only version would have reported
  // half of this defect. 1px of tolerance for the sub-pixel heights the segmented control lands on.
  const off = await board.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-testid="ap-bar"] .ap-bar-row');
    if (!row) return [];
    const box = row.getBoundingClientRect();
    const mid = box.top + box.height / 2;
    const centres: { id: string; delta: number }[] = [];
    const walk = (el: Element, depth: number): void => {
      for (const child of Array.from(el.children)) {
        const b = child.getBoundingClientRect();
        if (b.height > 0) {
          centres.push({
            id: (child as HTMLElement).dataset.testid ?? child.className,
            delta: b.top + b.height / 2 - mid,
          });
          if (depth < 1) walk(child, depth + 1);
        }
      }
    };
    walk(row, 0);
    return centres;
  });
  expect(off.length, 'nothing on the row to align').toBeGreaterThan(3);
  const adrift = off.filter((c) => Math.abs(c.delta) > 1);
  expect(
    adrift,
    `off the row's centre line: ${adrift.map((c) => `${c.id} ${c.delta.toFixed(2)}px`).join(', ')}`,
  ).toEqual([]);

  console.log(
    `[${theme}] bar layout: ${off.length} controls on one centre line; ` +
      `transport at ${transport.left.toFixed(0)} (edge ${content.left.toFixed(0)}), ` +
      `left group ends ${(seen?.leftGroup.right ?? 0).toFixed(0)}, gap ${before.toFixed(0)}px, ` +
      `agent ${agent.left.toFixed(0)}–${agent.right.toFixed(0)}, ` +
      `gap ${after.toFixed(0)}px, end ends ${end.right.toFixed(0)} (edge ${content.right.toFixed(0)})`,
  );
});
