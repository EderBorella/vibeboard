---
name: gates
description: Use before claiming any VibeBoard change is done, green or mergeable — the order the checks run in, what each one can and cannot see, and how to prove one is live rather than reading its exit code.
---

# The gates, and how to earn the tick

A passing check proves the code ran, not that anything holds it in place. Work through this in
order; every step has an output you must actually read.

## 1. The chain, in order

```bash
npm run lint
npm run check
npm test
```

`npm run check` is four typechecks (`src`, `web`, `test`, `visual`) **and ten source gates** under
`tools/`. It is the real gate — `npm test` alone passes over things it cannot see.

- `check:citations` — every `decision NN` / `ruling NN` / `S`/`C` slice reference in `src/`,
  `web/src/` and `test/` has a row in `docs/decisions.md`. It flattens lines first, because
  citations wrap and a grep misses those. **Adding a citation means adding a row.**
- `check:scale` — every authored `font-size` is one of five type steps; every `gap`, `padding`,
  `margin` is on the seven-step space grid; every `letter-spacing` is `var(--track)`, `normal` or a
  named exception; every `top`/`right`/`bottom`/`left`/`inset` is on the same grid.
- `check:radius-scale` — four radii plus `50%`, **and** no class rendered on a `<button>`,
  `<Button>` or `Surface as="button"` declares its own geometry outside the primitive layer. When a
  geometry finding looks impossible, **check its `TAGS` list first** — it has twice been blind to a
  tag, and both times a padding and a radius exited 0 against a ceiling of zero.
- `check:box-scale` — heights are `--ctl-h` / `--mark-h` / `--tile-h` / `0` / `auto` / `100%` / a
  viewport unit / a named exception; border widths `1px`, `var(--rule)` or `0`; shadows `--glow` /
  `--lift` / a comma-pair / `none`; every `z-index` one of the four `--z-*`. Its exceptions are keyed
  on the **selector**, so a row no rule exercises is itself a finding.
- `check:class-budget` — the ratchet. 230, zero slack.
- `check:layers` — direction is one-way, blocking at zero.
- `check:shape-coverage`, `check:name-resolution`, `check:state-tones`, `check:tokens`.

`check:tokens` also asserts that a property defined in one `[data-theme]` block is defined in all
three. It exists because `--warn` was referenced by the stylesheet and defined by **no** theme, so
every theme fell through to a hardcoded dark-ground fallback and the light one wore it.

## 2. What jsdom cannot see — run the browser harness

```bash
npm run visual
```

Mandatory for anything geometric, focusable, themed or selector-touching. jsdom has no layout
engine and **builds an unknown element without complaint**: 4,501 unit tests once passed over
`Control as="trigger"` rendering a literal `<trigger>` — invalid HTML, not focusable. Three themes;
a finding in one is a finding.

Read the drift **before** re-recording anything. Re-recording first destroys the evidence.

## 3. Plant the defect — this is the step that is actually the gate

**Do not claim a check holds because it exited 0.** For each gate your change relies on:

1. Break something it should catch.
2. Run it. Watch it fail, and read what it said.
3. Restore.
4. Report the planted-defect result, not the green tick.

Two traps this repository has already fallen into:

- **A plan's claim about what a plant proves is not evidence.** One plant described as "live today"
  was inert: with `height: var(--mark-h)` declared, restoring `line-height` cannot move the box —
  withdrawing the *height* is what fails the claim.
- **A check must never be the reason a class survives**, and a filter keyed on a **name** goes inert
  the moment the name is retired.

## 4. Before committing

- `git diff --staged` — read it. The pre-commit hook checks the **index, not the working tree**, and
  both halves of getting that wrong were reproduced before it was written.
- No host path, personal name or machine-specific detail.
- **No committed file cites `notes/` or `docs/superpowers/`** — both gitignored, so it is a dangling
  pointer in every clone.
- Any comment the change made untrue is deleted or corrected. That is the worst defect class here,
  because nothing can see it.
- Selectors migrated in the same change as the classes they select — unit tests, Storybook stories
  and the Playwright fixtures.

## 5. What no gate in this repository can see

State these as limits rather than re-discovering them as findings:

- **No gate reads a `width`.** `check:scale` covers font sizes, gaps, paddings, margins,
  letter-spacing and offsets — not widths.
- **The drift baseline records font sizes, radii and the two height sets only**, so it cannot see a
  gap or a padding at all.
- `src/core/`'s purity gate is **unarmed**: one value edge upward remains (`find.ts` →
  `store/cards/board.js`). Purity is checked by following the import graph from `core/tick.ts`,
  never by grepping the directory.
- `npm run mutate` is deliberately not in the hook. It answers "would anyone notice if this broke",
  and it takes minutes.
