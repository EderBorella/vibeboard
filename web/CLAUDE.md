# VibeBoard front end — working instructions

Loaded whenever the work is under `web/`, on top of the root `CLAUDE.md`, so these rules are in
context exactly when a component or a stylesheet is being changed.

## The front end is atomic, and the direction is gated

`design/ → atoms/ → molecules/ → organisms/ → templates/ → pages/`. A layer may read downward and
never up; `npm run check:layers` blocks that at zero.

- **The cascade is declared once**, in [`web/src/styles.ts`](src/styles.ts) — 42 layer sheets,
  order load-bearing. The app, the Storybook preview and `test/css-box.tsx` all read that one list.
  A second copy would drift silently, and a workbench showing a cascade the app does not have is
  worse than one showing nothing.
- **No surface reinvents a primitive.** Raw controls outside the atom layer are a gate failure.
- **Class budget is a ratchet at 222, zero slack.** The stated target of 146 is the number to
  revisit, not the tree: the 30 remaining single-declaration classes are hover/`:disabled` inks,
  parent-selector anchors and genuine one-offs, and reaching 76 needs a *design ruling* that a
  surface may not have a hover ink of its own — not another merge.
- **Every value is on a scale**: five type steps, seven space steps, four radii, two box heights
  (`--ctl-h` 28px for what you operate, `--mark-h` 16px for what you read), four `--z-*` layers.
- **Two known gaps, stated so nobody re-discovers them as findings:** no **source** gate under
  `tools/` reads a `width`, and the drift baseline records only font sizes, radii and the two height
  sets — so it cannot see a gap or a padding at all.
  Corrected 2026-08-31: this file first said no gate reads a width at all, which is wrong and was
  copied from `docs/design-system.md`'s closing note. `visual/checks/board.spec.ts` sweeps
  `WIDTHS = [900, 1200, 1440]` and asserts `documentOverflow` on both axes at each — so the browser
  harness does measure widths. What it does not do is read authored `width` declarations out of the
  stylesheets, which is what the source gates do for every other value.

Read Part Five of `docs/design-system.md` before touching a stylesheet.
