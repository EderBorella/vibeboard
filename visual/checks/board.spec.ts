import { auditFocus, auditStyles, documentOverflow, type Offender } from '../support/audit.js';
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
//   RADIUS still REPORTS. Its count is 6, and driving it to zero is Phase 3's job.
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
  contrast: 80,
  tokens: 15,
  focus: 30,
  rows: 10,
};

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
      contrast: styles.contrast.examined,
      tokens: styles.tokens.examined,
      rows: styles.rows.examined,
      focus: focus.examined,
      focusUnfocusable: focus.unfocusable,
    },
    findings: {
      overflow: styles.overflow.offenders.length,
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

test('2. radius — conformance REPORTING, drift BLOCKING', async ({ board, theme }) => {
  const styles = await auditStyles(board);
  expect(styles.elements).toBeGreaterThan(FLOOR.elements);
  const values = Object.keys(styles.radii);
  const baseline = await readBaseline(theme);
  const moved = drift(styles.radii, baseline.radii);
  console.log(
    [
      `[${theme}] radius: ${values.length} distinct non-zero corner values across ${styles.elements} visible elements`,
      `  ${tallyLine(styles.radii)}`,
      `  ${driftLine(moved)}`,
    ].join('\n'),
  );
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

  // And the document itself, at the three widths the board's shared column grid is designed around.
  // A horizontal scrollbar on a cockpit is the fault that has been reported by eye and that jsdom
  // cannot see: it has no layout engine, so every box it measures is zero by zero.
  for (const width of [900, 1200, 1440]) {
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
