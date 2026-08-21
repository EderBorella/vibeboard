# The design system, and how it lands in phases

**Status: planned, not started.** Nothing in `web/src/` has changed. This page is the argument and the
sequence; the work is phased so each phase ships on its own and can be reverted on its own.

---

## What is actually wrong

Measured against `web/src/styles.css` and `web/src/*.tsx` on 2026-08-20, not estimated:

| Measurement | Value | What it means |
|---|---|---|
| Class selectors defined | **432** | — |
| …of those, used once and only once | **278 (64%)** | Two thirds of the stylesheet is a one-off |
| Rules declaring a `border-radius` | **104** | A hundred hand-made rounded boxes |
| Distinct `border-radius` values | **8** | `6px`×62, `999px`×16, `8px`×8, `var(--radius)`×4, `50%`×3, `3px`×3, `4px`×2, `12px`×2 |
| Rules setting `font-size` | **52** | Type is re-decided per surface |
| Distinct `font-size` values | **27** | From `0.58rem` to `1.3rem` |
| Distinct `gap` values | 6 in the top band | `0.25` / `0.3` / `0.35` / `0.4` / `0.5` / `0.6rem` |
| CSS custom properties in use | 26 | Colour only — no type, space or radius tokens |

**The 27 font sizes are the symptom, not the cause.** The cause is that there are no primitives, so every
new surface invents its own button, chip and panel. Normalising the values without fixing that means the
next surface invents a new one, just from a nicer list.

### Deleting the one-offs is not enough on its own

**64% single-use means 36% is not — and 154 classes is still far more than a system needs.** Removing every
one of the 278 one-offs would land at **154**, which is already about the whole budget a systematised
stylesheet should have: six primitives with four or five variants each is roughly 30 classes, and ten
genuinely bespoke surfaces — the board grid, the dock, the two bars, the skill rail, the explorer, settings,
chat, card tabs, the diary — want perhaps 80 layout classes between them. So the arithmetic says the sweep in
Phase 5 **cannot only delete; it has to merge.**

That reframes what the phases are for. Every one-off removed is a class that was a re-implementation of a
shape; every *surviving* class then has to justify itself against the question "is this genuinely a different
thing, or the same thing under a second name?" — and on the evidence of 104 hand-made rounded boxes, most
answers will be the second.

**The target is a total, not a reduction:** `styles.css` under **150 class selectors**, measured, with the
closing number written into this page. A target expressed as "fewer than we have" is not a target.

The clearest evidence is `0.72` / `0.74` / `0.76` / `0.78` / `0.80` / `0.82rem` all being in use — a
2-hundredths-of-a-rem ladder nobody chose and nobody can see, which accumulates into an interface that
reads as unconsidered. Same for `gap`: `0.3rem` and `0.35rem` are 4.8px and 5.6px. No one can tell them
apart; everyone can tell that nothing lines up.

### It has already cost a real defect

Adding one button to the auto-pilot bar, there was nothing to reuse. The first attempt borrowed
`.reports-forgive` from the card report list and rendered at **10.88px against the bar's 12.16px**; the
second wrote a new class copying `.ap-expand`'s declarations verbatim. Neither was visible to the test
suite, because every UI test runs in jsdom, which has no layout engine and reports every box as zero by
zero. It was caught by measuring computed styles in a real browser.

That is the whole case for this work, and for the gate in Phase 0.

## What is NOT wrong, and must survive

**The three themes are the considered part of this codebase.** `web/src/themes.css` carries measured
contrast ratios, a deliberate split between `--accent` as ink and `--accent-fill` as a fill (because a
light theme cannot use one value for both), and per-theme decisions with reasons attached — *"no glow: a
halo on a light ground reads as a smudge rather than as light."*

So this is not a re-skin. **The identity stays; the mechanics get a system.** Any phase that would flatten
the cyberpunk wash, the marshmallow beige or the classic-dark slate into one look is out of scope, and a
component library that brings its own design language is refused for that reason.

---

## The system

### Type: six steps, whole pixels

```
--t-micro    0.6875rem   11px   chips, state words, dot labels, tags
--t-small    0.75rem     12px   controls, secondary text, table cells
--t-body     0.8125rem   13px   default UI text, card titles on the board
--t-lead     0.9375rem   15px   panel headings, an open card's title
--t-title    1.125rem    18px   surface titles
--t-display  1.5rem      24px   the one big number per surface
```

**Whole pixels at the 16px default base, deliberately.** Fractional rem values are what produced `10.88px`
and `13.12px` in the incident above — two sizes nobody could name, so nobody could see they disagreed. A
scale whose steps land on whole pixels is one a Playwright assertion can state exactly and a reviewer can
check by eye. The ratio is not constant (1.09 / 1.08 / 1.15 / 1.20 / 1.33): the working range is
compressed because a cockpit's text is small and dense, and the display range separates because a heading
has to win. A constant ratio would give either an unreadable ladder at the bottom or a wasteful one at the
top.

Six steps against 27 is the point. Anything that does not fit is a signal the surface is wrong, not that
the scale is short.

### Space: a 2px grid, seven steps

```
--s-1  2px      hairline separation, icon-to-label
--s-2  4px      inside a chip
--s-3  6px      inside a control
--s-4  8px      between controls
--s-5  12px     between groups
--s-6  16px     panel padding
--s-7  24px     between sections
```

Derived from what is already in use — the de facto values are 1, 2, 3, 6, 8, 10 and 12px — rounded onto a
2px grid. `1px` stays as it is: it is a border width, not a space, and there are 122 of them.

### Radius: four values

```
--r-sm    4px     inputs, small chips
--r-md    6px     buttons, cards, panels  (already the de facto default, 62 uses)
--r-lg    10px    surfaces and modals     (this is the existing --radius)
--r-pill  999px   state chips and tags    (already 16 uses)
```

`--radius: 10px` already exists and is used **four times**, while an untokenised `6px` is used 62. The
token was there and ignored, which is what happens to a token with no primitive to live in.

### The signature: the readout

**Every machine-measured fact is set in tabular monospace; everything a person wrote is not.**

```css
.readout {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
```

This is the one place to spend boldness, and it is grounded in what the product is: an instrument panel
for watching agents spend time and money. Durations, token counts, costs, iteration numbers, run ids and
attempt tallies are currently set in proportional type at whatever size the surrounding surface chose —
so a column of them does not align, and `449ms` next to `300.8s` is not comparable at a glance. Those two
numbers are precisely the diagnosis in a failure that cost an afternoon.

Tabular numerals make a column of figures line up on the digit. Monospace makes the distinction visible
without a label: **if it is monospaced, the machine measured it; if it is not, a person wrote it.** That
encodes something true about a board whose cards are human prose and whose runs are telemetry, which is
what a structural device is supposed to do.

It is also the cheapest possible signature: one class, one existing token (`--font-mono`), no new asset,
no webfont, no bytes.

---

## The primitives

Six, and the count is deliberate — each one exists because the measurements show a shape being rebuilt by
hand many times over.

| Primitive | Replaces | Variants |
|---|---|---|
| `Button` | the button cases among the 104 radius rules — `.ap-expand`, `.ap-settings-link`, `.ap-help-btn`, `.reports-forgive`, `.ap-remedy-btn`, and the rest | `primary` \| `default` \| `ghost` \| `danger`, sizes `sm` \| `md` |
| `Chip` | tags, state words, counts, badges | tones `neutral` \| `accent` \| `ok` \| `warn` \| `bad`, optional `pill` |
| `Dot` | `.ap-dot`, `.conn`, `.ap-agent-dot` — three hand-rolled indicators already | tones as `Chip`, sizes `7` \| `8` \| `12`px |
| `Panel` | board columns, drawers, settings sections, dock panes | `flat` \| `raised`, optional header slot |
| `Readout` | the signature above: every duration, cost, token count, run id | inline \| block |
| `Field` | `InlineField`, settings inputs, the gate form | label + control + hint + error |

**`Button`'s `ghost` variant carries a DASHED border**, ruled by the owner on 2026-08-20 reviewing the
samples. Not merely decorative: dashed reads as explanatory rather than actionable, which is what a help
affordance ("How it works") actually is, and it keeps the box the same size as a solid button — a
borderless ghost is 2px narrower and shifts the row it sits in. The radius conformance check in Phase 3
therefore asserts on `border-radius` and not on `border-style`.

**`Field` is last and least urgent** — it has the fewest sites and the most bespoke behaviour (inline
commit-on-blur editing). If the budget runs out, stopping before it leaves a coherent system.

What these are **not**: they are local components in `web/src/ui/`, styled with the existing CSS variables.
No new dependency, no CSS-in-JS, no utility framework. The behaviour-only libraries (Radix, Base UI) were
considered and are not needed for this: they solve complex widget behaviour — a menu, a combobox — and the
gap measured here is a *visual* vocabulary, which they deliberately do not supply.

---

## The gate: what Playwright can see that the suite cannot

Every UI test today runs in **jsdom, which has no layout engine** — every box measures zero by zero, so an
assertion about position compares zeroes and passes whatever the CSS does. Three layout faults have been
reported by eye and none could have been caught. This is the instrument that makes the phases below
verifiable rather than hopeful.

The browsers are already installed on this host and the system libraries are present, so the harness has
no prerequisite left to satisfy.

**What it will assert, per theme:**

1. **Type conformance** — every element's computed `font-size` is one of the six scale values. This is the
   assertion that would have caught the 10.88px/13.12px defect on the commit that introduced it.
2. **Radius conformance** — every computed `border-radius` is one of the four, or `50%`.
3. **Nothing overflows** — for every text element, `scrollWidth <= clientWidth + 1`; and the document does
   not scroll horizontally at 900px, 1200px and 1440px.
4. **Contrast** — the text/ground pairs the stylesheet actually puts together clear 4.5:1. `themes.css`
   claims measured contrast in prose today; this pins it.
5. **No unresolved token** — no computed colour resolves to empty or `rgba(0, 0, 0, 0)` where a value was
   intended, which is how `--warn` fell through to a hardcoded fallback before it was defined.
6. **Focus is visible** — every interactive element has a discernible `:focus-visible` style.
7. **One line where one line is meant** — the action rows that have twice wrapped stay unwrapped.

**A conformance gate starts as REPORTING, not blocking.** There are 27 font sizes today; a blocking gate
pointed at that backlog would have to be bypassed on every commit, which teaches everyone to ignore it. It
becomes blocking **in the phase that drives its count to zero**, and not before.

**Each gate must be proven by a planted defect before it is trusted.** A passing check proves the code ran,
not that anything holds it in place: change one font size to an off-scale value, watch the gate fail, then
restore it. A gate that has never failed on purpose is not known to work.

---

## The phases

Each phase is independently shippable, independently revertible, and ends with the suite green plus its own
gate. No phase changes behaviour — no endpoint, no state machine, no copy that carries a decision.

### Phase 0 — build the instrument

Introduce the browser harness. **No visual change at all.**

- `@playwright/test` as a dev dependency, pinned; config with a `webServer` that boots the real server
  against a scaffolded fixture project, so the app under test is the app.
- The seven checks above, written and running.
- Type and radius conformance run in **reporting** mode and record today's baseline: 27 sizes, 8 radii.

**Gate:** the harness runs green on all three themes; the two conformance checks report the baseline
without failing the build; one planted off-scale size is shown to be detected.
**Exit:** a number for every check, written into this page.
**Revert:** delete a directory and one devDependency.

### Phase 1 — add the tokens

Add the type, space and radius variables to `themes.css`. **Change nothing that consumes them.**

Purely additive, so the rendered result is byte-identical.

**Gate:** the visual harness reports **zero** difference from the Phase 0 baseline on all three themes.
That is the whole point of doing it as its own phase — a token that changes rendering is a token defined
wrong.
**Exit:** tokens exist and are unused.
**Revert:** one file.

### Phase 2 — collapse type and space onto the scale

Rewrite the 52 `font-size` declarations and the `gap`/`padding` values to tokens. This is the phase that
fixes what reads as unconsidered.

- 27 sizes → 6. Each of the 27 maps to its nearest step; where a surface then looks wrong, the surface is
  wrong.
- The `0.25`–`0.6rem` gap band → `--s-2`…`--s-4`.

**Gate:** type conformance turns **BLOCKING** in this commit — every computed `font-size` on every theme is
one of six values. Nothing overflows; no action row wraps. Screenshots reviewed by eye against Phase 0,
because "conforms to the scale" and "looks right" are different claims.
**Exit:** the type gate is blocking and green.
**Revert:** one file, and the gate returns to reporting.

### Phase 3 — Button, Dot, Chip

The three highest-frequency shapes. Replaces the button and chip cases among the 104 radius rules.

**Gate:** radius conformance turns **BLOCKING**. A CSS check that no rule outside the primitive block
declares its own `border-radius`, `padding` or `font-size` for a button-shaped element. Focus visible on
every primitive, keyboard-activated, in all three themes.
**Exit:** the single-use class count has dropped measurably from 278 — the number goes in this page.
**Revert:** per primitive, since each is a separate commit.

### Phase 4 — Panel

Board columns, drawers, settings sections, dock panes. Higher risk than Phase 3 because these carry
layout, and layout is where the container queries and the shared column grid live.

**Gate:** the board's three columns stay on one shared grid at 900/1200/1440px; the dock keeps its
definite height; nothing overflows. Measured, not eyeballed — these are exactly the faults jsdom cannot
see.
**Exit:** panels are one component.

### Phase 5 — Readout, Field, and the sweep

The signature lands, the last primitive arrives, and the dead classes go.

- `Readout` applied to every duration, cost, token count, run id and attempt tally.
- `Field` for the remaining inputs.
- Delete what is now unreferenced, **and merge what survives**. Deleting all 278 one-offs lands at 154,
  which is already the whole budget — so every surviving class is asked whether it is a different thing or
  the same thing under a second name.

**Gate:** a check that every class in `styles.css` is referenced from `web/src/`, blocking. A count of class
selectors, blocking at **under 150**. Numbers align
in a column — asserted by measuring two stacked readouts and comparing their glyph advance, since tabular
numerals are the claim.
**Exit:** one number for classes, one for font sizes, one for radii.

---

## Risks, and what would stop this

- **Class renames break tests.** There are **132** `querySelector('.class')` calls in the React tests. They
  are the blast radius, and they must be migrated to `data-testid` as each phase touches them, not left
  to a final sweep. A test that selects on a class turns a visual fix into a red suite, which is how a
  suite stops being trusted.
- **`web/src/shared.ts` is a deliberate hand-mirror** of `src/core/` types, guarded by a test. It is not
  to be "deduplicated" by any phase here.
- **A phase that cannot show a clean gate does not ship.** Reverting one phase must not require unpicking
  another, which is why tokens are added before anything consumes them.
- **Stop condition:** if Phase 2 lands and the interface still reads as unconsidered, the problem was
  never the scale, and Phases 3–5 should be re-argued before being built.

## What this explicitly does not do

- No component library, styled or headless — for the reason in *What is NOT wrong*.
- No Tailwind or any utility framework: it would mean a second styling paradigm beside 432 existing
  classes.
- No new typeface and no webfont. The three font stacks in `themes.css` stay; the signature is a treatment
  of type already present, not a new face.
- No behaviour change, no dark/light logic change, no fourth theme.
