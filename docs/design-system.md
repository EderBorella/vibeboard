# The design system, and how it lands in phases

**Status: Phases 0, 1 and 2 done (2026-08-21), Phases 3–5 planned.** Phase 0 built the instrument and
measured, touching no stylesheet; Phase 1 added the 17 tokens and nothing that consumes them; Phase 2
collapsed the type and space values onto them, which is the first phase that changes rendering. This page is
the argument and the sequence; the work is phased so each phase ships on its own and can be reverted on its
own.

---

## What is actually wrong

Measured against `web/src/styles.css` and `web/src/*.tsx` on 2026-08-20, not estimated:

| Measurement | Value | What it means |
|---|---|---|
| Class selectors defined | **457** | — |
| …of the 457, whose name appears exactly once in the CSS | **313 (68%)** | Two thirds of the rules are written for one class and no other |
| …of the 457, referenced exactly once from `web/src/**/*.{ts,tsx}` | **278 (60.8%)** | Three fifths of the stylesheet is a one-off |
| Rules declaring a `border-radius` | **104** | A hundred hand-made rounded boxes |
| Distinct `border-radius` values | **8** | `6px`×62, `999px`×16, `8px`×8, `var(--radius)`×4, `50%`×3, `3px`×3, `4px`×2, `12px`×2 |
| ~~Rules setting `font-size`~~ | ~~52~~ → **230 declarations** | Type is re-decided per surface. **The 52 is wrong** and Phase 2 corrected it: it counted rules by a method that missed the compact one-line rules this file is mostly made of. The real count is 230 declarations |
| Distinct `font-size` values | **27** | From `0.58rem` to `1.3rem` |
| Distinct `gap` values | 6 in the top band | `0.25` / `0.3` / `0.35` / `0.4` / `0.5` / `0.6rem` |
| CSS custom properties in use | 26 | Colour only — no type, space or radius tokens |

**The class counts carry their method, because three different answers have now been quoted for the same
property.** The first three rows are measured like this, and any re-measurement that wants to be comparable
has to be measured the same way: strip `/* … */` comments from `web/src/styles.css`, take the selector text
before each `{` (skipping at-rule preludes), extract every `.name` token, and count the distinct names —
**457**. Of those 457, the ones whose name occurs exactly once across all that selector text — **313**.
Also of those 457 — not of the 313, they are two independent counts over the same set — the ones whose name
occurs exactly once as a whole token across all 119 `web/src/**/*.{ts,tsx}` files: **278**, which is
**60.8%** of 457. The **432 / 278 / 64%** this table carried until 2026-08-21 was
wrong twice over: the total was short by 25, and the 64% was 278 measured against it rather than against
457. A target expressed against a number nobody can reproduce is not a target — see `docs/README.md`, which
withdrew a comment-ratio target for exactly this.

**The 27 font sizes are the symptom, not the cause.** The cause is that there are no primitives, so every
new surface invents its own button, chip and panel. Normalising the values without fixing that means the
next surface invents a new one, just from a nicer list.

### Deleting the one-offs is not enough on its own

**Deleting every one of the 278 one-offs leaves 179, and the target is under 150 — so the sweep cannot only
delete; it has to merge.** 457 − 278 = **179**, and the gap is not a rounding error: it is roughly **30
surviving classes that have to be merged into something else**, on top of every deletion. A systematised
stylesheet's whole budget is about that 150: six primitives with four or five variants each is roughly 30
classes, and ten genuinely bespoke surfaces — the board grid, the dock, the two bars, the skill rail, the
explorer, settings, chat, card tabs, the diary — want perhaps 80 layout classes between them. There is no
slack in it anywhere.

**The corrected numbers make this argument stronger, not weaker.** On the withdrawn 432 / 154 figures the
remaining work after the deletions looked like a handful of stragglers, and a plan can talk itself into
believing a handful will fall out on its own. 179 cannot be read that way: a fifth of what survives the
sweep still has to be merged, deliberately, and that is a piece of work with its own decisions rather than a
consequence of the deletions.

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
no prerequisite left to satisfy. **Verified rather than assumed** when Phase 0 landed: the cache holds
`chromium-1234` and `chromium_headless_shell-1234`, `chrome --version` answers *Google Chrome for Testing
151.0.7922.34*, `ldd` reports no missing shared library, and revision 1234 is exactly what `@playwright/test`
1.62.1 asks for — so the pin is chosen to match the browser on disk, not the other way round.

**What it will assert, per theme:**

1. **Type conformance** — every element's computed `font-size` is one of the six scale values. This is the
   assertion that would have caught the 10.88px/13.12px defect on the commit that introduced it.
2. **Radius conformance** — every computed `border-radius` is one of the four, or `50%`.

Checks 1 and 2 each make **two** claims, and they are gated differently — see the split below.
3. **Nothing overflows** — for every text element, `scrollWidth <= clientWidth + 1`; and the document does
   not scroll horizontally at 900px, 1200px and 1440px.
4. **Contrast** — the text/ground pairs the stylesheet actually puts together clear 4.5:1. `themes.css`
   claims measured contrast in prose today; this pins it.
5. **No unresolved token** — no computed colour resolves to empty or `rgba(0, 0, 0, 0)` where a value was
   intended, which is how `--warn` fell through to a hardcoded fallback before it was defined.
6. **Focus is visible** — every interactive element has a discernible `:focus-visible` style.
7. **One line where one line is meant** — the action rows that have twice wrapped stay unwrapped.

**Conformance reports; drift blocks.** Checks 1 and 2 make two separable claims, and conflating them is what
made the first version of this gate worthless.

- **Conformance** — "every computed `font-size` is one of the six", "every radius is one of the four" — becomes
  blocking **in the phase that drives its count to zero**, and not before: a gate pointed at a backlog has to
  be bypassed on every commit, which teaches everyone to ignore it. **Type is BLOCKING as of Phase 2**, which
  took it from 15 distinct computed sizes to 5. **Radius still REPORTS** at 6 values; that is Phase 3.
- **Conformance is asserted twice, in two places, and neither is redundant.** The harness measures what the
  board COMPUTES — including sizes no rule authored, like a UA default on a control — and `npm run
  check:type-scale` reads what the file AUTHORS, including the surfaces the harness never opens. Phase 0
  measured 15 computed against 27 authored, and the twelve-value gap is the whole argument: a browser gate
  alone would have passed with a dozen off-scale values still in the stylesheet.
- **Drift** — "the set of computed values is exactly the set in `visual/baseline/<theme>.json`" — is
  **BLOCKING**, on all three themes, since Phase 1. Its count is zero today, which is the same condition
  that licenses the five ratchets, so this is a gate at zero and not a gate pointed at a backlog.

The split was made because the reporting form had no teeth. A defect planted at `styles.css` — one rule
consuming `--t-display` — printed `NEW since baseline: 24px` on all three themes and the run still **exited
0**. A regression therefore reached the commit unless a person read a log line, which is the exact failure
mode the harness exists to remove: three layout faults in this repository's history were reported by eye and
missed by the suite.

**NEW and GONE fail symmetrically.** A value disappearing is usually progress, and from Phase 2 on it is the
normal case — but it is also how a whole surface stops rendering, because a container that collapsed takes
its text's font sizes with it, and the element floors in the spec are set too low to notice one collapsed
row. "Zero difference from the baseline" is not a one-directional claim.

**The deliberate update path is `npm run visual:record`, and the failure message names it.** A blocking gate
with no supported way to move its baseline is a gate that gets deleted the first time somebody legitimately
needs to move it — and Phase 2 changes 27 font sizes on purpose. The message therefore separates "you broke
something" from "you meant this, now record it". Verified rather than assumed on 2026-08-21: with a defect in
place, `visual:record` rewrote all three baseline files and the following `npm run visual` exited 0.

**Each gate must be proven by a planted defect before it is trusted.** A passing check proves the code ran,
not that anything holds it in place: change one font size to an off-scale value, watch the gate fail, then
restore it. A gate that has never failed on purpose is not known to work.

---

## The phases

Each phase is independently shippable, independently revertible, and ends with the suite green plus its own
gate. No phase changes behaviour — no endpoint, no state machine, no copy that carries a decision.

### Phase 0 — build the instrument — **DONE 2026-08-21**

The browser harness. **No visual change at all** — `styles.css` and `themes.css` are byte-identical, and the
built CSS bundle hashes the same before and after.

`@playwright/test` is pinned at **1.62.1** (exact, not a caret) and lives in `visual/`:

| file | what it is |
|---|---|
| `visual/run.mjs` | `npm run visual`. Owns the ONE per-run temp root and removes it; builds first, so the artefact under test matches the tree; scaffolds the fixture project by calling the product's own `scaffoldProject`. |
| `visual/playwright.config.ts` | `webServer` boots `node dist/server/main.js` on **4699** (never 4610, which is the owner's live board) against the fixture, with `~/.vibeboard` relocated into the temp root and docker pointed at `/bin/false`. |
| `visual/support/audit.ts` | Everything measured in the page. |
| `visual/checks/board.spec.ts` | The seven checks, three themes: 21 tests. |
| `visual/baseline/<theme>.json` | Today's numbers, which Phase 1's gate compares against. |

**What the browser actually measured, per theme** — identical on all three, because the themes change colour
and not metrics. The static prediction above was 27 font sizes and 8 radii **authored**; the browser sees
**15 computed sizes and 6 radius values on the board view**, and the difference is the point: authored values
that no board element computes (other views, other states) do not reach the eye, and computed values are what
a Playwright assertion can state.

| check | examined | result |
|---|---|---|
| 1. type (conformance REPORTING, drift BLOCKING) | 233 visible elements, 124 text-bearing | **15** distinct computed sizes: 10.4, 10.88, 11.2, 11.52, 11.84, 12, 12.16, 12.48, 12.8, 13.12, 13.3333, 13.6, 13.76, 16, 18.4px |
| 2. radius (conformance REPORTING, drift BLOCKING) | 233 visible elements | **6** distinct values: 6px×108, 999px×68, 10px×56, 8px×56, 50%×12, 3px×4 |
| 3. nothing overflows | 120 text elements + 3 viewport widths | **0** overflowing; no horizontal document scroll at 900/1200/1440 |
| 4. contrast ≥ 4.5:1 | 124 text/ground pairs, composited | **0** below 4.5:1 |
| 5. no unresolved token | 27 referenced custom properties | **2**: `--ink` (referenced at `styles.css:1807`, defined nowhere — a real defect) and `--exec-cols` (supplied by the Execution tab, which this board-only sweep does not visit) |
| 6. focus is visible | 55 focusable elements (1 disabled, skipped) | **0** without a discernible `:focus-visible` style |
| 7. one line where one line is meant | 25 flex rows, plus `.ap-bar-row` and `header.topbar` named and blocking | **0** wrapped |

The type and radius **counts** report and do not fail, as argued above; their **drift** from these recorded
values blocks. The other five **ratchet** against the recorded baseline rather than against zero — four of
them sit at zero, so for those the ratchet IS blocking.

**Every check was proven by a planted defect**, each reverted: an off-scale `0.5856rem` was named as
`9.3696px`; a `7px` radius was named as new; a 6px-wide `.tile-id` produced three overflow findings; a
`min-width: 2000px` shell made the document scroll at 900px; `#5a5a5a` ink reported 2.28:1; `var(--tile-ink-nope)`
raised the token count; a wrapped `.ap-bar-row` was caught; and `*:focus-visible { outline: none }` took focus
findings from 0 to 52 — which it did **not** do until `outline-offset` was removed from the compared
properties. That is the one repair the planting bought: the app's focus rules set both `outline` and
`outline-offset`, so the offset alone kept changing and every element went on reporting a focus style it no
longer had. **The focus check was vacuous and green before a defect was planted at it.**

**Revert:** delete `visual/`, one devDependency, `tsconfig.visual.json`, three `package.json` scripts and
three lines of `biome.jsonc`.

### Phase 1 — add the tokens — **DONE 2026-08-21**

**17 custom properties** — six type, seven space, four radius — added to the bare `:root` block of
`themes.css`. All three `[data-theme]` blocks are untouched, deliberately: a theme decides colour, and a
theme that disagreed about what 12px means is a theme with its own layout. **Nothing consumes them**, which
is the whole point of doing it as its own phase — a token that changes rendering is a token defined wrong.

**Gate:** the visual harness reports **zero drift** from the Phase 0 baseline on all three themes — 21
passed, exit 0. This is the phase in which that drift check became **blocking** rather than printed; see
*Conformance reports; drift blocks* above.

**The measured proof: the built CSS bundle differs by exactly the 17 added declarations and nothing else.**
Both bundles were built and compared declaration by declaration after minification: **2,607 declarations
before, 2,624 after; 17 added, all in `:root`, 0 removed and 0 changed.**

**The bundle's content hash necessarily changes, and a criterion of "identical hash" is unsatisfiable for an
additive phase.** The filename went from `index-DrjhdOCp.css` to `index-CycTQdwk.css` and the bundle from
61,213 to 61,462 bytes, because Vite hashes content and 249 bytes of new declarations are content. The
earlier phrasing — carried over from Phase 0, where "hashes the same" was true because nothing was added —
would fail this phase for succeeding. **The declaration-level diff is the real proof, and it is the criterion
Phase 2 must use too.**

**Browser-resolved, not derived by arithmetic** — `--t-micro` through `--t-display` measured in Chromium at
the 16px root: **11 / 12 / 13 / 15 / 18 / 24px**. The rem values are chosen to land on whole pixels
(`0.6875rem` is exactly 11px), which is why they must not be "tidied" to round rems: fractional steps are
what produced a button at 10.88px inside a 12.16px bar.

**`--r-lg` and the pre-existing `--radius` are both `10px`, and both are live.** `--radius` has **4**
consumers (`styles.css:339`, `:389`, `:1280`, `:1456`); `--r-lg` has **0**. That duplication is intentional
for now: `--radius` is deleted in the phase where a surface primitive owns those four sites, because renaming
a token while no caller exists buys nothing and splits the revert.

**Exit:** tokens exist and are unused. **Revert:** one file.

### Phase 2 — collapse type and space onto the scale — **DONE 2026-08-21**

The phase that fixes what reads as unconsidered, and the first one that changes rendering on purpose.

**230 `font-size` declarations, not 52.** The 52 in the measurement table above counted *rules*, and by a
method that missed the compact one-line rules this stylesheet is mostly made of. The real figure, from
`npm run check:type-scale`: **230 declarations carrying 27 distinct values, rewritten onto 5 tokens.**

| authored | → | why |
|---|---|---|
| `0.58` `0.6` `0.62` `0.64` `0.65` `0.66` `0.68` `0.7rem` | `--t-micro` 11px | 9.28–11.2px |
| `0.72` `0.74` `0.75` `0.76` `0.78rem`, and `0.85em` | `--t-small` 12px | 11.52–12.48px |
| `0.8` `0.82` `0.85` `0.86rem` | `--t-body` 13px | 12.8–13.76px |
| `0.9` `0.92` `0.95` `0.98` `1rem` | `--t-lead` 15px | 14.4–16px |
| `1.1` `1.15` `1.25` `1.3rem` | `--t-title` 18px | 17.6–20.8px |
| — | `--t-display` 24px | **nothing was near it** — no authored value was above 20.8px. Nearest-step therefore gave it nothing, and it is instead assigned deliberately, to `.markdown h1`, because nearest-step had collapsed h1 and h2 onto one size. See below |

`0.85em` on `.markdown code` is the only value **nearest-step could not place**, because `em` has no fixed
pixel value: it was 13.6px under the inherited 16px and would be 11.05px under `--t-body`. It is mapped one
step below the prose it sits in — `--t-small` under `--t-body` — which is what the declaration meant.

**Three sizes were never authored at all, and they were the hard part.** Collapsing the 27 got the count to
7, not 5. The rest was a default and a UA stylesheet:

- **16px on 94 of 233 elements.** Nothing set a `body` font-size, so everything that did not name one
  inherited the UA default. `body { font-size: var(--t-body) }` fixes all 94 at once, and leaves every `rem`
  untouched, since `rem` is root-relative and `body` is not the root.
- **13.3333px on three controls** — Chromium's UA font-size for `button`/`input`/`select`/`textarea`.
  `.copilot-x`, `.btn-primary` and `.btn-secondary` named no size, so they took it. Fixed at the cause with a
  four-selector reset rather than at the three sites, because the class is open-ended: any button added
  without a `font-size` gets it, and that is exactly the 10.88px incident's shape.
- **`.brand` at 16px**, the one thing in the top bar that was never sized. Given `--t-lead`, the nearest step,
  which keeps it the largest text in the row — the hierarchy the bar's baseline alignment exists to serve.

**`html` is excluded from the walk, and that is not a loophole.** Every step is expressed in `rem`, which is
root-relative, so asking whether the root's own font-size is on the scale is circular — and "fixing" it to a
step would rescale every `rem` in the file, including the steps. It carries no text.

**Space: 277 lengths in 230 `gap`/`padding` declarations, 10 distinct values → 3 tokens.** `0.25` `0.28`
`0.3rem` → `--s-2`; `0.32` `0.35` `0.4rem` → `--s-3`; `0.45` `0.5` `0.55` `0.6rem` → `--s-4`. Only that band,
which leaves hybrid declarations like `padding: 0.1rem var(--s-4)`: below `0.25rem` the nearest step is a
2–6× change on what is a hairline rather than a space, and above `0.6rem` is a band this phase does not
claim. Both remainders are refused by name in `check-type-scale.mjs` rather than quietly allowed.

**Gate: type conformance is BLOCKING as of this commit** — 15 distinct computed sizes to 5, on all three
themes, 232 elements each. Radius conformance still reports; that is Phase 3. Proven by a planted defect:
`0.5856rem` on `.tile-title` was named as `9.3696px on 3 element(s)` with the DOM path of each, and the run
exited **1**; restored, it exited **0**. The failure message names the offending elements and not only the
value, because a blocking gate nobody can act on is a gate that gets bypassed.

**The drift was read before it was re-recorded.** 4 NEW (13, 15, 11, 18px) and 14 GONE (16, 13.6, 11.52,
12.48, 12.16, 13.12, 10.88, 11.2, 12.8, 18.4, 13.76, 13.3333, 11.84, 10.4px), each traced to an authored
value in the table above or to one of the three unauthored sizes. A re-record done before reading the list is
how a real regression gets blessed into the baseline.

**Everything else held, measured not assumed:** overflow 0 of 120, contrast 0 of 124, wrapped rows 0 of 25,
focus 0 of 55 — unchanged on all three themes, despite 277 space values moving. Unresolved tokens **2 → 1**:
`--ink`, referenced at `.ap-remedy-btn` and defined by no theme, is now `--text`. That is what it was already
rendering — an invalid `var()` falls through to the inherited colour — and it is also the right answer, since
this is the one action on a stalled project and the three buttons beside it are deliberately `--muted`.
`--exec-cols` remains, and remains a gap in the harness's coverage rather than a defect.

**The bundle diff is the proof, and an identical hash is not available to a phase that emits different CSS.**
`index-CycTQdwk.css` → `index-DZ6uuO5q.css`, 61,462 → 64,614 bytes, **2,624 → 2,623 declarations in 644 → 645
rules**. Both bundles were built, then parsed and compared as multisets of `selector { property: value }`
after minification — the same criterion Phase 1 used, and the only one available to a phase that emits
different bytes on purpose. **467 declarations removed and 466 added**, every one of them `font-size`, `gap`,
`padding`, `padding-top`, `padding-bottom` or `padding-right`, except: `color: var(--ink)` → `var(--text)`,
and `height: 100dvh` moving from a duplicate property into `@supports`. The net **−1** is accounted for
exactly: **+3** `font-size` declarations added (`body`, `.brand`, the control reset) and **−4** because
`.exec-cost` and `.exec-when` now declare the same four things and esbuild merged them into one rule. The
rule count goes **up** by one, not down: the control reset and the `@supports` block add two, the merge
removes one.

**`.markdown h1` takes `--t-display`, which is where the top step found its first consumer.** Nearest-step
put `1.3rem` and `1.1rem` — 20.8px and 17.6px — both on `--t-title`, so h1 and h2 rendered identically at
18px, and a preview with two heading levels that look the same has one. h1/h2/h3 now compute to
**24 / 18 / 15px**. The scale was never short: `--t-display` is defined as "the one big number per surface",
and the largest heading of a rendered document is exactly that. It also means the step is no longer defined
and unused, which is a state a token should not stay in — Phase 1 said so about `--r-lg` and it was true here
too. The board view never renders `.markdown`, so the harness baselines do not move; the drift list was read
and was empty on all three themes.

**Two additions folded in here because they belong nowhere else:**

- **The stylesheets are under the linter.** `biome.jsonc` listed only `*.ts/.tsx/.mjs`, so `npm run lint` had
  been green on 1,800 lines of CSS it never opened — proven by planting a duplicate property in `themes.css`,
  which exited **0** before and exits **1** after. It found 9 things, driven to zero in the same change
  rather than left as a backlog: the `!important` pair on the `prefers-reduced-motion` blanket is
  **suppressed with its reason**, because `*` is specificity (0,0,0) and a user-preference override cannot
  win the cascade any other way; `.app-shell`'s duplicate `height` became `100vh` plus an
  `@supports (height: 100dvh)` block, which is the same computed height in both kinds of browser with the
  intent stated rather than inferred (**`100dvh` was the winner** in anything that understands it, and
  `100vh` only in a browser that drops the second declaration at parse time); and the six descending-
  specificity findings were fixed by **moving two rules later**, `.conn-status:hover .conn-text` and
  `.exec-cost + .exec-when`, each of which already won on specificity — a move, not a change.

  **The CSS linter is on and the CSS formatter is off** — `"css": { "formatter": { "enabled": false } }` —
  because adding the glob brought both, and the formatter is the half with a cost and no benefit. It cannot
  express the compact one-line rule that is this file's own idiom, and it took `styles.css` from **1,927 to
  4,348 lines**: `git diff --stat` then reported **4,405 changed lines**, inside which the 230 rewritten
  `font-size` declarations and 277 rewritten lengths were invisible. A phase whose own principle is
  "independently shippable, independently revertible" cannot be reviewed or reverted through a diff that is
  95% whitespace. The file was reconstructed in its compact form with every content change carried, and the
  diff is **847 changed lines**. **The proof that nothing was lost or invented is the bundle:** built from
  the formatted tree and from the reconstructed tree, the two CSS bundles are **byte-identical**, hash
  included — 2,622 declarations each, 0 added, 0 removed, 0 changed. The linter half kept every finding it
  made; it is proven still live by planting a duplicate property, which exits **1** with the formatter
  disabled.
- **A static check over the file, `tools/check-type-scale.mjs`, wired into `npm run check`.** The browser
  gate alone cannot verify "27 → 6": it sees the board, and twelve of the 27 lived on surfaces it never
  visits. Proven by planting `0.81rem` on `.exec-head`, an Execution-tab-only rule: the static check exited
  **1** naming `web/src/styles.css:1333`, and `npm run visual` on the same tree exited **0**. That is the
  entire reason it exists. It also refuses the `font:` shorthand carrying a length, which would otherwise
  walk straight past it, and it asserts a **floor of 150 declarations** — a pattern that stops matching
  reports zero findings and looks exactly like success, so that was planted too: a broken `FONT_SIZE` regex
  exits **1** with "this check is vacuous", not 0.

**Exit:** the type gate is blocking and green; 233 authored `font-size` declarations, all on the scale.
**Class selectors: 457, unchanged** — Phase 2 changes values, not classes, and Phase 5's target of under 150
is untouched by it.
**Revert:** `styles.css`, three baseline files, and the two gates return to reporting.

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
- Delete what is now unreferenced, **and merge what survives**. Deleting all 278 one-offs lands at 179,
  which is already over the whole budget — so every surviving class is asked whether it is a different thing
  or the same thing under a second name, and roughly 30 of them have to answer "the same thing".

**Gate:** a check that every class in `styles.css` is referenced from `web/src/`, blocking — **and read
*Thirty-six classes are never named literally* in *Risks* before writing it, because the naive version of
this gate deletes live code.** A count of class selectors, blocking at **under 150**. Numbers align
in a column — asserted by measuring two stacked readouts and comparing their glyph advance, since tabular
numerals are the claim.
**Exit:** one number for classes, one for font sizes, one for radii.

---

## Risks, and what would stop this

- **Class renames break tests.** There are **132** `querySelector('.class')` calls in the React tests. They
  are the blast radius, and they must be migrated to `data-testid` as each phase touches them, not left
  to a final sweep. A test that selects on a class turns a visual fix into a red suite, which is how a
  suite stops being trusted.
- **Thirty-six classes are never named literally in `web/src/`, and none of them is dead.** They are
  composed at run time from a prefix and a value, so a literal grep for the class name finds nothing —
  and Phase 5's gate is *"every class in `styles.css` is referenced from `web/src/`, blocking"*. **A naive
  implementation of that gate deletes all 36.** Measured on 2026-08-21, by the method beside the class
  counts at the top of this page: 457 defined, 36 with zero literal occurrences across
  `web/src/**/*.{ts,tsx}`. The four that make the shape clearest:

  | site | composes | classes it creates |
  |---|---|---|
  | `web/src/autopilot/AutopilotBar.tsx:126` | `` `ap-agent-state ap-agent-${agent.tone}` `` | `ap-agent-ok` `-warn` `-bad` `-unknown` |
  | `web/src/autopilot/AutopilotBar.tsx:130` | `` `ap-agent-dot ap-agent-dot-${agent.tone}` `` | `ap-agent-dot-ok` `-warn` `-bad` |
  | `web/src/autopilot/AutopilotBar.tsx:253` | `` `ap-bar ap-bar-${model.tone}` `` | `ap-bar-running` `-halted` `-stopped` `-complete` |
  | `web/src/autopilot/AutopilotBar.tsx:280` | `` `ap-dot ap-dot-${model.tone}` `` | `ap-dot-running` `-halted` `-complete` |

  And the rest of the 36, for the same reason and by the same mechanism: `AutopilotBar.tsx:257`
  (`ap-transport-stop`), `app/TopBar.tsx:115` (`ap-running` `ap-halted` `ap-complete`),
  `app/ConnectionLight.tsx:37` (the six `conn-*` states), `copilot/ChatSwitcher.tsx:51` (`bk-claude-code`
  `bk-opencode`), `runs/CardReports.tsx:54` with `runs/ReportPane.tsx:60` and `runs/ExecutionView.tsx:88`
  (the seven `chip-*` statuses) and `copilot/CopilotPanel.tsx:236` (`msg-user` `msg-assistant` `msg-error`).
  Twelve call sites in eight files, 36 classes, all live.

  **The defect this would cause has the worst possible shape.** Deleting them breaks every state colour on
  the auto-pilot bar, the connection light, the report chips and the chat messages — and it breaks them
  **only in the non-default states**. A board that has not failed anything looks perfectly correct; the
  colour that tells you a run halted is the one that has gone. Nothing in the suite would catch it either:
  the visual harness measures a board in one state, and the React tests run in jsdom.

  **So Phase 5's gate must resolve template-literal class composition, or maintain an explicit allow-list
  of dynamic prefixes with the composing `file:line` beside each — never a plain literal grep.** The
  allow-list is the cheaper of the two and the one that rots: it needs its own check that every prefix in
  it still has a composing call site, or it becomes a licence to keep dead classes.
- **`web/src/shared.ts` is a deliberate hand-mirror** of `src/core/` types, guarded by a test. It is not
  to be "deduplicated" by any phase here.
- **A phase that cannot show a clean gate does not ship.** Reverting one phase must not require unpicking
  another, which is why tokens are added before anything consumes them.
- **Stop condition:** if Phase 2 lands and the interface still reads as unconsidered, the problem was
  never the scale, and Phases 3–5 should be re-argued before being built.

## What this explicitly does not do

- No component library, styled or headless — for the reason in *What is NOT wrong*.
- No Tailwind or any utility framework: it would mean a second styling paradigm beside 457 existing
  classes.
- No new typeface and no webfont. The three font stacks in `themes.css` stay; the signature is a treatment
  of type already present, not a new face.
- No behaviour change, no dark/light logic change, no fourth theme.
