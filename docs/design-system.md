# The design system, and how it lands in phases

**Status: Phases 0–4 done (2026-08-21), Phase 5 planned.** Phase 0 built the instrument and
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
| `Button` **(built, Phase 3)** | the button cases among the 104 radius rules — `.ap-expand`, `.ap-settings-link`, `.ap-help-btn`, `.reports-forgive`, `.ap-remedy-btn`, and the rest | `primary` \| `default` \| `ghost` \| `danger` \| `bare`, sizes `sm` \| `md` |
| `Chip` **(built, Phase 3)** | tags, state words, counts, badges | tones `neutral` \| `accent` \| `ok` \| `warn` \| `bad`, optional `pill`, plus `data-state` for a surface vocabulary outside the five |
| `Dot` **(built, Phase 3)** | `.ap-dot`, `.conn`, `.ap-agent-dot` — three hand-rolled indicators already | tones as `Chip`, sizes `7` \| `8` \| `12`px |
| `Panel` **(built, Phase 4)** | board columns, drawers, the halt card, the nine full-bleed list rows | `flat` \| `raised`, optional header slot, `as` of `div`\|`section`\|`button` |
| `Readout` | the signature above: every duration, cost, token count, run id | inline \| block |
| `Field` | `InlineField`, settings inputs, the gate form | label + control + hint + error |

**`Button`'s `ghost` variant carries a DASHED border**, ruled by the owner on 2026-08-20 reviewing the
samples. Not merely decorative: dashed reads as explanatory rather than actionable, which is what a help
affordance ("How it works") actually is, and it keeps the box the same size as a solid button — a
borderless ghost is 2px narrower and shifts the row it sits in. The radius conformance check in Phase 3
therefore asserts on `border-radius` and not on `border-style`.

**That sentence is the TEST for whether a control may be a ghost, and it was applied to eight sites and
failed by six of them.** The first cut of Phase 3 read "dashed reads as quiet" and put a dash on
everything unobtrusive — including **"✕ Emergency stop"**, the most actionable control on the board,
which then read as a footnote. The two arguments had been collapsed into one: *not `danger`* (a
permanently red control is one people stop reading, and the auto-pilot bar's whole job is to be read) is
a sound argument that says nothing whatever about *not solid*. Corrected on 2026-08-21, one verdict per
site:

| site | explains or acts? | variant |
|---|---|---|
| `AutopilotBar` `ap-help-btn` — "? How it works" | **explains** — opens prose | `ghost` (the owner's ruling) |
| `AutopilotBar` `ap-expand` — "▸ Details / ▾ Hide" | **explains** — reveals the bar's own numbers and changes nothing in the project | `ghost` |
| `AutopilotBar` `ap-kill` — "✕ Emergency stop" | **acts** — kills every agent and halts the project | `default`, keeping `.ap-kill`'s danger-on-hover |
| `AutopilotBar` `ap-settings-link` — "Settings" | **acts** — navigation is not explanation | `default` |
| `CardReports` `report-stop` — "Stop" | **acts** — cancels a live run | `default`, keeping the danger hover |
| `ExecutionView` `report-stop` — "Stop" | **acts** | `default` |
| `ExecutionView` `report-dismiss` — "Dismiss" | **acts** — writes `resolved` | `default` |
| `ForgiveAttempts` `reports-forgive` — "Clear failed tries" | **acts** — writes, and changes what auto-pilot will dispatch | `default` |

**The disclosure toggle was the one genuinely open call, and it went to `ghost`.** It reveals detail
about the thing you are already looking at and touches nothing outside the bar's own presentation —
the same category as the help button, which shows prose where this shows figures. A dashed pair at the
right-hand end of the bar and solid everywhere that acts on the run is a distinction a person can read
without being told it exists.

**`ghost` therefore has two consumers, and it is kept deliberately at two.** "Explanatory affordance" is
a real category and a two-site variant that names one is worth more than a five-site variant that names
nothing — which is what it had become. `test/button-voices.test.tsx` asserts the census by **test id**
rather than by line number, so a new ghost is a named row in a diff.

**`bare` is the fifth variant, and it was added by measurement.** Working down the 46 hand-rolled
classes, **twelve were one shape under twelve names** — `background: transparent; border: none; color:
var(--muted); cursor: pointer`, differing only in a `font-size` nobody chose (11px to 18px across them)
and a hover colour that genuinely is the surface's. Asking "which of the four voices would have to lie"
of each gets the same answer twelve times — *all four, because every one of them draws a box and these
have none.* Twelve identical answers is not twelve survivors; it is a missing voice, and the precedent is
`--t-display` in Phase 2, where the scale turned out not to be short. Here it was. `bare` keeps the
base's transparent 1px border so it cannot shift the row it is dropped into — the same argument the dash
rests on — and its hover ink is overridable, because a `✕` that deletes goes red.

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
2. **Radius conformance** — every computed `border-radius` is one of the four, or `50%`. Blocking since
   Phase 3, with a sibling static check (`npm run check:radius-scale`) over the file for the same reason
   type has one.

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
  took it from 15 distinct computed sizes to 5. **Radius is BLOCKING as of Phase 3**, which took it from 6
  computed values to 4 — and asserts on `border-radius`, never on `border-style`, because the ghost Button's
  dash is a ruling and not a defect.
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

### Phase 3 — Button, Dot, Chip — **DONE 2026-08-21**

The three highest-frequency shapes, in `web/src/ui/` with `web/src/ui/primitives.css` — **24 class
selectors** for the three components and their variants, loaded **before** `styles.css` so a surface can
still override a primitive's *colour* at equal specificity (the emergency stop is a ghost button with a
danger hover) while the geometry gate stops that override becoming a padding.

**`Button`** — `primary` | `default` | `ghost` | `danger`, sizes `sm` (4/8px, `--t-small`) and `md`
(8/16px, `--t-body`). **`Dot`** — the five tones at 7 / 8 / 12px, plus a `pulse`. **`Chip`** — the five
tones, optional `pill`.

**The `ghost` variant carries a DASHED border**, the owner's ruling of 2026-08-20. The radius conformance
check therefore asserts on `border-radius` and **not** on `border-style`, and says so in its own failure
message so nobody "fixes" the dash to satisfy it.

#### The dynamic-class problem is solved rather than dodged

**36 classes were never named literally in `web/src`; 7 are.** Measured by the method beside the class
counts at the top of this page, before and after. The 29 that went are the ones `Dot` and `Chip` replaced,
and every one of them now has its state as a **`data-state` attribute** rather than a class composed at run
time: the six `conn-*`, the seven `chip-*` statuses, the four `ap-agent-*` and three `ap-agent-dot-*`, the
three `ap-*` chip tones, the three `ap-dot-*`, the two `bk-*`, and `ap-transport-stop`. A `data-` value is
visible to the same literal grep that reads the stylesheet's own selector, so Phase 5's gate has 29 fewer
classes to get wrong.

**The seven that remain are named, not overlooked:** `ap-bar-running` / `-halted` / `-complete` /
`-stopped`, which tint the bar's own left border and are neither a Dot nor a Chip; and `msg-user` /
`-assistant` / `-error`, which are chat bubbles and belong to `Panel`. Phase 5's gate still needs the
allow-list the *Risks* section demands — for seven classes instead of thirty-six.

**A tone is not a state, and forcing the one into the other would have repainted a theme.** Three of the
migrated vocabularies do not fit the five tones: `attention`, `running` (the top-bar chip) and
`connecting`/`failing` are all `--accent-2`, every theme's secondary — which equals `--warn` in cyberpunk
and classic-dark but **not** in marshmallow (`#8a6420` against `#9a5b12`). `themes.css` argues that
distinction by name at `.conn-failing`. So `tone` is the closed five the primitive owns, `data-state` is
the surface's own vocabulary, and the primitive colours neither by guessing.

#### What the off-scale radii turned out to be, measured

The board computed **6** values; it computes **4**. The two that had to go were found by running the
harness rather than by reading the file:

| was | on | became | why |
|---|---|---|---|
| `8px` × 56 corners | **14 `.tile` elements** — every card on the board, and nothing else | `--r-md` 6px | A tile sits inside a `.column` at 10px, and a nested box wants the smaller corner. It also puts every card on the same radius as every button and panel, which is the point of the phase |
| `3px` × 4 corners | **one `.ctx-bar`** — the copilot's context meter | `--r-pill` | A 5px-tall progress bar is a capsule; at that height `999px` renders as a 2.5px radius, which is what the `3px` was reaching for |

**The arithmetic accounts for every corner, which is how the change is known to be only the change:**
`6px` 108 → 164 (+56, the fourteen tiles), `999px` 68 → 72 (+4, the meter), `10px` 56 and `50%` 12
unchanged, `8px` and `3px` gone. **The drift list read `GONE 8px, GONE 3px` on all three themes and
nothing NEW** — read before `npm run visual:record` was run, because a re-record done first is how a real
regression gets blessed into the baseline. **Type drift was empty**: 5 computed sizes, same tally, despite
every button on the bar changing geometry. Element count 232 → 231, which is `.ap-agent-chip`'s inner span
going away when the Popover trigger took the test id.

The other six authored values went with them: `12px` (`.gate-card`, `.modal`) → `--r-lg`, `10px`
(`.mp-modal`) → `--r-lg`, the `8px` floating surfaces (`.popover`, `.chat-menu`) → `--r-lg`, `4px` →
`--r-sm`, `2px` → `--r-pill` on `.drop-line` and `--r-sm` on the chat bubbles' tail corner. **`--radius`
survives** with its four consumers, exactly as Phase 1 ruled: it is `--r-lg`'s value, and `Panel` owns
removing it.

#### Gates

**Radius conformance is BLOCKING** as of this commit, on all three themes. Proven by a planted defect:
`7px` on `.tile` was named as `7px on 12 element(s)` with the DOM path of each, and the run exited **1**;
restored, it exited **0**. It carries the same two anti-vacuity guards the type check does — four
*distinct* resolved steps off a probe, and the same examined population as the tally beside it.

**`tools/check-radius-scale.mjs`, wired into `npm run check`, makes two claims about the FILES.** The
first — every authored `border-radius` is one of the four steps or `50%` — is **blocking and at zero**, 96
declarations. Its whole justification is the pair Phase 2 established for type, reproduced here: `9px`
planted on `.skill-scope`, a Skill-editor rule the board never renders, made `npm run check` exit **1**
naming `web/src/styles.css:1394` while `npm run visual` exited **0** on the same tree. It also asserts a
floor of 60 declarations, because a pattern that stops matching reports zero findings and looks exactly
like success — planted too: a broken `border-radius` regex exits **1** with "this check is vacuous".

**The second claim is a RATCHET, and that is a deliberate departure from "blocking at zero".** It is
*"no rule outside the primitive stylesheet declares `border-radius`, `padding` or `font-size` for a class
rendered on a `<button>` or passed to a `<Button className>`"* — and the honest count is **56 before this
phase, 46 when the primitives landed, and 22 once the adoption was finished**. A blocking gate pointed at
the remainder would have to be bypassed on every commit, so it prints the full list on a passing run and
blocks any increase. Proven live: a `padding` planted on `.diary-refresh` took it to 47 and exited **1**;
after the migration, a `padding` planted on `.cs-action` took it to 23 and exited **1**, naming the class
and its call site. **Never raise the ceiling.**

#### The adoption was finished, not sampled — 46 → 22

**46 was not a stopping point, it was half a job.** `.btn-primary` (14 call sites), `.btn-secondary` (20)
and `.btn-danger` (3) are `primary`, `default` and `danger` under their old names — `padding: var(--s-4)
1rem` is `md` **exactly** — and there was no judgement in them at all. The stated reason for stopping was
that `.tab-btn`, `.dock-tab`, `.mp-trigger` and `.control-item` would make the variants lie, which is true
of those four and of nothing else on the list.

**24 classes went, across 66 call sites:**

| class | → | call sites |
|---|---|---|
| `.btn-primary` | `primary` `md` | 14 |
| `.btn-secondary` | `default` `md` | 20 |
| `.btn-danger` | `danger` `md` — `md` and not `sm`, because all three sit in the same rows | 3 |
| `.option-btn` | `default` `sm` | 3 |
| `.switch-btn` | `default` `sm` | 3 |
| `.control-new` | `bare` `sm` | 5 |
| `.dispatch-back` | `default` `sm` | 2 |
| `.archive-restore` `.confirm-cancel` `.chat-new` `.copilot-reset` `.cs-action` | `default` `sm` | 1 each |
| `.cards-raw` | `primary` when pressed, `default` when not — which is what `.cards-raw.active`'s accent fill already was, written twice | 1 |
| `.modal-close` `.mp-modal-close` `.cards-tab-x` `.res-del` `.chat-del` `.tile-archive` `.column-add` `.mp-star` `.dock-collapse` `.tag-filter-clear` `.cv-link-edit` | `bare` `sm` | 1 each |

**Two more went that the ratchet could not see, and finding them is the argument for reading the source
as well as the census.** `.confirm-go`'s class arrives through a ternary and `.copilot-authority`'s button
chose between `btn-primary` and `btn-secondary` the same way, so neither was ever a literal in a
`className` attribute. Migrating `.confirm-cancel` alone would have left the confirm dialog's two buttons
at two different sizes.

**The 22 survivors, each with the reason it is not a `Button`** — and none of the reasons is "it has its
own padding", which is the thing being removed:

| survivor | which variant would have to lie, and how |
|---|---|
| `.tab-btn` `.dock-tab` `.cards-tab-label` | **A tab.** Its selected state is a border on three sides continuous with the panel below it; every variant closes the box. |
| `.bt-btn` `.mode-btn` | **A cell in a segmented control.** The GROUP owns one border and one radius and each cell has none — every variant gives the cell its own, which puts a seam down the middle. |
| `.mp-trigger` `.chat-current` | **A select trigger.** Full width, a caret pinned right, an ellipsised label; it is an `<input>` that happens to be a button, and `default` sizes it as a control. |
| `.report-open` `.exec-card` `.control-item` `.explorer-item` `.mp-pick` `.suggestions-pick` `.chat-menu-open` `.archive-title` `.cv-link` `.cv-link-btn` | **A list row.** Full-bleed, left-aligned, `font: inherit`, a transparent border that only appears on hover. `default`'s panel-2 fill would draw a box round every row of every list. |
| `.tag` `.tag-chip` `.mp-chip` | **A Chip that happens to be clickable.** `Chip` owns that box, not `Button`; making it a button gives it a button's radius and padding. |
| `.board-label` | **A section header.** `border-left: 3px solid var(--accent)`, uppercase display face, full width — a heading you can collapse, not a control. |
| `.board-archive` | **A pill.** Every variant is `--r-md`; there is no pill radius among the five. |

**They are five kinds, not twenty-two problems**, which is why they are Phase 4 and Phase 5's work rather
than this phase's: tabs and segmented cells want a `Tabs`/`SegmentedControl`, the ten list rows want
`Panel`, and the three chips want `Chip`.

**The check's `<Button className>` blind spot had to be closed in the same commit, and it was found by
planting.** Its header listed *"a `<Button>` whose `className` smuggles a padding in — the class is not on
a literal `<button>`, so this check never sees it"* as a known gap. Moving 27 classes onto `<Button>` drove
a bus through it: a `padding` planted on `.cs-action` **exited 0**, and the ratchet would have gone on
falling while the geometry it counted quietly moved somewhere it could not look. It now reads both tags,
which took the population from 23 back to 49 and left the finding count at 22.

**The anti-vacuity floor on that population had to go, and its replacement is a self-test.** The floor was
30 against a population of 50; the migration took the population to 23, so a floor doing its job failed the
run *for succeeding*. The flaw is structural — claim 2's population shrinks to zero as the backlog clears,
which is the goal — so it is now a `parserSelfTest` over a fixed fixture, which works identically at a
population of 50 and at 0. **Its own first version was vacuous and a planted defect said so:** it carried
its own `/<button\b/` rather than calling the census's code, so `TAGS = ['<buttonXX', …]` made the check
find 0 classes, report 0 findings and exit **0** — sailing straight past the test meant to refuse exactly
that. Rewritten to go through `openTagsOf` and `classesIn`, it exits **1** on all three of: a broken tag
name, `<Button>` dropped from `TAGS` (which still reported a plausible 22), and `<ButtonRow>` swept in.

**The check still states what it does not catch**: a class reaching a button through a variable or a
ternary (`.confirm-go` is one), geometry applied by an element selector (`.copilot-actions button` really
is one), and anything about an `<a>` or a `role="button"`.

**Check 8 — every primitive shows a focus ring when tabbed to**, on all three themes: **29 of 29** enabled
`.vb-btn` reached by pressing Tab through the real order (1 disabled, skipped — 30 on the board against
**5** before the adoption was finished), 0 without a ring, in each theme's own accent
(`rgb(20,184,166)` / `rgb(47,122,80)` / `rgb(91,157,255)`). It exists *beside* check 6 because check 6 is a
ratchet on a count, so a primitive that fell out of the tab order would take its own row out of the
population and leave the ratchet satisfied. Its first version was itself a fixture too thin to distinguish
two outcomes — it keyed a map on the class list, and the bar's three ghost buttons carry byte-identical
class lists, so three elements collapsed into one entry and it reported "3 of 5" on a board where all five
were fine. It marks the element instead. Check 6's own count is unchanged at 55 examined, 0 findings.

#### The characterisation suite, and the three things it found

`test/state-tones.test.tsx` was written and **run green against the code as it was**, before any migration,
because these are the markers a person only sees once something has already gone wrong. It resolves each
state to **the colour the stylesheet gives it**, read out of the source with `el.matches()` doing the
selector work — jsdom loads no CSS — over the element, its ancestors and its descendants, since a tone is
set on a wrapper to tint a dot and a word together. Three real findings, none of them the rewrite:

- **`.ap-dot-idle` and `.ap-dot-stopped` do not exist.** Both states fell through to the base grey, which
  is right — neither is a fault and neither is progress — but it was true by *omission*, so nothing said so
  and nothing could check it. Now a named row in a table, and the test asserts the pair is one colour on
  purpose.
- **`.chip-failed`, `.chip-interrupted` and `.chip-cancelled` are three names for one colour**, deliberately:
  "what they have in common is no report". A first version of the test compared class strings and called
  that a difference.
- **`test/autopilot-bar.test.tsx`'s `expect(badge.className).not.toContain('ap-agent-ok')` was VACUOUS** in
  every case that has a balloon: `data-testid="ap-agent-state"` sat on an inner span that never carried a
  tone class at all, so the assertion was true of an element that could not have contained it. The tone and
  the test id now sit on the same element, and the repaired assertion is proven live — planting
  `data-state="ok"` makes it exit 1.

**Selector migrations: 11.** Seven in `test/topbar.test.tsx` — three connection-light assertions (including
the one that reads `styles.css` for `.conn-failing`'s tokens, now `[data-state='failing']`), three
auto-pilot-chip tone assertions, and the chip's own lookup from `.ap-chip` to `[data-testid="ap-chip"]`.
One in `test/autopilot-bar.test.tsx` — the vacuous `ap-agent-ok` assertion, now `data-state`. Four on
`.reports-forgive`, in `test/work-area.test.tsx` and `test/forgive-attempts.test.tsx`: the `ghost` variant
took every one of that class's declarations, so the class was removed rather than left as a name that
looks live and decides nothing — which is exactly what Phase 5's gate would then have to explain. The
`default` variant took them when the ghost ruling was corrected; the class stayed deleted either way.
**126 `querySelector('.class')` calls in `test/` remain the standing blast radius** — see the measured
count and its command at the end of this phase.

#### What the adoption cost the class count, which is less than the premise assumed

**66 call sites migrated and only 8 classes died.** `styles.css` goes **423 → 416**, `primitives.css`
**24 → 25** (`vb-btn-bare`), so the total is **447 → 441** — six. The expectation was one deletion per
migrated class; the reality is that **19 of the 27 still carry a real declaration** once the geometry is
taken out, and it is a declaration only the surface can make: `.column-add { margin-left: auto }`,
`.tile-archive:hover { color: var(--danger) }`, `.cs-action { text-align: left }`. The eight that died
outright had nothing left at all: `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.archive-restore`,
`.confirm-cancel`, `.dispatch-back`, `.modal-close` and `.option-fixed`.

**So Phase 5's under-150 is not much closer, and the honest reading is that the ratchet and the class count
measure different things.** 46 → 22 is the real result here: the geometry is in one place. The class count
needs the *merge* the plan already says it needs — and this phase hands it a measured, concrete target,
because **six of the survivors are now the single declaration `margin-left: auto`**: `.column-add`,
`.mp-modal-close`, `.copilot-reset`, `.dock-collapse`, `.copilot-x` and `.tile-archive`. Six names for one
thing is exactly the "same thing under a second name" the sweep exists to find. It is left rather than
merged because collapsing them means one shared utility class, and "no utility framework" is an explicit
non-goal of this document — so it is Phase 5's call to make, not this phase's to sneak in.

**`.option-fixed`'s dashed border was deleted rather than carried, and that is a fix.** `ReportOptions`'s
own comment says *"the agent's suggestions and the fixed ones look the same on purpose — they all lead to
the same editable prompt"*, and the dash was the one thing making them look different. It is also now the
ghost's mark, and a button that starts an agent run does not explain anything.

**Exit:** 4 computed radius values, 86 authored declarations all on the scale, both radius gates blocking,
**geometry ratchet 46 → 22**. **Classes never named literally: 36 → 7.** **Class selectors: 457 → 416 in
`styles.css`, plus 25 in `primitives.css` — 441 against 457.** Computed font sizes on the board **5 → 4**:
`.column-add` was the only 18px the board rendered, on 14 column heads, and `bare`/`sm` puts it at 12px.
**Suite: 237 files, 4,110 tests** (`test/button-voices.test.tsx` adds 5).
**`querySelector('.class')` calls in `test/`: 129 → 126** — the three that this change touched
(`.option-btn` twice, `.cs-action` once) are now `[data-testid]`; measured with
`grep -rhoE "querySelector(All)?(<[^>]*>)?\(\s*'\.[^']*'" test/ | wc -l`, which reads **135** on the commit
before Phase 3 and is quoted here rather than the **132** this page carried, because 132 was recorded
without its method and does not reproduce.
**Revert:** `web/src/ui/{Button,Dot,Chip}.tsx` and `primitives.css`, the **37** components that call them,
`styles.css`, three baseline files, `tools/check-radius-scale.mjs` with its two `package.json` scripts, and
radius conformance returns to reporting.

### Phase 4 — Panel — **DONE 2026-08-21**

Board columns, drawers, settings sections, dock panes. Higher risk than Phase 3 because these carry
layout, and layout is where the container queries and the shared column grid live — and the risk was
real: this phase found a pre-existing layout fault the harness could not see, then made a second one
of its own and found that only by screenshot.

**`Panel` has two variants and the distinction is whether the box is DRAWN.** `raised` draws a
`--panel` ground, `1px solid var(--border)` and a `--r-lg` corner — a surface that sits above the wash
and says where it ends. `flat` draws nothing: no ground, a **1px transparent** border, a `--r-md`
corner, `var(--s-3) var(--s-4)` of padding and `font: inherit`. The transparent border is the same
argument the dashed ghost and the bare glyph rest on — a box that gains a border on hover must already
occupy those 2px, or every row shifts under the pointer. An optional `header` slot is
`.vb-panel-head`, and `as` is a closed set of `div | section | button`.

**`raised` is a flex column and `flat` is not**, which is not an oversight: every raised consumer
stacks a head over a scrolling body, and a row's direction is genuinely its own — three of the eight
stack two lines and four lay their parts out sideways.

**Two things this phase's own brief listed and did NOT take, each with the reason.** *Settings
sections* turned out not to be panels at all: `.settings-section` is a heading — an uppercase accent
label with a `border-bottom` — sitting in `.modal-body`, and there is no box round the group. There was
nothing to migrate. *Dock panes* are the harder call and the answer is that they are **neither
variant**: `.dock`, `.copilot` and `.raw-pane` are regions of the shell whose separation is one divider
edge and a ground — `border-top` or `border-left`, no corner and no box. `raised` would draw a border
round the whole dock and give it a 10px corner it must not have; `flat` would give it corners and take
its ground away. Forcing either would repaint the shell, which is the one thing *What is NOT wrong*
puts out of scope. A third variant for "a region with one edge" is a real candidate and it belongs to
whoever needs a second consumer for it; today it would have one.

**The chat bubbles are left too, and the reason is the composition.** `msg-user` / `-assistant` /
`-error` are three of the seven classes never named literally, and a bubble is arguably a Panel — but
its corners are `--r-lg --r-lg --r-sm --r-lg`, three radii and a tail. Panel has one corner per box, so
`raised` would have to lie about the tail, and taking the bubbles would mean moving the run-time class
composition at `CopilotPanel.tsx:236` in the same change. Left whole, so the *Risks* allow-list is
still seven rows.

#### The board's columns: what the right behaviour is, and why

**The columns flex so every row fits, and the board scrolls as ONE region only when a fit would make a
card illegible.** Both of the two defensible answers are right, in that order. What was wrong was not
the choice between them; it was the floor and the number of scroll regions.

The reported fault — FEATURES ending at ~x=850 with four columns while PRODUCT and ENGINEERING render
five, the fifth cut mid-phrase at ~x=1020 — is **two faults, and the visible half is not the one that
matters.** Measured at 1440×900 with the copilot open:

| what | measured |
|---|---|
| board area (`.boards`) | 1005px |
| `grid-template-columns`, all three rows | `200px 200px 200px 200px 200px` — already identical |
| each row's `scrollWidth` / `clientWidth` | **1045 / 1005** — every row overflowed its own box by 40px |
| at 900px | 1045 / 465 — **580px clipped per row** |

So the rows already shared one set of tracks. **The rows ending at different x is the shared grid
working as designed** and is stated in the CSS: "a board with fewer columns than the widest simply
leaves its last tracks empty, which is honest — the Features board really does have one fewer column."
Four columns of five tracks end at four fifths of the row. That part is not a defect.

The two real faults:

1. **`overflow-x: auto` was on `.board-columns`, so there were THREE independent horizontal scrollers,
   one per board row.** Three rows that read as one table cannot each have their own scroll offset: the
   shared grid is only true while all three sit at zero. Scroll one row and its columns are no longer
   under the row above. This is the fault, and it is worse than the clipping it caused.
2. **The 200px clamp floor was 21px above what a column needs**, so five tracks plus four gaps wanted
   1044.8px in a 1005px box — the board scrolled at 1440px for an 8px-per-track shortfall.

**Fixed in two lines.** `overflow-x` and `padding-bottom` come off `.board-columns` — the padding was
clearance for a scrollbar that row no longer has — and the overflow reaches `.boards`, which was
already the vertical scroller. One region, one gesture, on the box the reader is already scrolling. And
the floor becomes **180px**: a `.column`'s own min-content width is **179px**, driven by its head at
**177px**, against a `.tile`'s **93px** — so the head sets the floor, not the cards.

At 180px, measured: **1440px fits with nothing cut**; 1200px (765px of board) and 900px (465px) scroll
as one region, against the 944.8px five legible columns need. `--board-gap` was also named as a token,
because `--track-fit` subtracted a literal `0.7rem` that the `gap` beside it repeated — change one and
the track arithmetic would have gone on measuring a gap that no longer existed.

**Screenshotted at all three widths and read by eye, not only asserted.** At 1440 all five columns are
whole and the heads sit inside their borders; the FEATURES row ends early at x=819 where the other two
reach x=1022, and every column edge lines up down the page (18 / 222 / 425 / 628 / 831). At 1200 and
900 the last visible column is cut by the board area's edge — at the *same* x in all three rows, which
is the point — with the columns aligned at 20 / 210 / 401 / 592 / 783.

#### The overflow check had a hole, and it was the instrument's fault

**It is a hole, not a legitimate scroll container reporting correctly.** The check asks *"is any TEXT
wider than its own box?"*, and it examines only elements with a text node of their own — deliberately,
because an element whose text lives in a child did not size that text. Neither half can see this fault:
a scroll container has no text of its own, so it was never examined, and the text inside it was not
overflowing anything — its own box was the size it asked for. The **ancestor** cut it off. The
document-level claim only ever looked at `documentElement`.

`pageClipping` in `visual/support/audit.ts` closes it: every visible element whose `overflow-x` is not
`visible` must have `scrollWidth <= clientWidth + 1`. `text-overflow: ellipsis` is skipped for the
reason it is skipped above — it is a deliberate statement that this text may be cut, and `.ap-status`
is one, at 211px of content in a 126px box on purpose.

**Proven on the same tree, in one run.** With a wide child planted inside `.column-body` — a box whose
own text fits, clipped by the scroller above it — the old walk reported **0 findings across 120 text
elements** while the new one reported **14 across 35 examined** and the run exited 1. That is the hole
and its repair in one pair of numbers.

**The board area is exempt by name and nothing else is**, matched on the last segment of the element
path rather than by substring, so a descendant cannot be excused by its ancestor's name. It has to
scroll below about 1345px. Re-planted after the exemption to prove it had not gone vacuous: the same
`.column-body` defect still exits 1 with 15 findings.

#### A third kind of overflow, which this phase created and nothing could see

**The floor was 144px for one iteration, and that was a measurement error worth recording** — the
instrument that produced it was the very blind spot this phase exists to close. 144px was chosen by
sweeping the floor and counting text elements wider than their own box, which reports **0 findings at
every floor from 144px to 200px**. It cannot distinguish them at all.

What it missed: below 180px **the column head overflows its own box**, and the `+` button renders
outside the column's border, in the gutter between columns, at 1200px and 900px. A flex row with no
text of its own and `overflow: visible` neither clips nor scrolls — its children simply render
outside it — so no walk in the harness examined it. It was found by looking at the screenshots.

Check 9 now measures it: for every column head, no child may render outside the head's content box.
Swept again with that instrument, `.vb-panel-head` spills at 144 / 156 / 168 / 176 and stops at
**180**, which is exactly the min-content measurement. The floor cannot be lowered past it again.

#### Gates

**Check 9 — the three board rows are one shared grid.** At 900 / 1200 / 1440px: every row reports the
same `grid-template-columns`; column *i* sits at the same x with the same width in every row that has
one; no track is under the 180px floor; the only thing scrolling sideways is `main.boards`; and every
column head fits inside its column. **Examined counts asserted**, because a layout assertion that
matches nothing passes silently: **9 rows, 42 columns and 42 heads** — 3 rows × 3 widths, 4+5+5 columns
at each, one head per column.

**Check 10 — the dock is content-sized until a pane asks to be filled.** At rest the dock body is
**76px**, strictly under its 342px cap — asserted strictly, because `height: 38vh` for everything is
what content-sizing replaced and a regression to it would satisfy "≤ cap". With a raw pane open,
through the real controls rather than by injecting state, it is **342px exactly = 38vh of 900**.

**Every new assertion proven by planting, each restored:**

| planted | result |
|---|---|
| one row given its own `grid-template-columns` | exit **1**: *"the three board rows do not share one set of tracks at 900px"*, printing `["144px…", "180px…"]` |
| `overflow-x: auto` put back on `.board-columns` — the original fault | exit **1**: *"something other than main.boards scrolls sideways at 900px"*, naming `div.board-columns` three times |
| the clamp floor lowered to 144px | exit **1**: *"a column track is 144px at 900px, under the 180px floor"* |
| a head wider than its column (`.column-count { margin-right: 90px }`) | exit **1**: *"Backlog > .vb-btn — renders at 247..275 outside its head's 29..186"*, per column |
| a wide child clipped inside `.column-body` | exit **1**, 14 findings — and the old text walk reported **0 of 120** on the same tree |
| `height: 38vh` → `max-height` on the filled dock | exit **1**: *"the dock body is 318px with a raw pane open, and 38vh of 900px is 342px"* |
| a `padding` on `.exec-card`, reachable only through `<Panel as="button">` | `check:radius-scale` exit **1**, ratchet 14 against a ceiling of 13 |
| the `as="button"` predicate broken to match nothing | exit **1** from the parser self-test — population 49 → 40 with findings still 13, the exact vacuous green it exists to refuse |
| the predicate dropped so every `<Panel>` counts | exit **1**, findings 13 → 20 — the qualification is load-bearing in both directions |

Restored, `npm run visual` is **30 passed, exit 0** on all three themes.

**The dock's own shortfall is a RATCHET and not zero, because check 10 found it rather than caused
it.** The dock body is 342px and the raw pane inside it is **263px**, so 79px of a definite box goes
unused. The cause is the same one `styles.css` describes, one level further down: `.raw-pane`'s
`flex: 1` needs a **flex** parent and its parent is `.cards-body`, a scrolling block, so the pane sits
at its content height floored by `.raw-area`'s `min-height: 14rem` — 224px, large enough to hide the
collapse. Phase 4's gate is that the dock BODY's height is definite, and it is, exactly. Fixing the
chain below it is a change to the dock's internals this phase has no business making, so **79 is
recorded and any increase blocks.**

**The drift was read before it was re-recorded, and it was empty.** Type and radius, all three themes,
**counts included**: `13px×127 12px×84 11px×19 15px×1` and `6px×240 999px×72 10px×56 50%×12`, byte for
byte the Phase 3 baseline, at 231 elements. That is the intended result — this phase moves boxes and
layout and deliberately reproduces every value, and `--radius` → `--r-lg` is the same 10px, so the
`10px×56` of fourteen columns' corners does not move. The only baseline change is the two new
`clipping` keys: **35 examined, 1 finding** — `main.boards`, which is the exempt region.

#### A Phase 2 gate was reading its own comments as code

**`npm run check:type-scale` scanned the raw stylesheet with no comment handling**, so any comment
mentioning `font-size:` or `padding:` in prose was parsed as a declaration and the words after it as
its value. Phase 4 tripped it with a comment explaining why a `font-size` had been *removed*, and it
reported `.cv-links { display: flex` as a value off the scale.

Latent since Phase 2, and it had two effects worth separating. It over-reports, which is loud and
harmless. But the declaration COUNTS it printed included comment text, so **the anti-vacuity floor of
150 was being satisfied partly by prose** — the quiet half, and the one that matters. Fixed the way
`tools/check-radius-scale.mjs` has always done it: comments blanked to spaces, not removed, so every
offset still maps to its real line and a finding's `file:line` stays correct. **Authored `font-size`
declarations: 204 → 202**, the two being comment text; Phase 2's recorded 233 was measured with the
same fault and is not comparable.

Proven three ways, each restored: an off-scale `0.81rem` in a real declaration exits **1** naming
`primitives.css:129`; an off-scale `0.77rem` on the line *after* a comment that mentions
`font-size: var(--t-body)` in prose exits **1** naming line **132**, which is what says the blanking
did not blind it and that the offsets survived; and a broken `FONT_SIZE` regex exits **1** with *"only
0 font-size declaration(s) found, against a floor of 150 — this check is vacuous"*.

#### The ratchet: 22 → 13

**Nine of the ten list rows Phase 3 named are `Panel flat`, and they were one shape under nine names:**
`.report-open`, `.exec-card`, `.control-item`, `.explorer-item`, `.cv-link`, `.cv-link-btn`,
`.mp-pick`, `.chat-menu-open`, `.suggestions-pick`. Their stated reason for not being `Button`s —
*"`default`'s panel-2 fill would draw a box round every row of every list"* — is true of all five
voices and is exactly what `flat` answers.

**`Panel` may be a `<button>`, and the line between the two primitives is the VOICE.** If it is one of
`primary`/`default`/`ghost`/`danger`/`bare`, it is a `Button`; if it is a region of the page that
happens to take a click, it is a `Panel`. A list row is the latter — it has no voice at all, which is
why all five had to lie about it.

**Four paddings nobody chose became one.** They were `0.1rem var(--s-2)`, `0.1rem var(--s-3)`,
`0.15rem var(--s-3)`, `var(--s-3) var(--s-4)` and `var(--s-4) var(--s-4)` — the same pathology as the
27 font sizes, one level up. The primitive takes **`var(--s-3) var(--s-4)`**, which is
`.control-item`'s existing value: the one of the eight a person had actually chosen.

**The one survivor of the ten, with its reason:** `.archive-title` — its container `.archive-item` is
already padded and it is `flex: 1` inside it, so `flat`'s padding would pad the row twice and push the
restore controls off it.

**The other twelve, four kinds, and none of the reasons is "it has its own padding":**

| survivor | which variant would have to lie, and how |
|---|---|
| `.board-archive` `.mp-chip` `.tag` `.tag-chip` | **A chip.** `Chip` owns that box; every Panel variant is a rectangle with a corner, and a pill is not. |
| `.board-label` | **A section header.** Panel's header slot is a bordered row *inside* a panel; this is a collapsible heading *above* one, with a 3px accent left edge. |
| `.bt-btn` `.mode-btn` | **A cell in a segmented control.** The GROUP owns one border and one radius. |
| `.cards-tab-label` `.dock-tab` `.tab-btn` | **A tab.** Its selected state is a border on three sides continuous with the panel below it; every variant closes the box. |
| `.chat-current` `.mp-trigger` | **A select trigger.** A control, not a region that takes a click. |

**The `<Panel as="button">` hole was closed in the same commit that opened it**, which is Phase 3's
`<Button>` lesson applied before it could cost anything. `tools/check-radius-scale.mjs` reads
`<Panel` **only when the tag says `as="button"`** — qualified rather than swept in, because an ordinary
`<Panel>` is a `<div>` or a `<section>` and may legitimately declare its own padding: `.archive-drawer`,
`.exec-column` and `.halt` all do, since `raised` deliberately has none. Counting every `<Panel>`
reports those three correct designs as faults (findings 13 → 20); counting none of them leaves
`.exec-card`'s padding free to come back unseen. Both directions are in the parser's fixture.

**`--radius` is deleted**, which Phase 1 ruled would happen in the phase where a surface primitive
owned its four consumers — `.archive-drawer`, `.column`, `.exec-column`, `.halt`. All four are now
`raised`, and `OFF_SCALE_ON_PURPOSE` loses its second entry. Authored `border-radius` declarations:
**86 → 80**.

#### The characterisation suite, written first, and what it found

`test/panel-boxes.test.tsx` — **25 tests, run green against the code as it was, before any migration.**
It asserts the box a class list draws, resolved out of the stylesheets with `el.matches()` doing the
selector work, and resolves the scale tokens to pixels so a rule moving from `var(--radius)` to
`var(--r-lg)` reads as the same 10px.

**The assertions survived the migration; the fixtures did not**, and saying otherwise would be the
dishonest version of this note. A row is now built by rendering `Panel` rather than by writing
`<button class="report-open">`, because the element genuinely carries two more classes. What that buys
is that the class list is never hand-written: rename `vb-panel-flat` and the fixture moves with it
instead of quietly testing a dead class.

Three findings:

- **`.cv-link`'s `font-size: var(--t-body)` was DEAD on every clickable card link.** `.cv-link-btn`'s
  `font: inherit` is written later at the same specificity, so it reset the size — the `<button>` and
  the plain `<div>` beside it matched only by accident of what they inherited. That is the shape of the
  10.88px incident exactly. The size now lives on `.cv-links`, once, where the list is.
- **The suite's own cascade helper was wrong in both directions, and only one of them was red.** Its
  first version stripped the pseudo-class out and matched what was left, so every `:hover` rule applied
  at rest: `.control-item`'s hover ground read as its resting ground and failed, while the same bug
  made the identical claim pass on `.report-open` for the wrong reason. It now requires a rule's states
  to be a subset of the one asked for, handles `:not(:disabled)`, and is asserted by its own two cases.
- **Three of the eight rows had `border: none`** — `.mp-pick`, `.chat-menu-open`, `.suggestions-pick` —
  so they had no box to light at all and depended entirely on a parent's hover. They now carry the
  primitive's transparent border.

#### Selector migrations

**126 → 127, and it went UP.** Measured with the command recorded at the end of Phase 3. One selector
was migrated: `test/utility-dock.test.tsx`'s `.dock-body`, now `data-testid="dock-body"`, which check 10
needs as well. The other four are **this phase's own characterisation suite**, and reporting 125 by
leaving them out would be laundering the number — a suite that reads the stylesheet is exactly a test
that breaks when a class is renamed. Two of the four were incidental and went through test ids
(`.column`, and the chat pick); **two remain because they ARE the subject** — `.board-columns`, whose
tracks are the claim, and `.column-head, .vb-panel-head`, which asserts the header slot's class moved
to the primitive. A `data-testid` would answer neither question.

The eight migrated row classes and the four raised surfaces had **no** class-based selectors in the
suite, which is why 4,135 tests stayed green through the migration; `data-testid` was added at all nine
Panel call sites anyway, so Phase 5 does not have to invent them.

**Exit:** panels are one component. **Geometry ratchet 22 → 13.** **`--radius` deleted**; authored
radius declarations **86 → 80**.

**Class selectors: `styles.css` 416 → 414, `primitives.css` 25 → 29 — so 441 → 443 by Phase 3's method,
and it went UP by two.** Only `.column` and `.column-head` died outright; `Panel` added four
(`.vb-panel`, `-raised`, `-flat`, `-head` — `button.vb-panel` is a tag qualifier and not a fifth name).
Nine rows migrated and none of their classes died, for the reason Phase 3 measured: what is left after
the geometry comes out is a real declaration only the surface can make — `.report-open { flex: 1 }`,
`.cv-link-btn { width: fit-content }`, `.exec-card { overflow-wrap: anywhere }`.
**The distinct UNION across both files is 441**, because `vb-btn` and `vb-dot` are named in
`styles.css` too (`.halt .vb-btn`, the connection light's dot), so the two methods differ by exactly
those two names. Phase 5's under-150 target is measured against the union.

**Suite: 238 files, 4,135 tests** (`test/panel-boxes.test.tsx` adds 25). **Harness: 30 tests, three
themes, exit 0.**
**Revert:** `web/src/ui/Panel.tsx` and the Panel block of `primitives.css`, the **13** components that
call it, `styles.css`, `themes.css` (`--radius` returns), three baseline files, `check-radius-scale.mjs`
(TAGS and the ceiling), and checks 9 and 10 with `pageClipping`, `pageGrid` and `pageDock`.

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

- **Class renames break tests.** There are **127** `querySelector('.class')` calls in the React tests —
  135 before Phase 3 and 126 after it, measured by the command recorded at the end of that phase; the
  **132** this line carried until 2026-08-21 had no method beside it and does not reproduce. Phase 4
  took it UP by one, and deliberately: it migrated one and its own characterisation suite added four,
  two of which are the classes under test and cannot be a `data-testid`. They
  are the blast radius, and they must be migrated to `data-testid` as each phase touches them, not left
  to a final sweep. A test that selects on a class turns a visual fix into a red suite, which is how a
  suite stops being trusted.
- **Thirty-six classes were never named literally in `web/src/`, and none of them was dead. Phase 3 took
  that to SEVEN** — the four `ap-bar-*` and the three `msg-*` — by giving every state the `Dot` and `Chip`
  primitives replaced a `data-state` attribute instead of a composed class name. The argument below stands
  for those seven, and the allow-list it demands is seven rows rather than thirty-six. They are
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
