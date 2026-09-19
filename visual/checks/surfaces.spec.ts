import type { Page } from '@playwright/test';
import { auditFocus, auditStyles, type Offender, RUN_TIME_TOKENS, TYPE_SCALE } from '../support/audit.js';
import {
  type Baseline,
  expect,
  readBaseline,
  recording,
  type SurfaceBaseline,
  test,
  writeBaseline,
} from '../support/fixtures.js';
import { SURFACES, type Surface } from '../support/surfaces.js';

// EVERY CHECK ON EVERY REACHABLE SURFACE. Phase 6 of docs/design-system.md.
//
// `visual/support/fixtures.ts` used to be the whole of this harness's navigation — one `page.goto('/')`
// — so all thirteen of Part One's gates were gates on the BOARD VIEW. Contrast at 4.5:1, focus visible,
// nothing overflows, nothing clips, no unresolved token, computed type and radius conformance: thirteen
// gates, one page. The other nine surfaces in `support/surfaces.ts` had never been inspected by any of
// them.
//
// WHICH CHECKS RUN HERE, AND WHICH DELIBERATELY DO NOT. Checks 1–6 and 8 are per-surface questions and
// they all run below. The three that stay in board.spec.ts are board-specific by construction and not
// by omission:
//   9  the shared column grid — there is one board, and the claim is that its three rows share tracks;
//   10 the dock's definite height — one dock, measured through the real controls that fill it;
//   11 the readout's tabular advance — a claim about a FACE, identical on every surface that renders
//      one, and asserted per THEME rather than per surface.
// Check 7's generic half (any flex row of three or more children sits on one line) runs here; its two
// named rows — the auto-pilot bar and the top bar, the two that have actually wrapped in front of the
// owner — stay where they are, because they are on the shell and not on a surface.
//
// EVERY NUMBER BELOW IS A RATCHET, NOT A ZERO, AND THAT IS THIS DOCUMENT'S OWN RULE RATHER THAN A
// CONCESSION. Pointing a blocking gate at a backlog nobody has cleared means bypassing it on every
// commit, which teaches everyone to ignore it — so the count each check finds on each surface is
// recorded and any increase blocks. The board's own numbers keep their existing ceilings, in
// board.spec.ts, at the values they held before this phase: a surface's backlog must not be allowed to
// raise the board's.
//
// TYPE AND RADIUS CONFORMANCE ARE THE ONE PLACE THAT DEPARTS FROM PART ONE. On the board both are
// BLOCKING AT ZERO and stay blocking at zero. On a surface no check has ever inspected they are
// ratchets, for the same reason they were ratchets on the board until Phase 2 and Phase 3 drove them
// there. Phases 7–10 are what take them to zero.

// Two anti-vacuity guards, and each catches a different failure.
//
// The RECORDED count catches a surface that shrank — a container that collapsed, a list that stopped
// loading, a modal that renders its frame and none of its fields. Playwright's own retries cannot see
// that: the surface's `prove` step passed, so the page is right; there is simply less of it.
//
// The surface's own `floor` catches a surface that was recorded EMPTY. A count floor read out of the
// baseline can only ever agree with whatever was there when `visual:record` last ran, so recording a
// vacuous surface would bless it forever. That is not hypothetical: on the fixture as it stood before
// this phase, the Execution view was three empty panels and the Project Log's filed column was one
// sentence.
function assertExamined(surface: Surface, now: Record<string, number>, then: SurfaceBaseline | null): void {
  expect(
    now.elements,
    `[${surface.name}] examined ${now.elements} element(s), under the absolute floor of ` +
      `${surface.floor.elements}. Either the surface did not render, or the fixture has nothing on it — ` +
      `an empty surface examines almost nothing, and a check that examines nothing passes.`,
  ).toBeGreaterThanOrEqual(surface.floor.elements);
  expect(now.textElements).toBeGreaterThanOrEqual(surface.floor.text);
  expect(now.contrast).toBeGreaterThanOrEqual(surface.floor.contrast);
  expect(now.focus).toBeGreaterThanOrEqual(surface.floor.focus);
  if (!then) return;
  for (const [what, floor] of Object.entries(then.examined)) {
    expect(
      now[what] ?? 0,
      `[${surface.name}] the ${what} walk examined ${now[what] ?? 0}, against ${floor} when this was ` +
        `recorded. Less of the surface is being measured than was — if that is deliberate, re-record ` +
        `with \`npm run visual:record\`.`,
    ).toBeGreaterThanOrEqual(floor);
  }
}

// A ratchet per check, named, with the finding list printed whether or not it passes: a finding list
// nobody sees is a finding list nobody fixes, and Phases 7–10 are the ones that have to fix these.
function ratchet(
  surface: string,
  check: string,
  examined: number,
  offenders: Offender[],
  ceiling: number | undefined,
): void {
  const head = `[${surface}] ${check}: ${offenders.length} finding(s) across ${examined} examined`;
  const body = offenders.map((o) => `  ${o.where} — ${o.detail}`).join('\n');
  console.log(offenders.length > 0 ? `${head}\n${body}` : head);
  // Undefined means this surface has no recorded ceiling yet, which happens on exactly one run: the
  // one that records it. Asserting against zero there would fail the recording run for succeeding.
  if (ceiling === undefined) return;
  expect(
    offenders.length,
    `[${surface}] ${check} went from ${ceiling} finding(s) to ${offenders.length}:\n${body}\n` +
      `  This is a RATCHET at what Phase 6 found, not a gate at zero — drive it down, never up.`,
  ).toBeLessThanOrEqual(ceiling);
}

// What moved, by value, symmetrically. GONE fails as loudly as NEW for the reason board.spec.ts gives:
// a value disappearing is usually progress, and is also how a whole surface stops rendering.
function drift(now: string[], then: string[]): string[] {
  return [
    ...now.filter((v) => !then.includes(v)).map((v) => `NEW ${v}`),
    ...then.filter((v) => !now.includes(v)).map((v) => `GONE ${v}`),
  ];
}

// EVERY MEASUREMENT OF A SURFACE, in one place, so the recording pass and the checking pass cannot
// disagree about what they measured. The recording pass writes exactly what the checks then read.
async function measure(page: Page, surface: Surface): Promise<SurfaceBaseline> {
  const styles = await auditStyles(page, { root: surface.root });
  // The same Tab press the focus check needs, and for the reason audit.ts gives: Chromium matches
  // `:focus-visible` on a programmatic focus only when the last interaction was a keypress.
  await page.keyboard.press('Tab');
  const focus = await auditFocus(page, { root: surface.root });
  return {
    fontSizes: Object.keys(styles.fontSizes).sort(),
    radii: Object.keys(styles.radii).sort(),
    controlHeights: Object.keys(styles.controlHeights).sort(),
    markerHeights: Object.keys(styles.markerHeights).sort(),
    examined: {
      elements: styles.elements,
      textElements: styles.textElements,
      overflow: styles.overflow.examined,
      clipping: styles.clipping.examined,
      contrast: styles.contrast.examined,
      tokens: styles.tokens.examined,
      rows: styles.rows.examined,
      focus: focus.examined,
    },
    findings: {
      type: styles.type.offenders.length,
      radius: styles.radius.offenders.length,
      overflow: styles.overflow.offenders.length,
      clipping: styles.clipping.offenders.length,
      contrast: styles.contrast.offenders.length,
      tokens: styles.tokens.offenders.length,
      rows: styles.rows.offenders.length,
      focus: focus.offenders.length,
    },
  };
}

// Recorded in one test rather than one per surface, because `visual:record` greps on this title and a
// baseline file written by ten separate tests would be ten separate reads and writes of one file.
test('record the baseline for every surface', async ({ board, theme }) => {
  test.skip(!recording, 'recording only — run npm run visual:record');
  const surfaces: Record<string, SurfaceBaseline> = {};
  for (const surface of SURFACES) {
    // A fresh board per surface, exactly as the checking tests get: the overlays do not close
    // themselves and a settings modal left open would be measured as part of the next surface.
    await board.reload();
    await board.locator('[data-testid="ap-bar"]').waitFor({ state: 'visible' });
    await surface.open(board);
    await surface.prove(board);
    surfaces[surface.name] = await measure(board, surface);
    console.log(`[${theme}] recorded ${surface.name}: ${JSON.stringify(surfaces[surface.name].findings)}`);
  }
  // MERGED INTO THE EXISTING FILE rather than written over it. The board's own tallies and its six
  // finding counts are Part One's baseline and this phase does not touch them; a recording pass that
  // rewrote the whole file would silently re-bless whatever the board is doing today.
  const existing = await readBaseline(theme);
  const merged: Baseline = { ...existing, surfaces };
  await writeBaseline(theme, merged);
});

for (const surface of SURFACES) {
  test(`12. ${surface.name} — every check on ${surface.what}`, async ({ board, theme }) => {
    await surface.open(board);
    // PROVEN BEFORE MEASURED. Without this the checks below would happily examine the board again and
    // report a clean conformance under this surface's name — ten measurements of one page, which looks
    // exactly like coverage. Each `prove` names something only this surface renders, and the five
    // top-level views that are not the board additionally assert the board is gone.
    await surface.prove(board);

    const baseline = await readBaseline(theme);
    const then = baseline.surfaces?.[surface.name] ?? null;
    const styles = await auditStyles(board, { root: surface.root });
    await board.keyboard.press('Tab');
    const focus = await auditFocus(board, { root: surface.root });

    const now = {
      elements: styles.elements,
      textElements: styles.textElements,
      overflow: styles.overflow.examined,
      clipping: styles.clipping.examined,
      contrast: styles.contrast.examined,
      tokens: styles.tokens.examined,
      rows: styles.rows.examined,
      focus: focus.examined,
    };
    console.log(
      `[${theme}] ${surface.name}: root ${surface.root ?? 'document'}, examined ${JSON.stringify(now)}`,
    );
    assertExamined(surface, now, then);

    // The two probes, asserted here as well as on the board: a token that stopped resolving turns the
    // allow-list into "whatever this page happens to compute", which permits exactly what it exists to
    // refuse. They are read off a probe in the page, so they hold per surface too.
    // Counted off `TYPE_SCALE`, not written down — the same repair, and the same reason, as
    // board.spec.ts. The literal here and the list in audit.ts drifted apart the moment a step retired.
    expect(
      new Set(styles.scale).size,
      `the type scale did not resolve to ${TYPE_SCALE.length} steps: ${styles.scale}`,
    ).toBe(TYPE_SCALE.length);
    expect(
      new Set(styles.radiusScale).size,
      `the radius scale did not resolve to four steps: ${styles.radiusScale}`,
    ).toBe(4);
    expect(styles.type.examined, 'the type walk and the tally walk examined different populations').toBe(
      styles.elements,
    );
    expect(styles.radius.examined, 'the radius walk and the tally walk examined different populations').toBe(
      styles.elements,
    );

    ratchet(surface.name, '1. type conformance', styles.elements, styles.type.offenders, then?.findings.type);
    ratchet(
      surface.name,
      '2. radius conformance',
      styles.elements,
      styles.radius.offenders,
      then?.findings.radius,
    );
    ratchet(
      surface.name,
      '3. overflow',
      styles.overflow.examined,
      styles.overflow.offenders,
      then?.findings.overflow,
    );
    ratchet(
      surface.name,
      '3b. clipping',
      styles.clipping.examined,
      styles.clipping.offenders,
      then?.findings.clipping,
    );
    ratchet(
      surface.name,
      '4. contrast',
      styles.contrast.examined,
      styles.contrast.offenders,
      then?.findings.contrast,
    );
    ratchet(
      surface.name,
      '5. tokens',
      styles.tokens.examined,
      styles.tokens.offenders,
      then?.findings.tokens,
    );
    // EVERY RUN-TIME TOKEN IS PROVEN ON THE ONE SURFACE THAT SUPPLIES IT. `--exec-cols` is excused on
    // the nine surfaces that do not render `main.execution`; on Execution itself it must actually
    // resolve, or the excuse would survive the inline style being dropped and the ruling would become
    // an allow-list. Named in RUN_TIME_TOKENS with the reason; see visual/support/audit.ts.
    // An `owner` nobody renders proves nothing at all, so the name is checked against the surface list
    // rather than trusted — the same reason `CHIP_EXEMPT` is keyed on a whole selector.
    for (const token of RUN_TIME_TOKENS) {
      expect(
        SURFACES.map((s) => s.name),
        `${token.name} names ${token.owner} as the surface that proves it, and there is no such surface`,
      ).toContain(token.owner);
    }
    const owned = RUN_TIME_TOKENS.filter((token) => token.owner === surface.name);
    for (const token of owned) {
      // THE SUPPLIER IS ASSERTED PRESENT, because a `supplier` that matches nothing makes the excuse
      // UNCONDITIONAL everywhere and no other assertion here can see it: on this surface the token
      // resolves either way, and on the other nine it is excused either way.
      expect(
        await board.locator(token.supplier).count(),
        `[${surface.name}] ${token.name}'s supplier \`${token.supplier}\` matches nothing on the ` +
          `surface that owns it, so the excuse in RUN_TIME_TOKENS is now unconditional.`,
      ).toBeGreaterThan(0);
    }
    expect(
      styles.tokens.excused.filter((name) => owned.some((token) => token.name === name)),
      `[${surface.name}] ${owned.map((t) => t.name).join(', ')} is supplied by this surface, so it must ` +
        `resolve HERE rather than be excused — the element named in RUN_TIME_TOKENS is not rendering it.`,
    ).toEqual([]);
    ratchet(surface.name, '6. focus', focus.examined, focus.offenders, then?.findings.focus);
    ratchet(surface.name, '7. rows', styles.rows.examined, styles.rows.offenders, then?.findings.rows);

    // DRIFT ON THE VALUE SET, blocking in both directions. The board records tallies and compares the
    // set behind them; a surface records only the set, because its element counts move with the
    // fixture's content while its type does not. See SurfaceBaseline in fixtures.ts.
    if (then) {
      // A BASELINE RECORDED BEFORE THESE TWO FIELDS EXISTED IS REPORTED, NOT SKIPPED. `then.controlHeights`
      // is `undefined` on every file written before the atom phase, and `?? []` would have made both new
      // fields read as "everything is NEW" — which is true and is also the right answer: the phase that
      // adds a recorded measurement is the phase that re-records. What must NOT happen is the third
      // option, a silent pass, which is a field that checks nothing until somebody remembers it.
      const moved = [
        ...drift(Object.keys(styles.fontSizes).sort(), then.fontSizes).map((d) => `font-size ${d}`),
        ...drift(Object.keys(styles.radii).sort(), then.radii).map((d) => `border-radius ${d}`),
        ...drift(Object.keys(styles.controlHeights).sort(), then.controlHeights ?? []).map(
          (d) => `control height ${d}`,
        ),
        ...drift(Object.keys(styles.markerHeights).sort(), then.markerHeights ?? []).map(
          (d) => `marker height ${d}`,
        ),
      ];
      expect(
        moved,
        `[${theme}] ${surface.name} computed values drifted from visual/baseline/${theme}.json.\n` +
          `  If this was NOT deliberate, the values above are the regression.\n` +
          `  If it WAS deliberate, re-record with \`npm run visual:record\` and commit it.`,
      ).toEqual([]);
    }
  });

  // CHECK 8 PER SURFACE — every primitive on it is reachable by Tab and shows a ring.
  //
  // Its own test rather than a branch in the one above, because it is a different kind of measurement:
  // it walks the real tab order rather than the DOM, which is the only way to catch a control a mouse
  // can reach and a keyboard cannot. Check 6 above is a ratchet on a count, so a primitive that fell
  // out of the tab order would take its own row out of the population and leave the ratchet satisfied.
  //
  // The claim is BLOCKING AT ZERO rather than a ratchet, and it is the one claim in this phase that is:
  // it was already zero on the board, and a surface where it is not zero is a surface with a keyboard
  // fault rather than a styling backlog. If a surface fails it, that is a finding to report and not a
  // number to record.
  test(`8. ${surface.name} — every primitive shows a focus ring when tabbed to`, async ({ board, theme }) => {
    await surface.open(board);
    await surface.prove(board);

    const scope = surface.root ? `${surface.root} ` : '';
    const total = await board.locator(`${scope}.vb-btn`).count();
    const enabled = await board.locator(`${scope}.vb-btn:not(:disabled)`).count();
    expect(
      enabled,
      `no enabled .vb-btn on ${surface.name} — nothing would be measured, and a check that measures ` +
        `nothing passes`,
    ).toBeGreaterThan(0);

    // Enough presses to visit the whole document twice over, because the tab order is not ours to
    // predict and none of these overlays traps focus — a modal's own buttons may sit anywhere in it.
    const focusables = await board.locator('button, a[href], input, select, textarea, [tabindex]').count();
    for (let press = 0; press < focusables * 2 + 20; press += 1) {
      await board.keyboard.press('Tab');
      await board.evaluate((root) => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || !el.classList.contains('vb-btn')) return;
        // Scoped, so a button on the board BEHIND an overlay is not counted as one of the overlay's.
        const host = root ? document.querySelector(root) : document.body;
        if (!host?.contains(el)) return;
        // Measured against itself unfocused, which is the only comparison that means anything: a theme
        // may give a resting element an outline of its own.
        const focused = getComputedStyle(el);
        const ring = [focused.outlineStyle, focused.outlineWidth, focused.outlineColor].join(' ');
        const matched = el.matches(':focus-visible');
        el.blur();
        const resting = getComputedStyle(el);
        const bare = [resting.outlineStyle, resting.outlineWidth, resting.outlineColor].join(' ');
        el.focus();
        el.dataset.vbTabbed = ring !== bare && matched ? `ring ${ring}` : `NONE (focus-visible ${matched})`;
      }, surface.root);
    }

    const found = await board.evaluate((root) => {
      const host = root ? document.querySelector(root) : document.body;
      const all = host ? Array.from(host.querySelectorAll<HTMLElement>('.vb-btn')) : [];
      return all.map((el) => ({
        id: Array.from(el.classList).join('.'),
        disabled: el.matches(':disabled'),
        tabbed: el.dataset.vbTabbed ?? null,
      }));
    }, surface.root);
    const live = found.filter((p) => !p.disabled);
    const reached = live.filter((p) => p.tabbed !== null);
    const ringless = reached.filter((p) => !p.tabbed?.startsWith('ring '));

    console.log(
      `[${theme}] ${surface.name} primitives: ${reached.length} of ${live.length} enabled .vb-btn ` +
        `reached by Tab (${total - live.length} disabled, skipped), ${ringless.length} without a ring`,
    );
    expect(
      live.filter((p) => p.tabbed === null).map((p) => p.id),
      `these enabled .vb-btn on ${surface.name} could not be reached by Tab at all. A control only a ` +
        `mouse can reach is invisible to check 6, which walks the DOM rather than the tab order.`,
    ).toEqual([]);
    expect(
      ringless.map((p) => `${p.id}: ${p.tabbed}`),
      `these primitives on ${surface.name} showed no focus ring when tabbed to, on ${theme}`,
    ).toEqual([]);
  });
}
