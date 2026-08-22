# The design system, and how it lands in phases

**Status: Part One (Phases 0–5) and Part Two's Phase 6 done (2026-08-21). The class count is 374 against a target of 183 — re-derived on
2026-08-21 from the measured surface count, with the plan's *under 150* withdrawn as unreachable at its
own allowance. What stands between 380 and 183 is measured under Phase 5b.** Phase 0 built the instrument and
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

**Deleting every one of the 278 one-offs leaves 179 — so the sweep cannot only delete; it has to merge.**
457 − 278 = **179**, and the gap to any credible budget is not a rounding error: dozens of surviving
classes have to be merged into something else, on top of every deletion.

#### ~~Under 150~~ is WITHDRAWN, and the target is **183**

**The under-150 figure was wrong, and it was wrong in exactly the way this page's own rule forbids.** It
was derived as *"six primitives with four or five variants each is roughly 30 classes, and ten genuinely
bespoke surfaces — the board grid, the dock, the two bars, the skill rail, the explorer, settings, chat,
card tabs, the diary — want perhaps 80 layout classes between them"*, giving 110 and a target of under 150.
**Both terms were estimated and neither was counted.** The surface count was written down from memory of
the interface; nobody enumerated `web/src`. *A target expressed against a number nobody can reproduce is
not a target* is this page's rule about the withdrawn **432**, and 150 breaks it the same way — 432 was a
total nobody could reproduce, and 150 was a total derived from a surface count nobody had taken.

**It was also unreachable at its own allowance, which is what makes it a wrong number rather than an
ambitious one.** The measured surface count is **17** and the plan's allowance is **8 layout classes per
surface**, so the surfaces alone want 136; the primitives, measured rather than estimated, are **47**.
136 + 47 = **183**, and 183 is already above 150. The plan therefore set a target its own arithmetic
excludes, and no amount of sweeping could have reached it without breaking the allowance it was derived
from.

**The re-derived target is 183, at the plan's own allowance and the measured counts:**

| term | plan's estimate | measured | how |
|---|---|---|---|
| bespoke surfaces | 10 | **17** | 16 feature directories under `web/src` besides `ui/` and `api/`, plus `markdown.tsx`, which is a bespoke surface with its own class family and no directory of its own |
| layout classes per surface | 8 | **8, kept** | The plan's allowance, unchanged — it is the one term with no better measurement, and re-deriving the budget is not licence to widen it |
| primitive classes | ~30 | **47** | `web/src/ui/primitives.css`, six primitives with their variants, counted |
| **budget** | **110 → under 150** | **183** | 17 × 8 + 47 |

Measured on 2026-08-21, and every figure here is a command:

```
# 17 surfaces — 16 feature directories, plus markdown.tsx
ls -d web/src/*/ | sed 's|web/src/||;s|/$||' | grep -vx 'ui\|api' | wc -l     # 16
find web/src -maxdepth 1 -name '*.tsx'                                        # markdown.tsx, main.tsx
# 47 primitive classes and 355 in styles.css, by the method beside the class counts above
node tools/check-class-budget.mjs
```

**`main.tsx` is not one of the 17 and `markdown.tsx` is**, which is the one judgement in the count rather
than a measurement: `main.tsx` mounts the app and renders no surface of its own, while `markdown.tsx` owns
the rendered-document surface — the one `--t-display`'s single consumer lives on. So it is 16 directories
plus one file, not 17 directories, and anyone re-running the first command above gets 16 and should.

**The 8-per-surface allowance is the term to distrust next, and it is recorded as a tension rather than
quietly widened.** No surface in the tree is near it: `styles.css`'s 355 classes sit under **75 distinct
prefixes**, and the largest families are `ap-*` **29**, `mp-*` **22**, `report-*` **19**, `control-*`
**17**, `copilot-*` **14**, `chat-*` **13**, `diary-*` **12**, `cv-*` **11**. The auto-pilot bar alone
holds three and a half times its allowance. Whether 8 is a floor a real surface can live at is the open
question behind the remaining gap, and it is the one thing in this budget still expressed against a number
nobody has measured — a surface built to the allowance. Until one exists, 8 is inherited from the plan and
marked as inherited.

**183 is a total, not a reduction**, exactly as 150 was meant to be: `styles.css` plus `primitives.css`,
distinct union, measured by `node tools/check-class-budget.mjs`, with the closing number written into this
page. A target expressed as "fewer than we have" is not a target.

**The corrected numbers make this argument stronger, not weaker.** On the withdrawn 432 / 154 figures the
remaining work after the deletions looked like a handful of stragglers, and a plan can talk itself into
believing a handful will fall out on its own. 179 cannot be read that way: a fifth of what survives the
sweep still has to be merged, deliberately, and that is a piece of work with its own decisions rather than a
consequence of the deletions.

That reframes what the phases are for. Every one-off removed is a class that was a re-implementation of a
shape; every *surviving* class then has to justify itself against the question "is this genuinely a different
thing, or the same thing under a second name?" — and on the evidence of 104 hand-made rounded boxes, most
answers will be the second.

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
| `Chip` **(built, Phase 3; `fill` Phase 5a, `as` Phase 8)** | tags, state words, counts, badges — **the whole family, Phase 8** | tones `neutral` \| `accent` \| `ok` \| `warn` \| `bad`, optional `pill`, optional `fill`, `as` of `span`\|`button`, plus `data-state` for a surface vocabulary outside the five |
| `Dot` **(built, Phase 3)** | `.ap-dot`, `.conn`, `.ap-agent-dot` — three hand-rolled indicators already | tones as `Chip`, sizes `7` \| `8` \| `12`px |
| `Panel` **(built, Phase 4)** | board columns, drawers, the halt card, the nine full-bleed list rows | `flat` \| `raised`, optional header slot, `as` of `div`\|`section`\|`button` |
| `Readout` **(built, Phase 5)** | the signature above: every duration, cost, token count, run id | inline (`Readout`, sizes `micro`\|`small`\|`body`\|`plain`, tones `muted`\|`accent`\|`accent2`\|`text`, `quiet`) \| block (`ReadoutLine`) |
| `Field` **(built, Phase 5)** | settings inputs, the gate form, the skill editor, the dispatch pane — **not** `InlineField`, whose commit-on-blur is behaviour and stays where it is | label + control + hint + error, `layout` of `stack`\|`rail`\|`check`, plus `.vb-trigger` for the two select triggers |
| `SegmentedControl` **(built, Phase 5b)** | `.mode-group` + `.backend-toggle` (byte-identical) and `.mode-btn` + `.bt-btn` (identical apart from one size step) | sizes `sm` \| `md`; the GROUP owns the one border and corner and clips its cells |

**Six was the plan's count and seven is the tree's, and the seventh was added by measurement rather
than by design.** `SegmentedControl` exists because four classes were already one shape and the
stylesheet said so itself: `.backend-toggle-md .bt-btn` restated `.mode-btn`'s padding and font-size
verbatim. Taken as multisets the four classes declared **36 things with 19 distinct values**; the three
primitive classes declare **19**, and the distinct sets are identical — 0 added, 0 removed, 0 changed.
That is a stronger argument than a consumer count: `Button` gained `bare` on twelve classes and `Chip`
gained `fill` on four, but neither had a rule in the file asserting the equality.

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
**Class selectors: 457, unchanged** — Phase 2 changes values, not classes, and Phase 5's class target
is untouched by it. (That target read *under 150* when this phase shipped; it is **183** since the
re-derivation of 2026-08-21.)
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

**So Phase 5's class target is not much closer, and the honest reading is that the ratchet and the class count
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
those two names. Phase 5's class target — under 150 when this phase shipped, **183** since the
re-derivation — is measured against the union.

**Suite: 238 files, 4,135 tests** (`test/panel-boxes.test.tsx` adds 25). **Harness: 30 tests, three
themes, exit 0.**
**Revert:** `web/src/ui/Panel.tsx` and the Panel block of `primitives.css`, the **13** components that
call it, `styles.css`, `themes.css` (`--radius` returns), three baseline files, `check-radius-scale.mjs`
(TAGS and the ceiling), and checks 9 and 10 with `pageClipping`, `pageGrid` and `pageDock`.

### Phase 5 — Readout, Field, and the sweep — **DONE 2026-08-21**

The signature landed, the last two primitives arrived, and the sweep ran in two passes: **443 → 392** (5a)
and **392 → 380** (5b). The target is **183** and it is not reached. That gap is the headline of this
section and it is stated first, because a phase that reports its intention rather than its measurement is
the thing this document exists to stop. What the number costs and what would close it is *What stands
between 380 and 183* below.

#### `Readout` — the signature, and where it landed

**`.vb-readout` is the treatment: `var(--font-mono)`, `font-variant-numeric: tabular-nums`,
`letter-spacing: -0.01em` — plus `--t-micro` and `--muted`, which is the part that was measured rather than
designed.** Eleven classes said exactly `font-family: var(--font-mono); font-size: var(--t-micro); color:
var(--muted)` under eleven names: `.archive-when`, `.mp-count`, `.mp-id`, `.mp-ctx`, `.copilot-model`,
`.chat-menu-meta`, `.explorer-size`, `.report-cost`, `.report-when`, `.exec-cost` and `.exec-when`. Eleven
identical answers is one thing under eleven names, so that combination is the DEFAULT and every variant
below it is a distinction a person can see: `small` and `body` for the two other steps in use, `plain` for a
figure inside a line that has already decided its size and colour, `accent` for an id, `accent2` for a
price, `text` for a total among muted neighbours, and `quiet` (`opacity: 0.85`) which three classes had
written by hand.

**`ReadoutLine` is the `block` half, and it is a merge of five surfaces.** The two ledgers, a card's meta
row, a diary entry's and a filed finding's each wrote their own wrapping row and agreed on everything except
a gap nobody chose — 8/8px, 3.2/14.4px and 8/8px. The primitive is `var(--s-2) var(--s-5)` on a baseline,
and what the five surfaces keep is only where the row sits: `.execution > .vb-readout-block` spans the grid,
`.reports > .vb-readout-block` sits under the report list.

**Where the figures are now**: card and run ids, archived-at times, model ids and prices and context sizes,
file sizes, chat meta, a run's cost and elapsed time, the project and card ledgers, the attempt tally, the
copilot footer's cost/turns/duration/context, sign-in addresses and dates, project and file paths, and a
card's created date. **25 readouts render on the board view alone**, counted by check 11.

**A sentence a person wrote is NOT a readout, even when it contains a figure**, and applying that rule
changed two sites for the better. `.dispatch-continues` — *"Continues run 20260726-141000-9f3e. Its report
goes to the agent with this one."* — was entirely monospaced, which said the prose was machine-written; now
the run id is a `Readout` inside proportional prose. `.reports-forgiven` was left alone for the same reason.

**`--t-display` was NOT used, and that is the judgement rather than an omission.** The step is *"the one big
number per surface"*, and the search for one came up empty: the Execution dashboard's ledger is the only
candidate and it is a SENTENCE — `usageTotal` renders *"3 runs · $1.20 usage · 5m"* — which at 24px reads as
shouting rather than as a figure. The copilot's context meter renders a bar and a `48.2k`, not a headline;
the auto-pilot bar's dominant element is a status line. So `--t-display` keeps its one consumer, the
markdown h1, and the honest reading is that this product does not have a surface with a single dominating
number. Inventing one to give the step a second consumer is the tail wagging the dog.

#### `Field` — and the two boxes that answered nothing

**`.vb-field`, `.vb-field-row`, `.vb-label`, `.vb-label-caps`, `.vb-label-rail`, `.vb-input`, `.vb-hint`,
`.vb-error`, `.vb-error-box`** — nine classes against the twenty-nine they replace, and the control gets its
box from a DESCENDANT selector (`.vb-field input, .vb-field textarea, .vb-field select`) so a caller cannot
forget it. `Field` takes `label`, `hint`, `error` and a `layout` of `stack | rail | check`; `check` puts the
control first because a checkbox holds a decision rather than a value, which is the distinction
`.field-check` already drew by hand.

**The characterisation suite is `test/field-boxes.test.tsx`, 47 tests, written and run green against the code
as it was — and it found a real defect.** Ten text boxes were written ten times. They agreed on the ground
(`--bg`, nine of ten), the border, the `--r-md` corner and `--t-body`; they disagreed on the padding — five
values, `var(--s-4) var(--s-4)`, `var(--s-3) var(--s-4)`, `var(--s-2) var(--s-4)`, `var(--s-4)` and `0.8rem`,
the same pathology as Phase 4's eight list rows one level up — and **two of them declared no `:focus` rule at
all**. `.skill-input` and `.dispatch-prompt` kept the UA outline where the other eight turn their border
accent, which nothing said and nothing could check. The primitive answers for all ten, and the suite asserts
it over the whole list rather than a subset, because a list with an exception in it is what let two slip.

**The suite's own first premise was wrong twice, and the code was right both times** — it guessed
`.resource-row input` was a third silent box (it answers) and asserted one border for `.control-rename`
(accent at rest, because it only exists while it is being typed into). Each became a named row instead of a
widened expectation. That is the third phase running in which the resolution was "the test moved".

**Commit-on-blur was proven live before anything touched it.** `test/inline-field.test.tsx`'s 17 tests are
the behaviour `Field` deliberately does NOT own; planting `onBlur: () => setDraft(null)` in
`ui/InlineField.tsx` turned **four** of them red (exit 1) and restoring it returned exit 0. `.inline-view`
and `.inline-edit` are untouched by this phase for that reason: the primitive owns the box, and inline
editing is behaviour.

**The cascade resolver is now shared** — `test/css-box.tsx`, used by `panel-boxes` and `field-boxes` — and
moving it bought a repair. It flattened by source order only, and once the input box moved into
`primitives.css` (loaded BEFORE `styles.css`) the type selector `button, input, select, textarea { font-size:
inherit }` won every comparison, so **every text box in the app read as `font-size: inherit`** while the
browser gives the class (0,1,0) the win. It now resolves a coarse specificity first and source order second.

#### The sweep, and where it stopped

**443 → 392 by the method at the top of this page** (`styles.css` 414 → 355, `primitives.css` 29 → 47; the
distinct union is 392). Measured by `node tools/check-class-budget.mjs`, which is wired into `npm run check`.
What went, and what it went into:

| merge | classes | after |
|---|---|---|
| the eleven micro/muted/mono facts, plus 11 more at other sizes and tones | −22, +9 (`Readout`) | 421 |
| the five wrapping figure rows (two ledgers, three meta rows) | −5, +1 (`ReadoutLine`) | 419 |
| four count badges — `.board-count`, `.column-count`, `.exec-count`, `.dock-badge` — each with its own ground | −4, +1 (`Chip fill`) | 419 → 419 |
| the ten text boxes, six hints, ten error lines and boxes, four rail labels | −29, +9 (`Field`) | 395 |
| the seven classes whose whole content was `margin-left: auto` | −7, +1 (`.push`) | 392 |

**`Chip` gained `fill` on a measurement, the same way `Button` gained `bare`.** Four count badges chose their
own ground — `--panel-2` twice, `--bg` once, none once — for one thing: how many items are in the group
beside it. A fill is what distinguishes a count from a state chip, which is an outline. One flag, four
classes.

**`.push` is the one layout utility in the file and it is a deliberate exception rather than the start of a
set.** Phase 3 measured seven classes whose entire content was `margin-left: auto` and left the call to this
phase, because collapsing them means a shared utility class and "no utility framework" is an explicit
non-goal. The call: name the thing they all say — *this one goes to the far end of its row* — and add nothing
beside it. `.tile-archive`'s red hover survives as `.tile-head > .push:hover:not(:disabled)`.

**The mechanism that made most of this possible is worth naming: a leaf class whose only content was
positional became a DESCENDANT rule of the container that already had a name.** `.exec-cost`/`.exec-when`
became `.exec-run-top > .vb-readout` and `.exec-run-top > .vb-readout + .vb-readout` — the same pair of
claims the two classes made by hand, minus two names. It is also a better statement of the truth: the row
decides how its figures sit, not the figures.

**WHAT PHASE 5a LEFT, AND WHAT 5b DID WITH IT.** The list below was 5a's own measurement of the gap. 5b
took the first three items and the two select triggers, built the seventh primitive, and stopped where
the measurement said stop:

| 5a's remaining work | what 5b did | classes |
|---|---|---|
| ~14 uppercase display-face labels → `.vb-label-caps` | **two migrated; the family refused** — and `.vb-label-caps` turned out not to exist | 392 → **391** |
| ~20 empty-state and loading lines → one thing | **thirteen migrated to `.vb-empty`, eight died** | 391 → **385** |
| four tinted notice boxes beside `.vb-error-box` | **five classes became `.vb-notice` in three tones** | 385 → **384** |
| the two select triggers → `Field` | **`.vb-trigger`, and it is `.vb-input`'s box with a caret** | 384 → **382** |
| the three tabs → a `Tabs` | **refused, measured** — see below | 382 → 382 |
| the two segmented cells → a `SegmentedControl` | **built, and it took four classes not two** | 382 → **380** |
| `.archive-title` → `Panel flat` | **refused, measured** — and a dead `font-size` removed instead | 380 → 380 |

#### `.vb-label-caps` was named at eight call sites and defined by no rule

**That is a live defect and the characterisation suite found it before the merge touched anything.**
`SkillEditor`'s three rail labels and `DispatchPane`'s five all write `className="vb-label vb-label-caps
…"`, and no stylesheet in the tree contained the string `label-caps`. Seven of the eight were uppercase
anyway, because `.vb-label-rail` carried the `text-transform` — but `DispatchPane`'s prompt label has no
rail, so it named a class for its caps and **rendered in lower case**.

**Neither gate could see it, and the reason is structural.** `check-class-budget.mjs` reads CSS → code, so
it finds a rule with no reference; this is a reference with no rule, which is the other direction and
nothing measures it. Every React test runs in jsdom, which computes no cascade. And
`test/field-boxes.test.tsx`'s rail-label test was **vacuous about exactly this**: its fixture is
`<span class="vb-label vb-label-caps vb-label-rail">` asserting `text-transform: uppercase`, which
`.vb-label-rail` supplied on its own — an assertion true of a fixture that could not have contained the
class it names. A fixture too thin to distinguish two outcomes tests neither.

**Fixed by separating what the two decide: the RAIL is a width, the CAPS is a face.** Pinned as `it.fails`
first, so it flipped when the rule existed rather than being quietly reworded, and `.vb-label-rail`'s
negative is now asserted too — a rail that took the `text-transform` back would make the caps class
vacuous again without failing anything.

**THE FOURTEEN-NAME MERGE IS REFUSED, and the number is why.** Only two of the fourteen died:
`.reports-head` and `.options-head`, which were `--t-small` muted uppercase with `margin: 0` — exactly
`.vb-label` plus `.vb-label-caps`, with no judgement in either. The other twelve keep a real declaration
only the surface can make, which is the same result Phase 3 measured on its 27:

| what the survivor still says | which |
|---|---|
| an ink somebody chose | `.settings-section` `--accent`, `.diary-kind` and `.filed-state` `--text`, `.tile-group` and `.cv-group` `--accent-2` |
| a layout | `.exec-head` and `.control-group-head` are flex rows |
| an inset | `.cs-head`, `.ap-drawer-head`, `.links-group` |
| a size | `.report-prompt-label` at `--t-micro` |
| not a label at all | `.mp-def-tag` is a bordered pill — a Chip that happens to be uppercase |

**Both ways of forcing the merge were costed and both were refused.** Giving `.vb-label-caps` the size and
the ink and adding tone variants to match `Readout`'s (`accent`, `accent2`, `text`) plus a `micro` step
kills six and adds five: **net −1**. Giving it only the face and tracking kills none and adds one:
**net +1**. And either version has to put `--font-display` on the eight of the fourteen that do not have
it, which re-faces eight surfaces in a condensed face to move the count by one. *Do not merge two classes
that differ in a way a person can see just to move the number* — so the two that die outright died, and
the twelve are recorded above with what each of them still says.

**The tracking is normalised and nothing else is.** Five values across the fourteen — `0.06` / `0.08` /
`0.1` / `0.12em` — is the same ladder nobody chose that the 27 font sizes were, and `.vb-label-caps` takes
`0.06em`, which is the mode and is what the eight existing call sites already rendered. Zero rendering
change at those eight.

#### The empty states were one thing, and the italic was the finding

**Seventeen classes, and every single one of them declared `color: var(--muted)`.** That is the family:
muted prose where content would be. They agreed on nothing else — four sizes, five paddings, three
line-heights, and **seven italic against ten not, with nothing whatever distinguishing them**.
`.cv-nobody`, `.report-empty` and `.inline-empty` were byte-for-byte one declaration set under three
names.

`.vb-empty` is `--muted` `--t-body` italic at `line-height: 1.5` with `margin: 0`, plus one size variant.
Italic because `.vb-hint` already established it for muted secondary prose and because an empty state is
the interface talking about itself rather than showing content — the same distinction the readout draws
between a measured fact and a written sentence. **`margin: 0` for the reason `.vb-label-caps` has it:**
half of these are `<p>`s that never wanted a paragraph's margins.

**ONE SIZE VARIANT AND NO MORE.** `--t-small` earns its place on four consumers inside dense lists. The
diary's `--t-lead` blank and the two `--t-micro` tree rows keep their own size, because a variant with one
consumer is a name that decides nothing — the argument that kept `ghost` at two and refused `--t-display`
a second consumer in 5a.

**Eight died and five survive with only what the surface can decide.** Dead: `.archive-empty`,
`.cv-nobody`, `.report-empty`, `.inline-empty`, `.copilot-empty`, `.ap-drawer-empty`, `.exec-empty`, and
`.chat-menu-empty` — whose only remainder was its container's inset, so it became `.chat-menu > .vb-empty`,
the descendant-rule mechanism 5a named as what made most of its sweep possible. Surviving with one
declaration each: `.mp-empty`, `.cards-gone`, `.control-empty` (a padding), `.explorer-more`, `.cs-empty`
(a size).

**Two of the eight gained an italic they did not have** — `.copilot-empty` and `.ap-drawer-empty` — and
that is a visible change made on the 7-against-10 measurement rather than on taste. **Four classes are NOT
in the family**, each for a reason a person can see: `.column-empty` is a dashed drop target,
`.diary-empty` is a flex column with a button in it, and `.empty` / `.control-blank` are `margin: auto`
blanks filling a pane — a layout rather than a line.

#### One notice box in three tones

**Five classes drew the same box** — `.vb-error-box`, `.settings-warn`, `.control-disclaimer` and
`.sandbox-state`, all with a `--r-md` corner, `var(--s-4) 0.7rem` of padding and a 1px border, differing
only in hue and in a line-height nobody chose (1.45 / 1.5 / 1.55). `.sandbox-ok` and `.sandbox-off` were
**already a tone set written by hand** on top of `.sandbox-state`, which is what says the shape wanted a
tone axis rather than four more names.

**The ink is part of the tone and not a separate axis.** `bad` is danger ink because a refusal IS the
answer to what you just did; `warn` and `ok` are prose ink because they are conditions you can read and act
on — which is `.control-disclaimer`'s own comment, *"set as prose rather than as status"*.

**`.control-disclaimer` is the one survivor and it keeps exactly two things**: the shell's inset, and a
prose ink over the danger hue. That combination is deliberate and could not be a tone without inventing a
fourth, so it overrides the tone's colour at equal specificity — the pattern the emergency stop's danger
hover established in Phase 3. Its hue was NOT moved to `--warn`: `themes.css` gives `--warn` and
`--danger` different values in marshmallow, so that would have been a repaint of one theme dressed up as
a merge. **Net −1**: five dead against four added.

**`.vb-error-box` was renamed, so its two test selectors moved in the same commit** —
`test/dispatch-pane.test.tsx`, which the 5a notes name as keeping them on purpose because they assert the
refusal box IS that box. `test/settings-columns-warning.test.tsx`'s `.closest('.settings-warn')` became a
`data-testid`.

#### The two select triggers, which this document had called an input twice without making one

**`.chat-current` and `.mp-trigger` are `.vb-input`'s box with a caret**, and Phase 3 and Phase 4 both said
so — *"an `<input>` that happens to be a button"* — and left them. `.vb-trigger` joins the box's own
selector list, so a trigger cannot forget the box.

**The two differences between them were not chosen by anybody.** The chat switcher sat on `--panel-2` and
the model picker on `--bg`, while nine of the ten text boxes `Field` took chose `--bg`; and their vertical
paddings were two pixels apart. Both now take the box's, which also puts them at `--t-body` beside the real
inputs they share a row with — **a control at 12px next to an input at 13px is the shape of the 10.88px
incident**, and the dispatch pane had exactly that.

**The carets were two names for one glyph**: `.mp-caret` muted at the trigger's own size, `.chat-caret`
accent at `--t-micro`. `.vb-caret` is muted, because a caret is furniture on a control whose border already
answers the hover.

**The layout did not move, and that is measured rather than asserted.** The four checks that would have
seen it: **3. overflow 0 findings across 121 examined** (120 at the Phase 4 baseline); **7. one line where
one line is meant, 0 findings across 25 rows**, unchanged; **9. the shared grid — 9 rows, 42 columns, 42
heads, narrowest track 180px at 900/1200 and 192px at 1440, only `main.boards` scrolling**, unchanged; and
**10. the dock, 342px with a raw pane open and a 263px pane inside it**, the recorded 79px shortfall
unmoved. All three themes.

#### `Tabs` was refused, and `.archive-title` was not made a `Panel`

**Three tab candidates and only two are tabs.** `.cards-tab-label` has `border: none` and no corner: it is
the ellipsised label *inside* a tab, not a tab. And the two real ones disagree on both of the things a tab
primitive would have to own:

| | `.tab-btn` | `.dock-tab` |
|---|---|---|
| face | not uppercase, `0.04em` | uppercase, `0.08em`, `--font-display` |
| selected | `--accent` ink, `--panel-2`, plus a `--glow` | `--text` ink, `--panel-2`, no glow |

**Two consumers disagreeing on both of a primitive's decisions is a primitive that carries one variant
each, which is a name that decides nothing** — the same test that keeps `ghost` at two and that the
segmented cells pass on the opposite evidence. So: **not built, at two real consumers with two visible
disagreements**, and `.cards-tab-label` is not a fourth.

**`.archive-title` is not a `Panel flat` either, and the measurement is that the migration saves zero
classes.** Its remainder after `flat`'s declarations come out is `flex: 1; min-width: 0; white-space;
overflow; text-overflow` plus a hover ink — so the class survives, exactly as Phase 4 measured for its
nine migrated rows. And taking it costs a real layout change: `.archive-item` would have to give up its
padding and its `gap` so the title's `flat` padding could supply the row's inset instead, which moves the
row's height by 2px and makes the arrangement of three cells depend on one of them.

**What was wrong with it was something else, and it is fixed.** Its only geometry declaration was
`font-size: var(--t-body)` — which is what `body` already gives it. A dead declaration restating an
inherited value: **the same defect Phase 4 found on `.cv-link`**. Removing it took the class off the
geometry ratchet with no rendering change at all.

#### The segmented control: four classes, one shape, and the file said so itself

`.mode-group` and `.backend-toggle` were **byte-identical**. `.mode-btn` and `.bt-btn` were identical
declaration for declaration apart from one size step — and `.backend-toggle-md .bt-btn` **restated
`.mode-btn`'s padding and font-size verbatim**, which is the stylesheet asserting the equality on its own
behalf.

**The proof is a multiset diff and not an argument.** The four classes declared **36 things with 19
distinct values**, every one of them written twice except the two `sm` values; `.vb-seg`, `.vb-seg-cell`
and `.vb-seg-cell-sm` declare **19**. The distinct sets are identical: **0 added, 0 removed, 0 changed.**
`md` is the default because three of the four call sites already rendered it. **Net −2**: five dead
(`.mode-group`, `.backend-toggle`, `.backend-toggle-md`, `.mode-btn`, `.bt-btn`) against three added.

**The group owns the one border and the one corner and clips its cells**, which is exactly the reason
Phases 3 and 4 both refused to make these `Button`s: every Button variant gives the cell its own border
and radius, and that puts a seam down the middle of the group.

#### WHAT STANDS BETWEEN 380 AND 183, measured rather than estimated

- **The three tabs and the four chips — 7 of the 8 geometry-ratchet survivors.** The tabs are refused
  above with their measurement. The four chips (`.tag`, `.tag-chip`, `.mp-chip`, `.board-archive`) still
  belong to `Chip` and are still held back only by `.board-archive`'s pill and `.tag`'s tile-local sizing,
  exactly as 5a recorded. `.board-label` is the eighth and is a collapsible section heading, not a control.
- **The twelve surviving uppercase labels**, each with what it still says, in the table above. Closing
  them means either a tone axis on `.vb-label` (costed at net −1) or moving three insets onto their
  containers' `gap`, which is three separate layout judgements.
- **The five surviving empty states**, which are four paddings and two sizes. Each would become a
  descendant rule of its container, and only `.chat-menu` had a container named cleanly enough to take one.
- **The rest — roughly 300 — are the seventeen surfaces' layout classes**, and the honest reading is that
  this is where the whole remaining gap lives. The budget allows 8 per surface and the largest families are
  `ap-*` **29**, `mp-*` **22**, `report-*` **19**, `control-*` **17**. Halving them means merging surfaces
  that are genuinely different shapes, and **it is still the part of this work with no measured argument** —
  see the note under the re-derived budget: whether 8 is a floor a real surface can live at is the one term
  in the target still expressed against a number nobody has measured.

**A real 392 with that list is worth more than a 149 reached by deleting something live**, which is the
choice this phase actually faced: the reference gate below finds six unreferenced classes on a first run and
every one of them was a leftover of this phase's own edits, not a dead surface.

#### Gates

**`tools/check-class-budget.mjs`, wired into `npm run check`, makes two claims.**

**Claim 1 — every class selector in both stylesheets is referenced from `web/src`. BLOCKING at zero.** It
**resolves** template-literal composition rather than allow-listing it, which is the more expensive of the
two options *Risks* offers and the one that cannot rot: a prefix is read from the source
(`` `ap-bar-${ ``), the suffix must appear as a quoted string or a numeric literal in the corpus, and both
halves are re-derived on every run — so a prefix whose call site is deleted stops resolving anything and its
classes go straight back to being findings. Comments are stripped from the corpus first, because several
comments in this repository name classes they have just removed and a comment must not keep a class alive.
**Eight prefixes resolve today** against 1,423 quoted values: `ap-bar-*`, `msg-*`, `status-*`, and the five
primitives' own (`vb-btn-*`, `vb-chip-*`, `vb-dot-*`, `vb-panel-*`, `vb-readout-*`).

**Proven by planting, four ways, each restored:**

| planted | result |
|---|---|
| `.ap-bar-running` renamed to `.ap-bar-runningx` — a DYNAMICALLY composed class | exit **1**, naming `.ap-bar-runningx`. This is the one that matters: the literal-grep version of this gate deletes that rule and the board looks perfect until a run halts |
| `.dead-and-never-named` appended to `styles.css` | exit **1** |
| the selector regex broken (`/\.(name)ZZZ/`) | exit **1**: *"only 0 class selector(s) found, against a floor of 40 — this check is vacuous"* |
| comment stripping removed from `codeOf` | exit **1** from the parser self-test: *"comment stripping: a commented class survived"* |

The self-test goes through the same four functions the census does — the lesson from
`check-radius-scale.mjs`, whose first self-test carried its own regex and therefore had no opinion about the
code under test at all. Its fixture holds a literal class, a class composed from a prefix and a quoted
value, a class composed from a prefix whose value is written NOWHERE (the shape of a renamed dynamic class,
and the one finding it must produce), and a class named only in a comment.

**Claim 2 — the class count, and it is a RATCHET at 380 rather than blocking at 183.** That is a departure
from the plan and it is deliberate: *"never point a blocking gate at a pre-existing backlog"* is this
document's own rule, and a gate that must be bypassed on every commit teaches everyone to ignore it. The
target is written into the failure message and into the constant beside the ceiling, so the number to beat
is visible on every run. **Proven by planting, at both ceilings:** a new class added to `styles.css` and
referenced from `CardTile.tsx` — so claim 1 could not mask it — took the count to 393 against the 5a
ceiling of 392 and exited **1**, and the same plant at the 5b ceiling of 380 took it to 381 and exited **1**.
Lower it as the sweep continues; the commit that reaches 183 is the commit that sets it to 183.
**Never raise it.**

**Claim 1 was re-planted after 5b, on a class the primitives compose rather than write.**
`.vb-seg-cell-sm` reaches its element through a ternary in `SegmentedControl.tsx`, so it is exactly the
shape the reference gate exists for. Renamed to `.vb-seg-cell-smx`, the run exited **1** naming it; the
literal-grep version of this gate would have deleted the rule and the backend picker in Settings would
have silently rendered at the dock's size.

**Check 11 — numbers align in a column, MEASURED.** A `font-family` assertion says a declaration exists; it
does not say the digits line up, and it would pass with `font-variant-numeric` deleted. So a real readout is
cloned twice off-screen and the advance compared: ten `1`s against ten `8`s, and ten `i`s against ten `M`s.
Measured identically on all three themes: **79.140625px / 79.140625px** for the digits and the same for the
letters, across **25 readouts** on the board. **The anti-vacuity half is asserted FIRST**: the same letter
pair measured in the surrounding proportional type is **78.140625px against 151.96875px**, which is what
says the instrument can tell two widths apart at all — without it, the check compares two numbers that a
proportional face might also render identically.

**Planted at check 11, and the second plant is a finding about the check itself:**

| planted | result |
|---|---|
| `.vb-readout` set in `var(--font-body)` instead of `var(--font-mono)` | exit **1** on all three themes: *"ten 'i's measured 43.46875px against ten 'M's at 107.8125px in a readout — the face is not monospaced"* |
| `font-variant-numeric: tabular-nums` deleted, the mono face kept | **exit 0 — an equivalent mutant, verified rather than assumed.** In a monospaced face every digit already has one advance, so the declaration is belt-and-braces while the family holds. It is kept because it is what makes the claim true of any readout a surface re-faces, and this check cannot see it. Recorded here rather than left for someone to rediscover as a hole |

**Check 7 caught a real regression this phase introduced, which is the harness earning its keep.**
`ReadoutLine` aligns on the baseline — right for a row of text at two sizes — and the copilot footer's last
item is the context METER, a 5px bar with no baseline of its own, which then hung 1.5px below the figures
beside it: *"div.vb-readout-block — 4 children span 15.5px, tallest is 14.0px"*, exit 1 on all three themes.
`.copilot-readout` takes `align-items: center` back, with the reason written beside it: a graphic in a row of
text is the one case where centring the boxes is right.

**The drift was read, and it did not fire — which needed explaining rather than accepting.** The drift check
compares the SET of computed values, not the tally, and the set is unchanged in both passes: type
`13 / 12 / 11 / 15px`, radius `6 / 999 / 10px / 50%`. **No baseline file changed in either pass**, so
`visual:record` was not run at all.

**The TALLY moved twice and was read both times.** 5a: `12px×84 → ×71` and `11px×19 → ×33` on 232 elements
(231 before) — thirteen elements from 12px to 11px, accounted for by `Readout`'s `--t-micro` default
replacing a `--t-small` surface class and by the four count badges becoming `Chip`s at `--t-micro`.

5b: **`13px×127 → ×133`, `12px×71 → ×66`, `11px×33 → ×32`**, `15px×1` unchanged, still 232 elements. **Six
elements moved to 13px and every one is accounted for**: the two select triggers, their two labels and their
two carets. Five came from 12px — both triggers were `--t-small` and both labels inherited it — and one from
11px, the chat caret, which was the only one of the six that named `--t-micro`. Radius tally unchanged.

**Everything else held, measured not assumed** (5b figures, all three themes): overflow **0 of 121**,
clipping **1 of 35** (the exempt board area), contrast **0 of 125**, wrapped rows **0 of 25**, focus
**0 of 55**, unresolved tokens **1 of 41** (`--exec-cols`, still a gap in the harness's coverage rather than
a defect), primitive focus rings all present, the shared grid **9 rows / 42 columns / 42 heads** with only
`main.boards` scrolling, and the dock **342px with a raw pane and a 263px pane inside it** — the recorded
79px shortfall unmoved. **33 harness tests, three themes, exit 0.**

**Authored declarations after both passes:** `font-size` **202 → 155 → 136**, `border-radius`
**80 → 65 → 59**, both still entirely on the scale, both checks blocking. **The geometry ratchet went
13 → 13 → 8**: 5a merged treatment and not button geometry, and 5b took the two select triggers, the two
segmented cells and `.archive-title`'s dead `font-size`. The ceiling is lowered to 8 in the same commit.

**Selector migrations: 127 → 108 in 5a, and 108 → 108 in 5b.** Measured with the command recorded at the
end of Phase 3. 5a migrated nineteen: `.exec-cost`, `.report-cost`, `.report-when`, `.reports-ledger` (×5),
`.report-created .link-id`, `.diary-chip` (×2), `.control-editor-path` (×3), `.board-count` (×3),
`.dock-badge` (×4), `.exec-count` — each replaced by a `data-testid` at the call site, which the primitives
take as a named prop rather than as an arbitrary spread.

**5b's net zero is two out and two in, and reporting it as "unchanged" without the movement would be
laundering it.** Out: `.vb-error-box` and `.mode-btn.active`, both classes that this pass renamed. In:
`.vb-notice`, because `test/dispatch-pane.test.tsx` asserts that the refusal box IS that box — which is the
claim, and the reason 5a's notes say it keeps class selectors on purpose — and `.active`, scoped by the mode
group's accessible role rather than by a class, because the highlight is what that test is about and
`.active` did not move. A third went through a `data-testid`: `test/settings-columns-warning.test.tsx`'s
`.closest('.settings-warn')`.

#### The count floors were the wrong instrument, and two of them fired

**A count floor on a number the sweep exists to reduce fails the run for SUCCEEDING, and says
*"this check is vacuous"* while doing it.** Phase 3 hit this on `check-radius-scale.mjs`'s button-class
population and replaced it with a parser self-test. Phase 5b hit it twice more, and the precedent was
applied both times.

- **`check-type-scale.mjs` was five away.** Its floor was **150** font-size declarations and 5a's sweep had
  taken the tree to **155**. It was repaired FIRST, before the merge, so the sweep was not fought against
  a false failure — and the merge then took the count to **136**, which the old floor would have refused.
- **`check-radius-scale.mjs`'s radius floor was ZERO away, and it fired.** 65 declarations against a floor
  of 60; the segmented-control merge took the tree to **59** and `npm run check` exited 1 with *"only 59
  border-radius found, against a floor of 60. This check is vacuous."* Same repair, same commit.

**Both replacements are self-tests over a fixture the tree cannot move**, going through the census's own
functions rather than a second copy of the pattern — the lesson from `check-radius-scale.mjs`, whose first
self-test carried its own regex and therefore had no opinion about the code under test at all. Each fixture
exercises the case that can silently break: a comment naming a declaration in prose (which must not be read
as one, and must not shift the line numbers of what follows), the compact no-whitespace form a reformatting
run produces, the shorthand, and a token name that is not a step.

**Each self-test found something about the parser on its first run, and both are recorded rather than
smoothed away** — an expectation written to look tidy is an expectation that stops matching the code:

| found | what it is |
|---|---|
| `FONT_SHORTHAND` carries the space before a closing `}` into its message, so the finding reads `font: 14px/1.2 sans-serif  — …` with two spaces | cosmetic, pre-existing, and now in the fixture's expectation |
| a rule nested in an `@media` has its `border-radius` counted **twice** — `rulesOf` emits both the inner rule and the at-rule, whose body text contains the declaration | over-reports, which is loud and harmless. **Latent, not live**: measured on 2026-08-21, no `border-radius` in the tree sits inside an `@media`, `@supports` or `@container`, so the 59 the check prints holds no duplicate |

**Both proven by planting, each restored.** Type scale, exit **1** on all of: a broken `FONT_SIZE` regex
(counts 155 → 0), a broken `SPACE` regex (258 → 132 in the tree and 3 → 2 in the fixture), comment blanking
removed — which reported **157** authored font-sizes against the real 155, *the two extra being prose*, and
so is also the proof that the old floor of 150 was partly satisfied by comment text — and a deliberately
wrong number in the fixture's own expectation. Radius scale, exit **1** on all of: a broken `border-radius`
regex, a broken brace matcher in `rulesOf`, and a wrong number in the fixture. Restored, both files are
byte-identical and `npm run check` exits 0.

**The two extractions the self-tests needed were then flagged for cognitive complexity, and the cause was
removed rather than suppressed.** `scan` and `radiiOf` each put three branches inside two or three loops;
`fontSizeFault`, `bandedLengths`, `cornerFault` and `shorthandFaults` flatten them. The metric punishes
nesting far harder than length, so flattening beat every other shape — and the self-tests were re-planted
after the flattening, all five exiting **1** again.

**Exit:** **380 class selectors** (target 183, not reached — see *What stands between 380 and 183*),
**136 authored `font-size` declarations**, **59 authored `border-radius` declarations**, **geometry ratchet
8/8**. Suite **240 files, 4,271 tests**. Harness **33 tests, three themes, exit 0**. `npm run lint` clean
over 539 files.
**Revert:** `web/src/ui/{Readout,Field,SegmentedControl}.tsx`, the Readout / Field / notice / empty /
trigger / SegmentedControl blocks of `primitives.css`, the ~40 components that call them, `styles.css`,
`tools/check-class-budget.mjs` with its two `package.json` entries, the floor removals in
`check-type-scale.mjs` and `check-radius-scale.mjs`, check 11 with `auditReadouts`, and
`test/{field-boxes,label-notice-boxes,css-box}` with `panel-boxes`'s import of the last.
No baseline file is involved.

---

# Part Two — the phases the first six did not cover

**Status: Phases 6, 7, 8, 9 and 10 done 2026-08-21. Part Two is complete.** Part One built seven primitives and thirteen gates. It was
reviewed phase by phase and every gate was green. It also missed a whole family of work, and the miss was
reported by the owner looking at the board rather than by any check — which makes the cause worth stating
before the phases: **only the button shape has a coverage gate.**

## What is uncovered, measured

`tools/check-radius-scale.mjs` counts button-shaped elements that declare their own geometry, and it is the
only gate that asks *"how much of this shape is still hand-rolled?"*. Nothing asks it of the other six
primitives, so their remaining backlog is invisible to every check and to every review that trusts the
checks.

The **gate** column is Phase 7's work and every number in it is now printed by
`npm run check:shape-coverage` on every run. The *estimated* column is what this table carried when Phase 7
started; the *measured* column is what the census derives, with the disagreements explained under Phase 7.

| primitive | call sites | hand-rolled, estimated | hand-rolled, the census's own rule | coverage gate |
|---|---|---|---|---|
| `Button` | 66 | **8** (tabs, labels, chips — the ratchet) | 8 | `check:radius-scale`, claim 2 |
| `Panel` | ~20 | **32** panel-shaped rules, including `.tile` | 32 → 28 (four were chips) → **20** (Phase 9: eight were controls) | `check:shape-coverage`, panel |
| `Field` | 9 → **22** | **~33** raw `input`/`textarea`/`select` across 23 files | 35 → **2** of 42 (Phase 9; the two are `InlineField`'s) | `check:shape-coverage`, control — **two arms, arm 2 blocking at zero** |
| `Chip` | 15 → **29** | **9** chip classes | 10 → **0** (Phase 8; `.markdown code` exempt by name) | `check:shape-coverage`, chip — **blocking at zero** |
| `Readout` | 45 | **14** hand-rolled `--font-mono` rules | 14 → **11** (three were chips) | `check:shape-coverage`, mono |
| `Dot` | 3 → **4** | 1 | 1 → **0** (Phase 8) | `check:shape-coverage`, dot — **blocking at zero** |
| `SegmentedControl` | 2 | 0 | **0** | `check:shape-coverage`, seg — **blocking at zero** |

Commands: `grep -rn '<Chip' web/src --include=*.tsx | wc -l` and siblings for the call sites;
`npm run check:shape-coverage` for every hand-rolled count, which prints its full list on a passing run.

**~~Two rows still have no gate~~ — EVERY ROW HAS ONE, as of Phase 8.** Phase 7's reading was that *"a census
for one hand-rolled instance is a gate at a backlog of one, and a census for zero is a gate blocking at zero
… but there is nothing to ratchet"*, and it left `Dot` and `SegmentedControl` ungated. Phase 8 reversed it on
this page's own evidence: the shape nobody counts is the shape that gets hand-rolled back in, and a coverage
table with a hole in it is precisely what let nine chip classes accumulate through six green phases. Both
censuses read **zero** and both block outright. The Dot's one instance —
`.copilot-status .status-dot`, a `50%` circle named in `check-radius-scale.mjs`'s `OFF_SCALE_ON_PURPOSE` — is
a `Dot`, so `OFF_SCALE_ON_PURPOSE`'s note about it is now history rather than a pointer.

**The chip family is the one the owner saw**, and it is exactly what an uncovered shape looks like: `.tag`,
`.tag-btn`, `.tag-chip`, `.tag-chip-count`, `.mp-chip`, `.board-archive`, `.tile-setup`,
`.tile-suggestions`, `.tile-problem`. Most are `<span>`s, and the one gate that could have counted them
only inspects button-shaped elements, so they were never in any number this page reports. **All nine are
`Chip`s or gone as of Phase 8**, and the four of them that declared no box at all are held by a named list
rather than by a shape rule — see Phase 8's *8b*, which is the half of that phase no census could have
found.

### And the browser only ever sees one page

`visual/support/fixtures.ts:82` **was** the whole of the harness's navigation: `page.goto('/')`. So every
claim Part One makes about the *browser* — contrast at 4.5:1, focus visible, nothing overflows, nothing
clips, type and radius conformance — was a claim about **the board view alone**. Execution, Project Log,
Project Control and Explorer are four other top-level views; an open card, the archive drawer, settings, the
model picker and the confirm dialog were never rendered at all.

That is also why Phase 0 measured 15 computed font sizes against 27 authored: the other twelve were on
surfaces the harness could not reach. The static checks close that gap **for values in the file**; they
cannot close it for layout, contrast or focus, which only exist at render time.

**Phase 6 closed it — ten surfaces instead of one, and the answer was four findings.** See its section
below: type and radius conformance are zero on all ten, the two run-time tokens are the coverage gap Phase 0
named rather than a defect, two `flex-wrap: wrap` rows on the Project Log are doing what their rule permits,
and **two checkboxes in Settings have no focus style at all** — the one real defect, and Phase 9's.

---

## Phase 6 — see the whole app — **DONE 2026-08-21**

The harness measures **ten surfaces** where it measured one. `visual/support/surfaces.ts` is the whole of
the new navigation and `visual/checks/surfaces.spec.ts` runs checks 1–8 on each, per theme: **93 harness
tests against 33**, exit 0.

**The backlog it surfaced is four findings, and only one of them is a defect.** That is a smaller answer
than this phase expected and the reason is measurable: the two static checks — `check:type-scale` over the
authored file and `check:radius-scale` beside it — had already driven the values on surfaces the browser
could not reach, and the browser now confirms it. **Type and radius conformance are ZERO on all ten
surfaces on all three themes**, which is the claim Phase 0 could not make: it measured 15 computed sizes
against 27 authored and named the twelve-value gap as surfaces the harness never opened.

### The table: every check against every surface

Findings / examined, identical on all three themes unless noted. `root` is what the walk was scoped to.

| surface | root | 1. type | 2. radius | 3. overflow | 3b. clip | 4. contrast | 5. tokens | 6. focus | 7. rows | 8. rings |
|---|---|---|---|---|---|---|---|---|---|---|
| boards | document | 0/236 | 0/236 | 0/125 | **1**/35 | 0/129 | **1**/41 | 0/56 | 0/25 | 29 of 29 |
| execution | document | 0/146 | 0/146 | 0/77 | 0/12 | 0/84 | **1**/41 | 0/42 | 0/11 | 16 of 16 |
| diary | document | 0/148 | 0/148 | 0/78 | 0/15 | 0/82 | **2**/41 | 0/38 | **2**/11 | 14 of 14 |
| control | document | 0/168 | 0/168 | 0/63 | 0/13 | 0/88 | **2**/41 | 0/59 | 0/8 | 15 of 15 |
| explorer | document | 0/127 | 0/127 | 0/62 | 0/13 | 0/71 | **2**/41 | 0/43 | 0/14 | 15 of 15 |
| card | `[data-testid="dock-body"]` | 0/57 | 0/57 | 0/30 | 0/3 | 0/35 | **2**/41 | 0/18 | 0/4 | 8 of 8 |
| archive | `[data-testid="archive-drawer"]` | 0/9 | 0/9 | 0/3 | 0/2 | 0/4 | **1**/41 | 0/3 | 0/1 | 1 of 1 |
| settings | `.modal:not(.confirm)` | 0/125 | 0/125 | 0/79 | 0/14 | 0/80 | **2**/41 | **2**/24 | 0/0 | 7 of 7 |
| model-picker | `.mp-modal` | 0/57 | 0/57 | 0/23 | 0/4 | 0/31 | **2**/41 | 0/14 | 0/5 | 5 of 5 |
| confirm | `.modal.confirm` | 0/8 | 0/8 | 0/4 | 0/1 | 0/4 | **2**/41 | 0/2 | 0/0 | 2 of 2 |

**Two cells are `0/0` and they are vacuous, which is stated rather than counted as a pass.** Neither the
settings modal nor the confirm dialog contains a flex row of three or more visible children, so check 7 has
nothing to ask of either. That is a fact about those two surfaces and not a hole: a row is what the check is
about, and inventing a floor for a surface with no rows would fail the run for succeeding — the count-floor
mistake this page has now made three times (`check-radius-scale`'s button population, `check-type-scale`'s
150, `check-radius-scale`'s 60).

**Five surfaces are measured against a ROOT and five against the document, and the split is not a
convenience.** A top-level view IS the page. The other five render with the board still behind them, so a
whole-document walk would report the board's 236 elements again under a second name — and *a harness that
measures the board five times and reports it as five surfaces is worse than one that measures it once,
because the numbers would look like coverage.* An unmatched root yields an EMPTY population rather than
falling back to the document, so a root that stopped matching fails a floor instead of measuring the board.

### The four findings, each with what it is

- **`--exec-cols` and `--max-cols` — 2 unresolved tokens off their own view, 1 on it.** Both arrive as an
  inline style from React (`main.execution` and `.board-columns`), so each resolves on the one surface that
  supplies it and is a finding on the nine that do not. Phase 0 recorded `--exec-cols` as *"a gap in the
  harness's coverage rather than a defect"*; the gap is closed and the reading is unchanged. **Neither is
  touched here** — `--exec-cols` is Phase 10's.
- **Two wrapped `.vb-readout-block` rows on the Project Log**, *"4 children span 33.0px, tallest is
  15.0px"* — the two `.filed-entry` meta rows, in the narrow right-hand column of the split. **The rows are
  doing what their own rule permits:** `.vb-readout-block` declares `flex-wrap: wrap` and 5a's note calls
  these *"the five wrapping figure rows"*. So this is an instrument gap rather than a layout fault — check 7
  does not exempt `flex-wrap: wrap` the way check 3 exempts `text-overflow: ellipsis`, which is the same
  kind of deliberate statement. Recorded at 2 and **not** exempted, because narrowing a check is a ruling.

  **RULED 2026-08-21: check 7 does NOT get a `flex-wrap: wrap` exemption, and the two findings stay findings.**
  Two reasons, and the second is the one that decides it. The check exists for the action rows that have
  wrapped twice; an exemption keyed on `flex-wrap: wrap` means anyone who adds that declaration to an action
  row silences the check on it, which is suppressing a warning rather than removing a cause — and the rule it
  would suppress is the one pointing at the real design fault. Second, these are not action rows, they are
  **figure** rows: a wrapped `.vb-readout-block` is a column of figures that does not align, which is
  precisely the claim the Readout signature makes and the reason the whole treatment exists. A gate cannot be
  taught to accept the thing its own page argues against. The fault belongs to `.vb-readout-block` in a narrow
  column, and it is fixed by the phase that next touches the Project Log — not by the check learning to look
  away.
- **TWO CHECKBOXES IN SETTINGS HAVE NO FOCUS STYLE AT ALL, and this one is a real defect.**
  `primitives.css`'s `.vb-field input:focus { outline: none; border-color: var(--accent) }` applies to every
  `input` inside a `Field` — including a checkbox, which paints no border, so the rule removes the app's
  `:focus-visible` ring and replaces it with nothing. Measured: `focus-visible matched but no property
  changed`, with the outline at `style: none` and the UA's `width: 3px` surviving underneath. It is
  **exactly the defect Phase 5 found one level along** — `.skill-input` and `.dispatch-prompt` keeping the UA
  outline where the other eight turned their border — and `Field`'s own `layout: check` variant exists for
  these two controls. **FIXED IN THIS PHASE, not Phase 9**, by excluding `[type='checkbox']` and
  `[type='radio']` from the rule; Phase 9 re-planted the removal of that exclusion and the settings surface
  went 0 → 2 findings on all three themes, exit 1. Phase 9 also found that `test/css-box.tsx` could not see
  the fix at all, because it dropped every `:not()` before matching.

### The empty-surface problem was solved by furnishing the fixture, not by lowering a floor

**A greenfield scaffold has no runs, no suggestions and nothing archived — so three of these surfaces were
not merely empty, one was unreachable.** The Execution view was three empty panels, the Project Log's filed
column was one sentence, and `.board-archive` is rendered only at a non-zero archived count, so the archive
drawer could not be opened at all. Recording those as green is the coverage-shaped lie this phase exists to
avoid.

So `visual/run.mjs` furnishes the fixture **through the product's own stores, imported from `dist/`** — the
reason it already imports `scaffoldProject` rather than reimplementing it: three run records (`writeRun`),
one archived card (`createCard` + `archiveCard`), two diary entries (`appendEntry`) and two filed
suggestions (`writeSuggestion`). **None of the runs is in flight**, deliberately: the server rewrites a
`running` record to `interrupted` when it opens the project, so a `queued` fixture would be measured as
something other than what was written. "In progress" is therefore an empty column on a populated surface,
which is a real state of that view.

**And BOTH guards are kept, because neither is enough on its own.** A floor read out of the baseline can
only agree with whatever was there when `visual:record` last ran, so it would bless a vacuous surface
forever; an absolute floor per surface cannot see a surface that shrank by one element. Every surface
therefore carries an absolute `floor` in `surfaces.ts` **and** ratchets its recorded examined counts.

**Proven by planting, and the plant fired on both halves at once.** With `writeRun` removed from the
fixture, `npm run visual` exited **1**: the Execution and card surfaces REFUSED to measure — *"locator
('.exec-run').first() … element(s) not found"*, *"locator('section.reports') … not found"* — and four other
surfaces failed their examined ratchet, because the attention run's `.tab-badge` went with it: *"[boards]
the elements walk examined 235, against 236 when this was recorded"*, and 147/148, 167/168, 126/127.

### Every surface is proven before it is measured, and the proof was planted at

**`fixtures.ts:82` was the entire navigation of this harness — `await page.goto('/')`.** So every browser
claim in Part One is a claim about the board view. The trap in extending it is that nine of the ten
surfaces would still render *something* if navigation silently failed, and it would be the board.

Each surface therefore names something only it renders, and the four top-level views additionally assert
`main.boards` is GONE. **Planted by removing `surface.open()` from both check bodies in one edit: nine of
the ten refused, each naming its own assertion, and `boards` correctly passed because its `open` is a no-op
by design** — the control that says the plant was a plant and not a broken run.

| surface | the assertion that only it satisfies | what the planted navigation failure said |
|---|---|---|
| boards | `main.boards` visible, `section.board` ×3, a `.tile` | *passes — its `open` is a no-op* |
| execution | `main.execution`, three `section[aria-label]`s, an `.exec-run`, no `main.boards` | `locator('main.execution')` — element(s) not found |
| diary | `.log-split`, both `section[aria-label]`s, a `.diary-entry` AND a `.filed-entry` | `locator('.log-split')` — not found |
| control | `section.control` and **not** `section.control.explorer`, a `[data-testid="control-item"]` | `locator('section.control')` — not found |
| explorer | `section.control.explorer`, a `[data-testid="explorer-item"]` | `locator('section.control.explorer')` — not found |
| card | `.cards-pane` in the dock body, `.cardview .cv-title`, a `.cards-tab`, `aside.card-skills`, `section.reports`, no `.cards-gone` | `locator('.cardview .cv-title')` — not found |
| archive | `[data-testid="archive-drawer"]` — which is on the POPULATED drawer only — and an `.archive-item` | `locator('[data-testid="archive-drawer"]')` — not found |
| settings | `.modal:not(.confirm) .modal-title` reads "Settings", a third `.settings-section` | `toHaveText("Settings")` — not found |
| model-picker | `.mp-modal-title` reads "Choose a model", a `[data-testid="mp-pick"]`, no `.mp-empty` | `toHaveText("Choose a model")` — not found |
| confirm | `.modal.confirm`, `#confirm-title`, `.confirm-body`, exactly two `.confirm-actions .vb-btn` | `locator('.modal.confirm')` — not found |

**`control` and `explorer` would otherwise have proven each other**, which is the one pair where the
assertion had to be written against the surfaces rather than off a class name: the Explorer reuses
`.control` and adds `.explorer`, so Project Control asserts the second is absent.

### The ratchets block an increase, planted on two surfaces the board cannot see

| planted | result |
|---|---|
| `font-size: 0.81rem` on `.exec-head`, an Execution-only rule | exit **1** on all three themes: *"[execution] 1. type conformance went from 0 finding(s) to 3"*, naming `h3.exec-head` three times at `12.96px`. **The board's own check 1 stayed green** — which is the same pair Phase 2 used to justify the static check, now answered the other way round: that phase planted this exact defect and recorded *"`npm run visual` on the same tree exited 0"* |
| `color: #5a5a5a` on `.settings-section`, a settings-only rule | exit **1**: *"[settings] 4. contrast went from 0 to 12"* at **2.51:1**, and `[boards] 4. contrast: 0 finding(s)` on the same run — which is what says the settings numbers are the modal's and not the board's. Green on marshmallow, whose light ground clears 4.5:1 at that ink, so the plant also demonstrates the per-theme split |
| `surface.open()` removed from both check bodies | exit **1**, nine surfaces refusing — the table above |
| `writeRun` removed from the fixture | exit **1**, two surfaces refusing and four failing their examined ratchet |

### Drift: per-surface, on the value SET, and the board's tallies are untouched

**A surface records the SET and the board keeps its TALLY, because the two numbers answer different
questions.** The board's tally is a fact about a fixed arrangement of 236 elements; a surface's element
count moves with the fixture's content — one more run record changes every tally on the Execution view and
nothing about its type. So `SurfaceBaseline` holds `fontSizes` and `radii` as sorted sets and drift over
them blocks symmetrically, NEW and GONE, for the reason board.spec.ts gives: a value disappearing is
usually progress and is also how a whole surface stops rendering.

**Recording a surface's values as a baseline is fine; widening the board's set is not, and the board's set
did not move.** Every surface's set is a SUBSET of the scale and no surface computes anything off it — but
they are not all the same subset, and **two surfaces compute a step the board never renders**: the open card
adds `18px` (`--t-title`, its own title) and Project Control adds `4px` (`--r-sm`). The narrowest are the
confirm dialog and the settings modal at `12 / 13px` and `6 / 10px`. `--t-display` 24px is still absent from
everywhere the browser can reach, exactly as Phase 5 recorded — its one consumer is `.markdown h1`, and no
fixture card has a heading. Recorded per surface for that reason: a shared set would have had to be the
union, which asserts nothing about any of them.

`board.spec.ts`'s record test now carries `surfaces` across rather than rebuilding the file, or the next
`visual:record` would leave nine surfaces with no ceiling.

**The board's asserted numbers are byte-identical to `42b5e7e`** — `findings` on all three themes is
`overflow 0, clipping 1, contrast 0, tokens 1, rows 0, focus 0`, and the drift sets are unchanged.

**Its EXAMINED counts moved from 231 to 236, and both halves of that are accounted for.** The recorded 231
was **stale before this phase**: Phase 5b read its new tally and deliberately did not re-record, because
drift compares the key set and the file's counts are documentary — this tree renders **232** on 42b5e7e,
which is the number 5b's own notes quote. The remaining **+4 is the fixture state, and every one of the
four is a `--t-micro` badge caused by one thing that was written**: `.tab-badge` (the attention run),
`[data-testid="dock-badge"]` (the one active suggestion), `.tile-suggestions` (two open suggestions on the
product card) and `.board-archive` (the archived card) — counted in the page, one each. Nothing else on the
board changed shape.

### What is left where it was, and why

- **Checks 9, 10 and 11 stay in `board.spec.ts`.** There is one board whose three rows share a grid, one
  dock whose height is definite, and check 11 is a claim about a FACE — identical on every surface that
  renders a readout, and already asserted per theme. Check 7's two NAMED rows stay too: the auto-pilot bar
  and the top bar are the shell, not a surface. Its generic half runs everywhere.
- **Check 8 is BLOCKING AT ZERO per surface, and it is the only claim here that is.** It was already zero
  on the board, and a surface where a primitive cannot be reached by Tab has a keyboard fault rather than a
  styling backlog. **112 enabled primitives across the ten surfaces (8 disabled, skipped), every
  one reached by Tab, every one with a ring**, in each theme's own accent.
- **Type and radius conformance are RATCHETS per surface** and remain BLOCKING AT ZERO on the board. They
  happen to be at zero on all ten today, so the ratchet is blocking everywhere — but it is written as a
  ratchet because Phases 7–10 may legitimately move a surface before they fix it, and this page's rule is
  that a gate pointed at a backlog gets bypassed.

**Exit:** the table above. **Harness: 93 tests, three themes, exit 0.** No stylesheet, component or test
under `test/` was touched: `npm run lint` clean over **541** files, `npm test` **240 files / 4,271 tests**,
`npm run check` green with the class budget at **380/380**, the geometry ratchet at **8/8**, 136 authored
`font-size` and 59 authored `border-radius` declarations — every Part One number unmoved.
**Revert:** `visual/checks/surfaces.spec.ts`, `visual/support/surfaces.ts`, the `AuditOptions` root
threaded through `audit.ts`, `SurfaceBaseline` in `fixtures.ts`, `furnish` in `run.mjs`, the `surfaces`
key in three baseline files, and five lines of `board.spec.ts`.

## Phase 7 — gate every primitive, not only buttons — **DONE 2026-08-21**

`tools/check-shape-coverage.mjs`, wired into `npm run check`: four censuses in the style of
`check-radius-scale.mjs`, each printing its full list on a passing run and blocking an increase.
**This is the phase that makes the other three honest**, because a number nobody prints is a number nobody
reduces. It writes no component, migrates nothing, and **the built CSS bundle is byte-identical** —
`index-Dopb3WPf.css`, sha256 `93b78775…`, before and after.

### The four rules, each in one sentence, and where they disagree with the estimate

| census | the rule | count | the estimate | why they differ |
|---|---|---|---|---|
| chip | a rule outside `primitives.css` declaring a `--t-micro`/`--t-small` `font-size`, a `--r-pill`/`--r-sm` `border-radius` and a `padding` — `.vb-chip`'s own declaration set — **or** a surface class on a `<Chip>` that decides a corner, a padding or a size | **10** | 9 | four of the nine declare NO box, and five boxes the list does not name |
| panel | a rule declaring a `border`/`border-width` of `1px`, a `border-radius` and a `background` together | **32** | 32 | — |
| mono | a rule declaring `font-family: var(--font-mono)` outside `primitives.css` | **14** | 14 | — |
| control | a literal `<input>`/`<textarea>`/`<select>` whose nearest enclosing `<Field>` region does not contain it | **35** of 42 | ~33 | the tree holds 42 controls and 7 are already in a `Field`; the estimate was a line count off a grep |

**The chip disagreement is the interesting one and neither number is wrong.** Five of the owner's nine are
the same rule — `.tag`, `.tag-chip`, `.mp-chip`, `.board-archive`, `.tile-setup`. **Four of his nine declare
no box at all**: `.tile-suggestions` and `.tile-problem` are a size, an ink and a `white-space: nowrap`, and
`.tag-btn` and `.tag-chip-count` are a cursor and an opacity on a box declared elsewhere — so they are chips
by MEANING, and no shape rule separates a state word from any other coloured word without becoming a list of
names. Phase 8's own gate is where their three tones are asserted. **Five more draw a chip's box and are not
on his list**: `.mp-def-tag`, `.control-tag`, `.tab-badge`, `.signin-this` and `.markdown code` — the last
being inline code in rendered prose, the one member that may legitimately never be a `Chip`, counted rather
than exempted because over-reporting is loud and harmless while an exemption list is a licence.

**Two of the four numbers reproduce the owner's exactly**, which is what says the two methods are measuring
the same thing where they overlap.

### Migration-blindness was designed against, and then planted at

**The Phase 3 defect was that the census's POPULATION shrank as the migration succeeded** — the geometry
ratchet read literal `<button>`, so 27 classes moving onto `<Button>` took it from 50 to 23 and a planted
`padding` exited 0. Each census here answers it in the way its own subject allows:

- **chip, panel and mono read the CSS**, where a shape can only be hand-rolled in one place. Each finding
  also names a call site read out of `className` text with **no opinion about the tag**, so a hand-rolled
  class that lands on `<Chip>`, `<Panel>` or `<ReadoutLine>` is still counted and still located. Proven on
  all three by planting at an ALREADY-MIGRATED site: a `padding` on `.report-chip` (which lives on
  `<Chip className>`), the border/corner/ground trio on `.archive-drawer` (`<Panel className>`) and a mono
  face on `.copilot-readout` (`<ReadoutLine className>`) each exited **1**, naming the primitive's own call
  site.
- **the chip census has a second arm for exactly that hole** — a surface class on a `<Chip>` may not decide
  the box — and it is **at zero today**, which is the half that goes up the moment a chip is migrated
  carelessly. It is deliberately NOT extended to `<Panel className>`: Phase 4 measured that counting every
  `Panel` reports `.archive-drawer`, `.exec-column` and `.halt` — three correct designs — as faults.
- **control reads the JSX and prints its POPULATION beside its findings**, so migration moves a control from
  one to the other and leaves the population where it was. Proven by wrapping `DiagnosticsPanel`'s checkbox
  in a `<Field>`: findings **35 → 34**, in-Field **7 → 8**, population **42 unchanged**. The "in a Field"
  test is per-ELEMENT and never per-file, which is the same defect one level along: a planted raw `<input>`
  in `SettingsModal.tsx` — a file with nine migrated Fields already — was still counted, exit **1**.

### No count floors, and three self-tests instead

**A floor on a number the sweep exists to reduce fails the run for succeeding**, which has now happened
twice here. So `cssSelfTest`, `controlSelfTest` and `siteSelfTest` assert the patterns against fixtures the
tree cannot move, and all three go through the census's own functions. Each fires on a broken pattern AND on
a wrong expectation, proven eleven ways, each restored: the chip radius list, the panel `1px` test, the mono
regex, the `<Chip` tag name, `rulesOf`'s brace matcher, `CONTROL_TAGS`, the `<Field` region reader, the
`className` reader — and a deliberately wrong number in each of the three fixtures' expectations.

**Two findings about the checks themselves came out of writing those self-tests, and both are causes removed
rather than notes added:**

- **`rulesOf` did not reset its selector cursor at a `{`**, so a rule nested in an `@media` read as
  `@media (min-width: 1px) { .theta` — and because the at-rule's own body contains every declaration inside
  it, the shape was ALSO counted a second time under the prelude. `check-radius-scale.mjs` records that
  double-count as a latent over-report it can live with; a census whose entire output is a count cannot, so
  this file counts a shape inside an at-rule exactly once and under its own selector.
- **A self-test that asserts its own argument is the old defect in a new place.** The `<Chip` tag was written
  literally at both the run's call site and the self-test's, so breaking the run's copy took the second arm
  blind and the run exited **0** — the same failure as a self-test carrying its own regex. It is one
  constant now, and re-planting it exits **1**.

**And a third finding about the locator, which is the "verify what a search matched" rule.** The first
version looked for the class as a bare token anywhere in the corpus and reported `.markdown code` as used at
`cards/CardView.tsx:1` — the `markdown` MODULE in an import. Scoped to `className` values it reads
`CardView.tsx:95`, it understands the ternary `.popover` is written with, and it refuses a `title="two
words"` in the same tag. Three rules print **no literal className** and every one is correct:
`.inline-view` and `.inline-edit` reach their element through a variable, and `.msg-assistant` is composed at
run time.

**Gate:** each census blocks an increase, prints its full list on a passing run, and self-tests its parser
against a fixture rather than against a count floor. Proven by four planted increases, each exiting **1**
from `npm run check` and each restored: a pill box on `.tile-suggestions` (chip 11/10), a `background` on
`.control-tag` (panel 33/32), a mono face on `.exec-skill` (mono 15/14) and a raw `<input>` in
`SettingsModal.tsx` (control 36/35).

**Exit:** four censuses at **10 / 32 / 14 / 35**, all wired into `npm run check`. Six of the seven rows in
the table above now have a gate; `Dot` and `SegmentedControl` do not, for the reason recorded there.
**Every Part One and Phase 6 number is unmoved**: class budget **380/380**, geometry ratchet **8/8**, **136**
authored `font-size`, **59** authored `border-radius`, harness **93 tests** on three themes, suite **240
files / 4,271 tests**, `npm run lint` clean over **542** files.
**Revert:** `tools/check-shape-coverage.mjs`, two `package.json` entries and this section. No stylesheet, no
component and no test under `test/` is touched by it.

## Phase 8 — the chip family — **DONE 2026-08-21**

**The chip census is ZERO, from ten, and its ceiling is zero in the same commit** — the first of Phase 7's
four numbers to move, which is what that instrument was built for. Nine classes are `Chip`s; the tenth,
`.markdown code`, is exempt **by name with its reason on the exemption**, the form
`check-radius-scale.mjs`'s `OFF_SCALE_ON_PURPOSE` established. The phase also took `Dot`'s last hand-rolled
instance and gave the two ungated rows of the coverage table a gate each, so **every one of the seven rows
now has one.**

### 8a — the ten, and what each one still says

`Chip` gained **`as`**, a closed `span | button`, and that is the whole of why this took three phases to
become possible. Phases 3, 4 and 5 each listed `.tag`, `.tag-chip`, `.mp-chip` and `.board-archive` as
survivors with the *same* reason — *"a Chip that happens to be clickable: `Chip` owns that box, not
`Button`; making it a button gives it a button's radius and padding"* — and then left them, because the
primitive rendered a `<span>` and nothing else. **The box is the same box whether or not it takes a click**,
which is the argument `Panel`'s `as="button"` already rests on.

| class | → | call sites |
|---|---|---|
| `.board-archive` | `Chip as="button" pill fill` + `vb-readout` | 1 |
| `.tag` | `Chip pill neutral` — and `as="button"` where the tile can filter | 4 — two in `CardView`, and `CardTile`'s clickable and plain forms |
| `.tag-chip` | `Chip as="button" pill fill` + `vb-readout` | 1 |
| `.mp-chip` | `Chip as="button" pill fill neutral` | 1 (three renders) |
| `.mp-def-tag` | `Chip pill accent` | 1 |
| `.control-tag` | `Chip` — no `pill`, which is the primitive's own `--r-sm` corner | **3** — see below |
| `.tab-badge` | `Chip pill` + `vb-readout` | 1 |
| `.tile-setup` | `Chip accent` | 1 |
| `.signin-this` | `Chip pill neutral` | 1 |
| `.markdown code` | **EXEMPT BY NAME** — inline code in rendered prose | — |

**Nine of the ten classes survive and one died, which is the same result Phase 3 measured on its 27 and
Phase 4 on its nine rows:** what is left after the geometry comes out is a declaration only the surface can
make. `.board-archive { flex: 0 0 auto }`, `.tag { background: var(--panel) }` — a shade off the
`--panel-2` a tile is drawn on, where `fill`'s `--panel-2` would make the tag vanish into the card —
`.mp-def-tag`'s solid accent edge, `.control-tag`'s `--accent-2` ink, `.tab-badge`'s `--accent-2` ground,
`.signin-this`'s lowercase. **None of the reasons is "it has its own padding"**, and not one of the fourteen
classes now reachable by the census's second arm decides a corner, a padding or a size.

**THE CENSUS NAMES ONE CALL SITE PER CLASS AND `.control-tag` HAS THREE, and reading the census instead of
the source cost two of them.** `siteOf` returns *the first `file:line` whose `className` names it* — it is
there so a reader can go and look, and it says so — but taken as the list of what to migrate it left
`explorer/FileTree.tsx:122` and `:123` rendering `<span className="control-tag">` after the rule had given
its box to the primitive: two badges on the Explorer with no border at all. **Neither gate could see it.**
The chip census was already at zero, because the fault is a call site and not a rule; and the harness cannot
reach it, because the fixture has no symlinked and no escaping file, so those two spans never render. It is
Phase 3's own lesson one class along — *"two more went that the ratchet could not see, and finding them is
the argument for reading the source as well as the census"* — and it was found by counting `className`
occurrences per migrated class rather than by trusting the census's one site each.

**`.tag-chip-count` is the one that died, and it was a dead declaration as well.** Its whole content was
`opacity: 0.7` plus `font-size: var(--t-micro)` — which is what it already inherited from the chip around
it, the same defect Phase 4 found on `.cv-link` and Phase 5b on `.archive-title`. The opacity became
`.tag-chip > span`, the descendant-rule mechanism 5a named as what made most of its sweep possible.

**One rendering change was made on purpose and it is the only one of its kind: `.mp-chip` moved from
`--t-small` to `--t-micro`.** Nine of the ten chip classes were already at micro, which is the scale's own
name for *"chips, state words, dot labels, tags"*, and `Chip` has no size axis — adding one for a single
consumer is a name that decides nothing, the argument that kept `ghost` at two and refused `--t-display` a
second consumer. The model picker's own `--t-small` set was already recorded on that surface, so the
harness's drift did not move; the tally did, and it is read below.

**Two dead declarations went with them, neither of them the point of the phase:** `.tile-suggestions`'s
`var(--warn, #b8860b)` fallback, unreachable since every theme defined `--warn`, and the `font-size` above.

### 8b — the four chips no census can see, which is the half that mattered

`.tile-suggestions`, `.tile-problem`, `.tag-btn` and `.tag-chip-count` are chips by **meaning** and declared
no box: a size, an ink and a `white-space`; a cursor and two `inherit`s; an opacity. **Every census in this
repository reads a drawn box, so no shape rule will ever find one of these** — which is exactly how the
family stayed invisible through six phases in which every gate was green.

`.tag-btn`'s two `inherit`s were the load-bearing half and they were right for one of the four clickable
chips: **a `<button>` takes the UA's own control face**, so a tag rendered as a button renders in a
different typeface from an identical one rendered as a span unless something says `inherit`.
`button.vb-chip` says it for all four.

**THE THREE TONES ARE PRESERVED AND ASSERTED, and the assertion is this phase's own gate.**
`.tile-setup` → `accent`, `.tile-suggestions` → `warn`, `.tile-problem` → `bad`, and the three comments that
carry the *meaning* rather than the styling stay in `styles.css` where they were:

- `.tile-setup` — *"the accent rather than ochre: this is not a warning, it is the card the whole board is
  waiting on, and it should read as structure rather than as a problem."*
- `.tile-suggestions` — *"Ochre, not the accent: a card carrying this is not failing, but it is not plainly
  done either."*
- `.tile-problem` — *"Danger rather than ochre, and the strongest of the three: a story in Done carrying one
  has finished with a real failure inside it, which is a different fact from work deliberately left
  behind."*

**Measured per theme, not inferred from the token names**, and that distinction is the whole reason the
assertion is worth writing: `--warn` and `--danger` are the *same value* in cyberpunk and classic-dark and
different in marshmallow, which `themes.css` argues by name. "They name different tokens" is therefore not
the claim. `test/chip-boxes.test.tsx` resolves each theme's palette out of `themes.css` and asserts the
three inks are three, and the three **border colours** are three — a second axis a collapse could flatten on
its own:

| theme | `.tile-setup` | `.tile-suggestions` | `.tile-problem` |
|---|---|---|---|
| cyberpunk | `#14b8a6` | `#f59e0b` | `#ff5c6c` |
| marshmallow | `#2f7a50` | `#9a5b12` | `#c0392f` |
| classic-dark | `#5b9dff` | `#e6b450` | `#e06c75` |

**It is rendered through `CardTile` and not through a class list, deliberately.** The tone is a PROP now, so
a refactor that dropped `tone="warn"` would leave `.tile-suggestions` in place and every class-list fixture
green while the board rendered two identical grey words. The board's own component is the only fixture that
can fail on that — and it does: dropping the tone at the call site turns **7 of the 27 tests red**, and the
anti-vacuity half is asserted first, because an unresolved `var(--x)` compares unequal to another
unresolved one and a broken resolver would report three "distinct" colours and pass.

**And because a shape census cannot see these, Phase 8 leaves behind a check that can:
`BOXLESS_CHIPS` in `tools/check-shape-coverage.mjs`, a NAMED LIST with a ceiling of zero.** Phase 7 wrote
that no shape rule could separate a state word from any other coloured word *"without becoming a list of
names"*. This is that list of names, and naming them is the only instrument available — the alternative is
that the next person renders a coloured `<span>` where a chip belongs and nothing whatever notices, which is
what happened.

Two claims per name: the class is **gone, or every `<Chip>` in the tree carries it**; and the `<Chip>`
carrying it **names a `tone`**. What it catches: those four regressing, in either of those two ways. **What
it does not catch, stated rather than implied:** a FIFTH box-less chip under a name nobody adds to the list
— that limit is structural, and it is why the tones are also asserted in the suite; a class reaching a
`<Chip>` through a variable or a ternary that names no literal; and whether the tone chosen is the RIGHT
one, which is a judgement and not a measurement.

### 8c — `Dot`'s last survivor, and two censuses to finish the row

**`.copilot-status .status-dot` is a `Dot`**, and it was the last `border-radius: 50%` outside the primitive
stylesheet — named in `check-radius-scale.mjs`'s `OFF_SCALE_ON_PURPOSE` as the Dot's one remaining
hand-rolled instance since Phase 3. The wrapper tints it (`.copilot-status.ok .vb-dot`), which is the
construction `.conn-status[data-state]` already uses and for its reason: only the wrapper knows the state,
and it colours the pip and the word beside it together. The glow stays the surface's, because `Dot`'s five
tones deliberately carry none. **The class died outright.**

**A `Dot` census and a `SegmentedControl` census were added, both at ZERO, and that reverses Phase 7's
judgement on the evidence.** Phase 7 left both ungated because *"a census for zero is a gate blocking at
zero with nothing to ratchet"*. The argument against that is the whole reason the file exists: the shape
nobody counts is the shape that gets hand-rolled back in, and a coverage table with a hole in it is what let
nine chip classes accumulate unseen.

- **dot** — a rule outside `primitives.css` declaring `border-radius: 50%`. Nothing else needs saying: a
  circle is the one shape in this stylesheet that legitimately declares a raw value, which is why `50%` is
  in `OFF_SCALE_ON_PURPOSE` at all. Requiring a `width` too would miss a dot that inherited one.
- **seg** — a flex box that draws ONE 1px border and ONE corner and CLIPS its contents **and has no ground
  of its own**. That last clause is the discriminator and it is measured rather than tidy: without it
  `.mp-modal` — a flex column with a border, a `--r-lg` corner and `overflow: hidden` — is reported as a
  segmented control, which is a false finding on a modal. `.vb-seg` declares no background, and that is
  what lets its cells' fill reach the group's edge. `.nu` in the fixture is the modal case, both directions.

### The characterisation suite, written first, and the real defect it found

`test/chip-boxes.test.tsx` — **27 tests, run green against the code as it was, before any migration.** It
asserts the box a class list draws, resolved out of the stylesheets by `test/css-box.tsx`.

**It found a cascade trap, in the code this phase had just written, on the one claim a reviewer would never
have checked by eye.** `button.vb-chip { font-family: inherit }` — the obvious place for a button reset — is
**(0,1,1)**, and it outranks every single-class rule at (0,1,0). So it beat `.vb-readout`'s
`font-family: var(--font-mono)`, and `.board-archive` and `.tag-chip` **silently lost the monospaced face**:
a tag filter and a board's archive toggle rendered in proportional type while every gate stayed green. The
suite had pinned the mono claim before the migration and reported *"expected 'inherit' to be
'var(--font-mono)'"*. The same trap would have taken `.vb-chip-fill`'s ground off three of the four
clickable chips. **The cause is removed rather than worked around:** the whole UA reset —
`background: none`, `color: inherit`, `font-family: inherit`, `line-height: inherit` — is on the `.vb-chip`
BASE at (0,1,0), where the later rule wins, and only `cursor: pointer` stays on the tag qualifier, because
a span must not offer a pointer. On a `<span>` every one of those declarations renders what a span already
rendered.

**THE ASSERTIONS SURVIVED THE MIGRATION AND THE FIXTURES DID NOT**, which is what Phase 4 recorded of
`test/panel-boxes.test.tsx` and is honest to repeat rather than dress up: run against the old code every
fixture was a hand-written class list on the element the surface rendered, and 21 of the 25 went red once
the box moved to the primitive, for the right reason — the element genuinely carries five more classes.
They are `Chip` renders now, so the class list is never hand-written again and the PROPS are the props the
call site passes. **The one fixture that stays hand-written is `.markdown code`**, because it is the one
thing here that must not go through the primitive.

### Gates

| gate | before | after | planted defect, and what it said |
|---|---|---|---|
| chip census | 10/10 | **0/0, BLOCKING AT ZERO** | a new `.planted-chip` box → exit **1**, *"chip-shaped: 1 … This shape is FULLY MIGRATED and this census BLOCKS AT ZERO"* |
| chip census, arm 2 | 0 | 0 | a `padding` on `.tag`, which is on a `<Chip>` → exit **1**, *".tag — geometry on a `<Chip>` — padding (used at board/CardTile.tsx:129)"* |
| box-less list | — | **0/0, new** | `.tile-problem` returned to a `<span>` → exit **1**, *"named at board/CardTile.tsx:89 and not on a `<Chip>`"*; and kept as a `<Chip>` with `tone` dropped → exit **1**, *"on a `<Chip>` with no tone at board/CardTile.tsx:88"* |
| dot census | — | **0/0, new** | a `.planted-pip` with `border-radius: 50%` → exit **1** |
| seg census | — | **0/0, new** | a `.planted-group`, flex + 1px + corner + clipped → exit **1** |
| the three tones | — | 7 tests | `tone="bad"` dropped at the call site → **7 of 27 red**, on all three themes plus the ink and the edge |
| `check:radius-scale` claim 2 | 8/8 | **4/8** | ceiling LEFT at 8 — see below |
| panel census | 32/32 | **28/32** | ceiling LEFT at 32 |
| mono census | 14/14 | **11/14** | ceiling LEFT at 14 |
| `npm run visual` | 93, exit 0 | 93, exit 0 | `5px` on `.vb-chip` → radius conformance **0 → 4 findings on boards** naming `span[tile-suggestions]` four times, **0 → 32 on Project Control** (the `.control-tag` chips), and drift *"NEW 5px, GONE 4px"* |

**The four censuses whose numbers this phase moved WITHOUT owning them keep their ceilings, and that is a
rule rather than an oversight.** Panel fell 32 → 28 and mono 14 → 11 because four of the chips drew a 1px
border, a corner and a ground (which is a chip's box and, by that census's rule, a small panel's) and three
borrowed the mono face by hand. The button-geometry ratchet fell 8 → 4 because four chip classes stopped
being literal on a `<button>`. **None of those four is Phase 8's number**, and lowering a ceiling for a
count a different phase has to work in takes the slack away from that phase. **Every one of them is a
number the owner may want lowered now, and it is recorded here rather than done quietly.** The coverage the
button ratchet gave up is not lost: it moved to the chip census's second arm, which is stricter — it refuses
a corner, a padding *or* a size on any class on a `<Chip>`, at a ceiling of zero.

**Six of the ten surfaces did NOT move, and one did.** Only the boards baseline changed, by exactly one
value: **`radius NEW 4px`**, on all three themes, read before `npm run visual:record` was run. It is
`.tile-suggestions` gaining a `--r-sm` corner — one element, four corners, `4px×4` — which is what a chip
having a box means. The board's type tally is byte-identical (`13px×133 12px×66 11px×36 15px×1` at 236
elements), the radius tally is `6px×240 999px×84 10px×56 50%×12` plus the new `4px×4`, and every other
recorded number is unmoved: overflow **0 of 125**, clipping **1 of 35** (the exempt board area), contrast
**0 of 129**, tokens **1 of 41** (`--exec-cols`, Phase 10's), rows **0 of 25**, focus **0 of 56**, readouts
**28** with digits at 79.140625/79.140625px, primitive rings **29 of 29**.

**The other nine surfaces were NOT re-recorded and did not need to be**, which was read rather than assumed:
execution, diary, control, explorer, card, archive, settings, model-picker and confirm all report
**0 findings on type and radius conformance** at their recorded examined counts (146 / 148 / 168 / 127 / 57
/ 9 / 125 / 57 / 8 elements), unchanged. Three of them render migrated chips — Project Control the
`.control-tag`s, the model picker the `.mp-chip`s and `.mp-def-tag`, the card pane the `.tag`s — and the
reason their baselines did not move is structural and worth stating: **a surface records the value SET, not
the tally**, so `.mp-chip`'s 12px → 11px is invisible there because both steps were already in the model
picker's set. That is a documented property of the per-surface baseline (Phase 6, *Drift: per-surface, on
the value SET*) and not a hole this phase opened; the tally that moved is stated above.

**Selector migrations: 108 → 102**, measured with the command recorded at the end of Phase 3. Six went:
`.board-archive` ×2 (`test/boards-view.test.tsx`) and `.tab-badge` ×2 (`test/topbar.test.tsx`) to
`data-testid`, and `.cv-tags .tag` ×2 (`test/card-view.test.tsx`) to a `testId` the primitive takes as a
named prop. A seventh assertion moved without being a `querySelector`: `test/tag-filter.test.tsx` asserted
the **exact** `className` bytes — the right assertion while the chip was a hand-rolled
`<button class="tag-chip">`, since `not.toContain('active')` is satisfied by any wrong className at all —
and a `Chip` composes five classes of its own, so pinning the bytes would pin the primitive's class list in
a test about a highlight. It is `classList.contains('active')`, which is exactly as strong for a boolean
marker.

**Exit:** **chip census 0**, ceiling 0, one exemption by name. **Dot 0 and SegmentedControl 0, both newly
gated; the box-less list 0.** Panel **28/32**, mono **11/14**, control **35/35**, button geometry **4/8**.
Class selectors **380 → 378** (`styles.css` 333 → 331, `primitives.css` 60 unchanged — `.tag-chip-count`
and `.status-dot` died and `button.vb-chip` is a tag qualifier, not a new name); the ratchet stays at 380.
Authored `font-size` **136 → 124**, authored `border-radius` **59 → 49**, both still entirely on the scale.
Suite **241 files, 4,298 tests**. Harness **93 tests, three themes, exit 0**. `npm run lint` clean over
**543** files.
**Revert:** `Chip`'s `as`/`onClick`/`ariaPressed`/`ariaExpanded`, the Chip block of `primitives.css`, the
ten surfaces that call it (`Board`, `CardTile`, `CardView`, `TagFilter`, `ModelPicker`, `ControlFileList`,
`FileTree`, `TopBar`, `SignInPanel`, `CopilotPanel`), `styles.css`, `test/chip-boxes.test.tsx`, six test selectors, the
`4px` in three baseline files, and the chip ceiling, `CHIP_EXEMPT`, `dotFault`, `segFault` and
`BOXLESS_CHIPS` in `tools/check-shape-coverage.mjs`.

## Phase 9 — `Field`, and the thirty-three controls — **DONE 2026-08-21**

**The control census is 2, from 35, and both twos are `ui/InlineField.tsx` — the one component this
document rules out of `Field`'s scope by name.** `Field` was *"last and least urgent"* and it was the least
adopted primitive: 9 call sites against 42 literal controls, 7 of them in a `Field`. It is 42 against 42
now: **15 controls migrated onto `<Field>`** and **18 put on `.vb-input`**, which is the box
`ui/primitives.css` already names for a control with no label to give.

### The census's rule changed, and that is stated first because it moves the number

**Arm 1 was *"a literal control whose nearest enclosing `<Field>` region does not contain it"*, and it asked
a narrower question than the one the file exists to ask.** The question is *how much of this shape is still
hand-rolled?*, and `primitives.css` answers it in two ways on purpose — the sentence is beside `.vb-input`
and it names its own three cases: *"`.vb-input` is the same box for a control that is not inside a Field — an
inline rename, a model search, a typed confirmation."* A control wearing `.vb-input` has the primitive's box;
counting it as hand-rolled is the same category error as counting `.vb-trigger`, which
`check-shape-coverage.mjs`'s own header already excludes by name. So arm 1 is now *"gets its box from
NEITHER a `<Field>` NOR `.vb-input`"*.

**Under the OLD rule this phase's number is 20, and that figure is recorded here rather than only the
better one.** Eighteen of the 20 are labelled below with the reason each is not a field; two are
`InlineField`'s.

**ARM 2 IS WHAT KEEPS THE WIDENING FROM BEING A LOOPHOLE, and it is strictly stronger than what it
replaces:** *a surface class that lands on a literal `<input>`, `<textarea>` or `<select>` may not decide the
box* — a border, a corner, a padding or a size. Without it, `<input className="vb-input my-own-box">` would
pass arm 1 while the geometry moved out of sight, which is precisely the hole Phase 3 drove a bus through
when 27 classes went onto `<Button>`. It is the chip census's second arm one primitive along. **It reads 0
and it BLOCKS at 0**, and `font-family` and `color` are deliberately not in its property list: a monospaced
editor body and a muted secondary select are the surface's to decide.

**Arm 2 cannot see `.inline-edit`, and the limit is recorded rather than padded.** The first draft set its
ceiling to 2 for `.inline-edit`'s border/corner/padding and `.cv-title.inline-edit`'s size — and neither is
reachable: `InlineField` builds one `common` object and spreads it, so `className: 'inline-edit'` never
appears in a `className=` attribute. That is this file's already-stated blind spot — *"a class reaching a
`<Chip>` through a variable or a ternary that names no literal"* — one primitive along. Those two controls
are counted by arm 1 regardless, which is why the pair is covered rather than lost.

### The fifteen that became `Field`s

| control | layout | at |
|---|---|---|
| the project gate's parent folder | `stack` | `app/ProjectGate.tsx:98` |
| the project gate's project name | `stack` | `app/ProjectGate.tsx:105` |
| the four auto-pilot caps | `stack` + `hint` | `autopilot/AutopilotPanel.tsx:122` |
| the run timeout | `stack` + `hint` | `autopilot/AutopilotPanel.tsx:132` |
| a card to link | `check` | `cards/LinkPicker.tsx:26` |
| the typed confirmation | `stack` | `confirm/useConfirm.tsx:114` |
| the dispatch effort | `rail` | `runs/DispatchPane.tsx:110` |
| the dispatch prompt | `stack` + `caps` | `runs/DispatchPane.tsx:139` |
| an attachment to send | `check` | `runs/DispatchPane.tsx:156` |
| the verbose-log switch | `check` | `settings/DiagnosticsPanel.tsx:51` |
| a skill's name | `rail` | `skills/SkillEditor.tsx:64` |
| a skill's description | `rail` | `skills/SkillEditor.tsx:67` |
| a skill's boards | `check` | `skills/SkillEditor.tsx:79` |
| a skill's columns | `check` | `skills/SkillEditor.tsx:89` |
| a skill's prompt | `stack` + `caps` | `skills/SkillEditor.tsx:106` |

**Three more rows moved that hold no literal control**, and leaving them would have left one form written
two ways: `DispatchPane`'s Connector, Model and Mode rows each wrote `<span class="vb-label vb-label-caps
vb-label-rail">` by hand beside a custom picker. They are `Field as="div" layout="rail"` — the variant that
exists for exactly this, *"the two whose control is a custom picker rather than a form element, where a
wrapping label has nothing to focus"*.

### `Field` gained one axis and one layout class, both measured

**`caps` is a FACE and it is not a layout, which is Phase 5b's own ruling applied to its second case.**
That phase separated `.vb-label-rail` (a width) from `.vb-label-caps` (a face) after finding the caps class
named at eight call sites and defined by no rule. Two labels want the face with no rail — `SkillEditor`'s
prompt and `DispatchPane`'s — because their control is too tall to sit beside its label, and both wrote
`vb-label vb-label-caps` by hand in a form whose other labels are railed. The skill editor's also named
`vb-label-rail`, whose 6rem was doing nothing on a full-width label. **Two consumers, which is the bar
`ghost` is held to.**

**`.vb-field-check` overrides `.vb-label` because A DECISION'S LABEL IS CONTENT, NOT A FIELD NAME, and the
count is the argument.** Five checkbox rows in the tree labelled themselves at the surrounding size and ink
— `.link-option` at four sites and Diagnostics' bare span — against **one** at `.vb-label`'s muted 12px,
which is Settings' `Enforce 1-to-many relations on boards`. A card title or a file path shrunk to 12px muted
reads as furniture, and it is the thing being chosen. **One rendering change at one site, and it lets eight
controls in.** The class also carries the pointer `.link-option` had, and makes the label a flex row with
`.link-option`'s own `var(--s-4)` gap — because a decision's label is often two parts, an id and a title,
which `.link-option` laid out itself while both were its own children. Written AFTER the three label rules,
because `.vb-field-check > .vb-label` is (0,2,0) over a (0,1,0): the repair Phase 2 made by moving two rules
later.

### The eighteen survivors, each with the quality it keeps

**None of the reasons is "it has its own padding", and none of the eighteen keeps one:** every one takes the
primitive's box, and eight hand-rolled box rules died to give it to them.

| survivor | why a `Field` would have to lie |
|---|---|
| the top bar theme select | **A toolbar control.** The bar carries no labels at all, and the value it shows is its own name. |
| the archive restore-elsewhere select | **One of two actions in a row of actions**, named by its own first option, "Elsewhere…". |
| a report's close-into column, and its move-to column | **An action row.** "Ignore and close" names the BUTTON and the select is one of its two operands; the other's first option is "Choose a column…". A Field's label names one control. |
| the copilot effort select | **A dock toolbar.** The row has no labels at all, and one label on one of its two controls reads worse than none. |
| the copilot composer, the diary composer | **A composer.** Its label is its placeholder and the Send button beside it. |
| the raw card file, the control editor body | **It IS the pane.** The dock tab and the file path above it are the label. |
| two inline renames (`ControlFileList`, `FileTree`) | **It replaces the row it renames**, so the row is the label — the case `primitives.css` names. |
| the model search | **The case `primitives.css` names**, verbatim. |
| the model picker's provider filter | **A filter in a row of filters**, named by its own first option, "All providers". |
| three links-registry cells | **A table row.** Each placeholder is the column heading, and a label per cell would repeat "Title / URL / Note" once per link. |
| the suggestions "why not?" box and level select | **An action row** of five controls with no labels between them. |
| `InlineField`'s textarea and input | **Ruled out of `Field` by name** — commit-on-blur is behaviour, and Phase 5 proved it live before leaving it alone. Re-proven here: planting `onBlur: () => setDraft(null)` turns **4 of 17** red, exit **1**; restored, exit 0. |

### The characterisation suite, and the five things it found

`test/control-boxes.test.tsx` — written and **run green against the code as it was**, pinning fifteen
different boxes before anything moved. Its assertions are the same claims with the values the merge moved
them to, and `git show` on the file is the before-and-after. Five findings, none of them the rewrite:

- **TWO CONTROLS DREW NO BOX AT ALL.** `.raw-area` — a whole card's file, in the dock — declared a
  monospaced face and nothing else, and the suggestions pane's level `<select>` declared nothing whatever.
  Both rendered the browser's own control chrome beside a `.vb-input` in the same pane. That is Phase 5's
  `.skill-input`/`.dispatch-prompt` finding one level along: not a box that disagrees, a box never drawn.
- **SIX DECLARED NO `:focus` RULE** — `.theme-select` (four call sites), `.archive-column`, `.mp-prov`,
  `.copilot-selects select`, `.diary-compose textarea` and `.raw-area` — so they fell through to the app's
  global ring where the eight boxes Phase 5 took turn their border accent. Nothing chose between the two.
- **A HAND-ROLLED `.vb-field` LABEL HAD NO CLASS AND THEREFORE NO TREATMENT.** `<label class="vb-field">
  <span>Location (parent folder)</span>` in the project gate, and the same shape on all five auto-pilot
  caps: seven labels rendering at the value's own size and ink, so the name of the field and the number in
  it looked identical. It is the **mirror** of Phase 5b's `.vb-label-caps` — that was a name with no rule,
  this is a rule with seven call sites that never asked for it, and `check-class-budget.mjs` reads CSS →
  code so neither direction is gated.
- **`.link-option`'s `font-size: var(--t-body)` WAS DEAD** — `body` already gave it. The fourth such
  declaration this sweep has found, after `.cv-link`, `.archive-title` and `.tag-chip-count`.
- **THE SUGGESTIONS COMPOSER'S `--panel-2` GROUND NAMED A GROUND ITS PANE DOES NOT HAVE, so the exception
  does not survive.** Its recorded reason was *"this one sits in a `--wash` pane where `--bg` would read as
  a hole"* — and `.suggestions-pane` declares no ground, so it takes the dock's `--panel`, which is exactly
  what `.modal` and `.gate-card` are, and both of those put their boxes on `--bg`. **The reason was true of
  `.diary-compose`**, whose pane really does declare `background: var(--wash)` — and `--wash` is `none` in
  classic-dark, so `--bg` on `--bg` there would render as no box at all. The argument is written on the box
  it belongs to and the suggestions composer joins the other nine.

**Behaviour was pinned too, at every one of the fifteen sites, because a control has behaviour as well as a
box and that is what a migration drops in silence.** Seven existing suites gained a case each — the number
box's `type`/`min`/`step`, the twelve- and four-row textareas, three placeholders, `autoFocus`, and *the row
is a `<label>` so its words are a click target*, which is what an `as="div"` would have quietly cost. Both
premises that failed were the test's and not the code's: **`Max dispatches` steps by 10, not 1**, and the
control fixture's own `boxed` count is 5, not 4.

**And a repair to the shared resolver, forced by a planted premise.** `test/css-box.tsx` dropped every
`:not()` before matching — right for `:hover:not(:disabled)`, where the inner state would otherwise count as
a second one — and therefore also dropped
`.vb-field input:not([type='checkbox']):not([type='radio']):focus`. So it reported a checkbox in a `Field` as
taking `outline: none`, which is **exactly the defect Phase 6 fixed by writing those two exclusions**: the
instrument meant to assert the fix could not see it. A `:not()` whose content is a state is dropped now and
any other is kept, and the four box suites are green either way.

### `.mp-prov` against `.mp-chip`, resolved rather than recorded

**A CONTROL IS 13px AND A CHIP IS 11px, and the filter row holds both and now says so.** Phase 8 moved
`.mp-chip` to `--t-micro` deliberately — nine of the ten chip classes were already there and it is the
scale's own name for *"chips, state words, dot labels, tags"* — and left the `<select>` beside it at
`--t-small`, which nothing chose. The select takes the control box, so it is `--t-body`, the same box as the
search input above it in the same modal: **two controls at 13px and three chips at 11px, where it was one
control at 12px, one at 13px and three chips at 11px.** This is the ruling Phase 5b made putting the two
select triggers at `--t-body` beside the inputs they share a row with, and it is the same 12px-that-nobody-
chose being removed. `.mp-prov` died: its whole remainder was `margin-left: auto`, which is `.push`.

### What went from the stylesheet

Eight hand-rolled control boxes, and what each one kept:

| rule | kept |
|---|---|
| `.theme-select` (4 call sites) | **nothing — died.** Its `cursor: pointer` and accent hover are what `primitives.css` now says about every select |
| `.mp-prov` | **nothing — died.** `margin-left: auto` is `.push` |
| `.link-option` (4 call sites) | **nothing — died.** `Field layout="check"` is all of it, plus a dead `font-size` |
| `.resource-row input` | **nothing — it was `.vb-input` declaration for declaration**, focus rule included |
| `.archive-column` | a muted ink — a secondary restore must not read as loudly as the button beside it |
| `.copilot-selects select`, `.copilot-input textarea`, `.diary-compose textarea` | `flex`, `resize`, a `min-height`, and the diary's `--panel-2` — each now a descendant rule of the row that already had a name |
| `.control-textarea` | the pane's inset, `flex: 1`, and the mono face |
| `.raw-area` | the mono face; its `font-size` restated the primitive's and went |

**A SELECT IS A CONTROL YOU POINT AT, and five of the tree's seven said so by hand.** `.theme-select`
carried `cursor: pointer` and an accent hover at four call sites and `.archive-column` carried the cursor,
against `.mp-prov` and `.copilot-selects select` with neither. The hover makes the same statement `:focus`
makes on an input — *this is the control you are about to use* — which is the argument `.vb-trigger` already
rests on one line up in the same file.

### Gates

| gate | before | after | planted defect, and what it said |
|---|---|---|---|
| control census, arm 1 | 35/35 | **2/2** | a raw `<input>` in `SettingsModal.tsx`, a file with nine migrated Fields → exit **1**, *"3 hand-rolled … against a ceiling of 2"*, naming `SettingsModal.tsx:203`. **This is the Phase 3 defect answered:** the population stayed 42 |
| control census, arm 2 | — | **0/0, new, BLOCKING** | a `padding` on `.archive-column`, which lands on a `<select>` → exit **1**, *"geometry on a control — padding (used at board/ArchiveDrawer.tsx:91)"* |
| its self-test | — | 3 ways | `CONTROL_BOX_CLASS` broken (`boxed` 5 → 2), `CONTROL_GEOMETRY` emptied (geometry list empty), `controlsIn`'s class reader stubbed — each exit **1** with *"this check is vacuous"* |
| panel census | 28/28 | **20/20** | a `.planted-panel` with the border/corner/ground trio → exit **1**, 21 against 20 |
| class budget | 377/377 | **375/375** | a `.planted-name` referenced from `CardTile.tsx`, so claim 1 could not mask it → exit **1** |
| `check:type-scale` | 123 | **115** | `font-size: 0.81rem` on `.archive-column` → exit **1** |
| `check:radius-scale` claim 1 | 49 | **41** | `border-radius: 9px` on `.archive-column` → exit **1** |
| `npm run lint` | clean/543 | clean/**544** | a duplicate `cursor` on `.vb-field-check` → exit **1** |
| `npm test` | 241/4,298 | **242/4,402** | `caps` dropped from `Field`'s face → 1 red; `vb-field-check` dropped → 3 red; both exit **1** |
| `npm run build` | ok | ok | a type error in `src/core/layout.ts` → exit **2**; an unresolvable import used in `web/src/ui/Field.tsx` → exit **1** |
| `npm run visual`, check 6 | 0 findings | 0 findings | the `[type='checkbox']` exclusion removed from `.vb-field input:focus` → **`[settings] 6. focus: 0 → 2`** on all three themes, exit **1**. That is Phase 6's defect put back and caught |
| `InlineField` | 17 pass | 17 pass | `onBlur: () => setDraft(null)` → **4 of 17** red, exit **1** |

**`npm run build` does NOT typecheck `web/src`, which is worth stating because a reviewer will assume it
does.** `tsconfig.json` includes only `src`, and `vite build` transpiles without checking types — so
`caps?: number` on `Field`'s props built **clean, exit 0**. `npm run check`'s `typecheck:web` catches it,
exit **2**, naming `DispatchPane.tsx:130`, `SkillEditor.tsx:106` and `Field.tsx:48`. The build gate is live
for `src/` and for module resolution; types in the web tree belong to `npm run check`.

**Mono stays at 11 and the button ratchet at 4, both untouched.** `.control-textarea` and `.raw-area` keep
the mono face because the CONTENT is machine text, which is not `Readout`'s claim that a figure was
measured.

### Drift, read before anything was re-recorded — and nothing was

**No baseline file changed, so `visual:record` was not run.** 93 harness tests, three themes, exit 0. Every
per-surface number is byte-identical to Phase 6's table, including the counts that would move if a container
collapsed: settings **125** elements with focus **0 of 24**, model-picker **57** with **0 of 14**, confirm
**8** with **0 of 2**, card **57**, control **168**, explorer **127**, diary **148** with its two known
wrapped `.vb-readout-block` rows, execution **146**, archive **9**, boards **236**.

**The board's TALLY moved by two and the SET did not, which is why drift did not fire — and the two are
accounted for.** `13px×133 → ×135` and `12px×66 → ×64`, at 236 elements: the top bar's theme select and the
copilot's effort select, the only two of the fifteen the board view renders, both `--t-small` before and
`--t-body` now. Radius tally unchanged — `6px×240 999px×84 10px×56 50%×12 4px×4` — because every one of the
eight boxes already had a `--r-md` corner. **Nine surfaces record a value SET rather than a tally**, so the
six selects moving from 12px to 13px is invisible there; both steps were already in each set.

**Exit:** **control census 35 → 2**, ceiling 2, with a per-survivor reason for the eighteen and both twos
in one component. **A second control arm at 0, blocking.** Panel **28 → 20**, ceiling lowered. Mono
**11/11**, chip / dot / seg / box-less **0**, button geometry **4/4** — all unmoved. Class selectors
**377 → 375** (`styles.css` 330 → 327: `.theme-select`, `.mp-prov` and `.link-option` died;
`primitives.css` 60 → 61: `.vb-field-check`), ceiling lowered. Authored `font-size` **123 → 115**, authored
`border-radius` **49 → 41**, both entirely on the scale. Suite **242 files / 4,402 tests**. Harness **93
tests, three themes, exit 0**. `npm run lint` clean over **544** files.

**Phase 8's recorded "authored `font-size` 124" does not reproduce**: `node tools/check-type-scale.mjs` at
`4726fd6` prints **123**, and 123 is the figure this phase measured from. Recorded here rather than
silently carried, which is what this page did to the withdrawn 432 and 132.

**Selector migrations: 102 → 106**, measured with the command recorded at the end of Phase 3. One went out
— `test/suggestions-pane.test.tsx`'s `.suggestions-actions`, now a `data-testid`, because this phase touched
the controls in that row — and **five came in, all of them this phase's own characterisation suite and all
of them the subject**: `.vb-field` and `.vb-label` are the classes whose treatment is the claim, and a
`data-testid` would answer neither question. That is the Phase 4 precedent (`.board-columns`,
`.column-head, .vb-panel-head`) applied unchanged. Reporting 101 by leaving them out would be laundering it.

**Revert:** `Field`'s `caps` prop and its `vb-field-check` class, the Field block of `primitives.css` (the
check rules and the select cursor/hover), the **22** components that call `Field` or carry `.vb-input`,
`styles.css`, `test/control-boxes.test.tsx`, the `:not()` repair in `test/css-box.tsx`, the seven behaviour
cases, one test selector, and in `tools/`: `CONTROL_CEILING`, `CONTROL_GEOMETRY_CEILING`,
`CONTROL_BOX_CLASS`, `controlGeometryFault`, the `boxed`/`where` fields of `controlsIn`, the two control
fixtures, `PANEL_CEILING` and `CLASS_CEILING`. No baseline file is involved.

## Phase 10 — the leftovers — **DONE 2026-08-21**

Six items, each already measured before the phase began, and **every one of them has a test that fails
without the fix** — which is this phase's whole gate. The one that changes what a person can do is first.

### 1 — the board's primary control could not be operated without a mouse

`web/src/board/CardTile.tsx` was a `<div className="tile">` with an `onClick`, no `tabIndex` and no
`onKeyDown`. Fourteen tiles on the owner's board and three on the harness fixture could not be reached or
opened from the keyboard, and **none of them was in the focus gate's population at all** — which is why no
check had ever said so: check 6 is a ratchet on a COUNT, and an element that is not focusable takes its own
row out of the count rather than appearing as a finding. That is the same structural blindness check 8 was
written for in Phase 3.

**IT IS NOT A `<button>`, AND THAT IS A RULING RATHER THAN A SHORTCUT.** A tile is a card-sized region that
CONTAINS controls — a `Chip as="button"` per tag and a bare archive button — so the two obvious answers are
both wrong: `<button>` may not contain a button (invalid HTML, and Chromium re-parents it), and
`role="button"` makes its children **presentational**, which would hide those same controls from a screen
reader to gain keyboard access to their parent. So the tile is `role="group"` with an `aria-label` naming
the card, `tabIndex={0}` where there is something to open, and its own `onKeyDown` for Enter and Space —
a labelled region whose interactive children stay interactive.

**The `tabIndex` is conditional on `onOpen`**, because a tab stop that does nothing is worse than none: the
archive drawer renders read-only tiles.

**KEYBOARD ACTIVATION RESPECTS THE SAME BOUNDARY THE CHILDREN'S `stopPropagation` DRAWS, and it needs its
own guard to do it.** Enter on the archive button fires that button's click, which stops propagating — but
its **keydown still bubbles to the tile**, so a handler that acted on a bubbled key would archive the card
and open it in one keystroke. `e.target !== e.currentTarget` is the whole fix and it is asserted in both
directions: dropping it turns **2 of 21** tests in `test/card-tile.test.tsx` red.

| planted | result |
|---|---|
| `tabIndex` and `onKeyDown` removed | **2 of 21** red — *"expected `matches(FOCUSABLE)` to be true"* and *"expected spy to be called 1 times, but got 0"* |
| the `e.target !== e.currentTarget` guard removed | **2 of 21** red — the archive-button and the tag rows, the two that pass vacuously without a handler |
| `tabIndex` removed, in the BROWSER | `npm run visual` exit **1** on all three themes: *"3 of 3 card tiles cannot be reached from the keyboard, and are absent from the 56 elements this check protects"*, and the boards surface's own ratchet fired beside it — *"the focus walk examined 56, against 59 when this was recorded"* |

**Check 6 gained a claim of its own for that reason: every `.tile` on the board is in the focus population**,
asserted against the walk's own selector string rather than a paraphrase of it. The count alone could not
carry this, and the count is what moved: **focus examined 56 → 59 on the boards surface, one per tile.**
The plan predicted +14; **the harness fixture renders three cards, not fourteen** — 14 is the owner's own
board and Phase 3's `.tile` measurement, and the number here is 3 of 3.

### 2 — `npm test` leaked 851 directories per run into the owner's home

`vitest.config.ts` did not set `VIBEBOARD_COPILOT_HOME`, so `copilotHome()` fell back to
`~/.vibeboard/copilot` and every temp project the suite opened left a `projects/<digest>` behind.
`visual/playwright.config.ts` has set it since Phase 0 **and cites this very count in its own comment**;
the suite was the half nobody had done.

**Measured rather than estimated, and both halves are commands.** With the variable pointed at a scratch
path, one full `npm test` creates **851 directories (422 project digests, 3.4MB)** —
`find <path> -type d | wc -l`. The owner's tree holds **118,902 directories, 58,877 of them project
digests, 799MB** on 2026-08-21, up from the 55,061 and 545MB this page recorded. **It is not deleted here:
a cleanup that removes something a person wanted is worse than the leak**, so the path and the count are
reported and the decision is the owner's.

This is the inode incident's exact shape, one directory tree along — 440,653 leaked trees filled 9.43M of
9.83M inodes while 61G of block space sat free, and past that ceiling one arbitrary test fails per run and
is indistinguishable from flakiness in the code.

**Fixed in one line, inside the per-RUN root the teardown already removes.** Proven three ways: a full
`npm test` now creates **0** new directories under `~/.vibeboard/copilot` (`find` before and after, 118,902
both times); deleting the env line turns `test/copilot-env.test.ts`'s new case red (exit **1**,
*"VIBEBOARD_COPILOT_HOME is unset, so the copilot writes into ~/.vibeboard/copilot"*); and pointing it at a
path outside the run root failed the same case while the 851 directories appeared there, which is the leak
measured and the test proven in one run. The assertion goes through `opencodeConfigHome()` rather than
reading the variable back, so a fallback that changed shape is caught as well as a line that was deleted.

### 3 — the dock wasted 79px of a definite 342px body

`.raw-pane`'s `flex: 1` had no flex parent: `.cards-body` was a scrolling BLOCK, so the pane sat at its own
content height floored by `.raw-area`'s `min-height: 14rem` — 224px, large enough to hide the collapse.
`.cards-body` is a flex column now, which is the one-line fix, and **the ratchet it replaces is gone**:
`DOCK_SHORTFALL = 79` is deleted and check 10 asserts an EQUALITY.

**It is measured against the box the pane was GIVEN, not against the dock body, and that distinction is the
honest form of "the pane fills the body".** The tab strip and `.cards-body`'s own inset are inside the
342px body too, so `paneHeight === bodyHeight` is unsatisfiable — asserting it would be asserting a number.
`pageDock` now reads the pane's parent's content height in the page (`clientHeight` less that parent's
padding), so a padding change cannot silently become slack. Measured at 1440×900: the pane is **287px of a
287px box** in a 342px definite dock body, where it was 263px.

**Check 10 fails without the fix**, on all three themes: with `.cards-body` put back to a block,
`npm run visual` exits **1** — *"the raw pane is 263px inside the 287px box it was given, in a 342px
definite dock body: it is leaving 24px of it unused"*. The dock's resting height moved 76px → **81px**,
still strictly under its 342px cap, which is what that half of check 10 asserts.

### 4 — RULED: a token supplied at run time by the surface that uses it is NOT a finding

`--exec-cols` and `--max-cols` were the last two unresolved tokens, and the answer is that **there is
nothing here to fix**. Neither can be defined in a stylesheet without becoming a lie: `--max-cols` is the
column count of the widest board and `--exec-cols` is the length of `ExecutionView`'s own `COLUMNS`, so a
CSS definition would be a second copy of a fact React already owns — which is the class of defect the
`--track-fit` comment in `styles.css` records. Phase 0 called it *"a gap in the harness's coverage rather
than a defect"* and Phase 6 closed the coverage half; counting them on the nine surfaces that do not render
their view was **the instrument mistaking its own scope for a fault**, and a gate that reports a correct
design is a gate that gets switched off.

**So each one is NAMED in `RUN_TIME_TOKENS`, with the element that supplies it and the surface that proves
it — and the excuse is worth exactly what those two clauses make it.** This is the form
`OFF_SCALE_ON_PURPOSE` and `CHIP_EXEMPT` established, with the addition that this list cannot rot quietly:

- **`supplier`** — the excuse applies only where that element is absent **from the walk's own population**.
  Measured against the population and not the document, which the four overlay surfaces force: the board is
  still behind the settings modal, so `main.boards` exists while being no part of what is measured. Asking
  the document reported `--max-cols` as a fault on four surfaces that neither use it nor could supply it.
- **`owner`** — the surface that supplies it asserts the token is not excused there, and that the supplier
  selector **matches something**. Without the second clause a stale selector would make the excuse
  unconditional everywhere, and nothing else could see it: on the owner surface the token resolves either
  way, and on the other nine it is excused either way. That is the assertion the first draft was missing,
  and a planted `main.boardsX` exited **0** until it existed.

**A GENUINELY UNDEFINED TOKEN STILL FAILS, WHICH IS THE HALF THAT MATTERS**, and nothing like `--ink` can
ever reach this list: every entry has to name an element that really sets the value.

| planted | result |
|---|---|
| `color: var(--ink-nope)` on `.tile-title` — the `--ink` defect exactly | exit **1**, *"--ink-nope — referenced by a rule, defined by no stylesheet and set by no element"*, tokens 0 → 1 on boards, examined 41 → 42 |
| `BoardsView` stops setting the inline style | exit **1** on the boards surface — the supplier is in the population and supplies nothing, so the excuse does not apply |
| `supplier` changed to `main.boardsX` | exit **1**, *"the excuse in RUN_TIME_TOKENS is now unconditional. Fix the selector."* |

**Unresolved tokens are therefore 0 of 41 on all ten surfaces on all three themes**, from 1 on the board and
1–2 on the other nine, and the ceilings are re-recorded at zero in the same commit — which is this page's
own rule for a count that reaches it.

### 5 — two latent gate bugs

**`tools/check-radius-scale.mjs` counted a shape inside an at-rule twice, and it was the SELECTOR half that
mattered.** `rulesOf` did not reset its selector cursor at a `{`, so a nested rule read as
`@media (min-width: 1px) { .zeta` — which made the at-rule's own body (it contains every declaration nested
in it) a second rule with the same declarations, AND hid the real rule from claim 2, whose every selector
test is anchored on `.name`. `check-shape-coverage.mjs` hit this in Phase 7 and removed the cause; this file
recorded it as *"a latent over-report it can live with"*. One copy fixed and two left is the argument for
item 6.

Its fixture now holds **two** at-rule kinds — `@media` and `@container`, both of which are in this
stylesheet, because a fix keyed on the word `media` would pass a fixture holding only the first — and the
expectation went from `7 declarations` for six with `.zeta` printed twice to **7 for seven, each once**.
Proven in both directions, each restored: with the cursor reset removed the self-test exits **1** at
*"5 declarations"* (the two nested rules vanish entirely, because the at-rule filter then drops them with
their prelude), and with the at-rule filter removed it exits **1** at *"9 declarations"* with both nested
findings doubled. **The tree's own numbers do not move — 41 authored declarations, geometry ratchet 4/4 —
because no `border-radius` in this stylesheet sits inside an at-rule**, which is what "latent" meant.

**`docs/by-file.md` indexed two of the five gates.** `check-radius-scale.mjs`, `check-class-budget.mjs` and
`check-shape-coverage.mjs` had no row, so a reader holding a red `npm run check` had nowhere to go for the
radius ratchet, the class budget or the six shape censuses. All three are indexed now, with `tools/lib/`
beside them. **A gate is the one class of file that cannot explain itself at the point of use** — it is met
as an exit code by somebody who has not opened it — which is exactly the condition that page exists for.
`test/docs-by-file-index.test.ts` asserts it **by class rather than by list**, so the sixth gate is covered
by existing; removing the `check-shape-coverage.mjs` row exits **1** naming it.

### 6 — the parser duplication, extracted, and the proof is a byte-identical diff

`lineOf` existed in **four** copies, `walk` in three, and `rulesOf`, `openTagEnd`, `openTagsOf`, `codeOf`,
`classesOf` and `shapedRules` in two or three each. `tools/lib/` holds one of each, split by concern:
`source.mjs` (the corpus walk, the line counter, the comment blanker), `css.mjs` (the brace-matched rule
scanner, the at-rule filter, the selector reader) and `jsx.mjs` (the opening-tag reader).

**CHARACTERISED FIRST, AND THE CONTRACT IS THE OUTPUT.** All five gates' stdout was captured on the tree
before the extraction and diffed after it: **byte-identical, all five, md5 for md5** — including
`check-shape-coverage.mjs`'s 44-line census listing, which names 20 panel rules, 11 mono rules and their
call sites. That is a stronger claim than any unit test of a helper could make, and it is the reason the
extraction is safe to review at a glance.

**EVERY GATE'S SELF-TEST GOES THROUGH THE SHARED CODE**, which is the mistake this repository has now made
twice and did not make again: seven defects were planted in `tools/lib/` and each one was caught by the
self-tests of the gates that depend on it, with every gate restored between plants.

| planted in `tools/lib/` | which gates exited **1** |
|---|---|
| `rulesOf`'s brace matcher (`'{'` → `'('`) | radius, class-budget, shape-coverage |
| `shapedRules` stops dropping at-rule preludes | radius, shape-coverage |
| `classesOf`'s selector regex | class-budget, shape-coverage |
| `codeOf`'s comment blanking removed | class-budget |
| `lineOf` off by one | type-scale, radius, shape-coverage |
| `openTagsOf`'s `(?![\w-])` name guard removed | radius, shape-coverage |
| `walk` matches no file | class-budget |

**Two of those rows are findings about the gates rather than about the extraction, and they are recorded
rather than smoothed away.** A broken `codeOf` is caught only by `check-class-budget.mjs` — the
comment-in-prose case is in its fixture and not in `check-shape-coverage.mjs`'s. And **a broken `walk` is
caught only by `check-class-budget.mjs`'s `PARSE_FLOOR`**: the other four have no count floor, deliberately
(every count they measure shrinks as the sweep succeeds, and a floor on one fails the run for succeeding),
so a walk that matched nothing would report zero findings and exit 0 on three of them. That exposure is
unchanged by this phase — each gate had its own identical `walk` before — but it is one copy now, and one
place to fix if the owner wants a fixture-based guard on it.

### Exit

**Every ceiling is where it was and none rose.** Class budget **375/375**, geometry ratchet **4/4**, panel
**20/20**, mono **11/11**, control **2/2**, control-geometry / chip / dot / seg / box-less **0**, authored
`font-size` **115**, authored `border-radius` **41**. `npm run lint` clean over **548** files (544 + three
`tools/lib/` modules and one test). Suite **243 files / 4,411 tests** (242 / 4,402 + 7 keyboard cases, the
copilot-home case and the docs-index case). Harness **93 tests, three themes, exit 0**. `npm run build`
exit 0. **`querySelector('.class')` calls in `test/`: 106, unchanged** — the new tests select by role,
title and accessible name, not by class.

**Three baseline numbers moved and each was read before it was re-recorded:** `focus` examined **56 → 59**
(three tiles), `tokens` findings **1 → 0** on the board and **1–2 → 0** on the other nine, and the board's
type TALLY **`13px×133 → ×135`, `12px×66 → ×64`** — which is **not this phase's**: it is Phase 9's two
selects moving from `--t-small` to `--t-body`, which that phase read and deliberately did not record because
drift compares the value SET. The set did not move in either phase. No other recorded number changed.

**Two items from this phase's own list were NOT in its scope and are untouched:** re-deciding `Tabs` with
Execution and settings measurable, and `.archive-title` needing `.archive-item` to stop padding itself.
Both remain as Phase 5b left them, with their measurements.

**Revert:** `web/src/board/CardTile.tsx` (the role, label, `tabIndex` and `onKeyDown`), the `.cards-body`
flex column in `styles.css`, one line of `vitest.config.ts`, `RUN_TIME_TOKENS` and `paneBoxHeight` in
`visual/support/audit.ts`, checks 5, 6 and 10 in `visual/checks/board.spec.ts`, the token block in
`surfaces.spec.ts`, three baseline files, the at-rule reset and fixture in `tools/check-radius-scale.mjs`,
`tools/lib/` with the five gates' imports, five rows of `docs/by-file.md`, and
`test/{card-tile,copilot-env,docs-by-file-index}`.

---

# Part Three — the two censuses Part Two left unassigned

**Status: Phases 11 and 12 done 2026-08-21. Part Three is finished, and one decision is left open for
the owner rather than taken here.** Part Two closed six shapes and left two reading *unassigned* rather
than pretending a phase owned them: **panel 20** and **mono 11**. Phase 11 took the panel row and drove
it to **10**; Phase 12 took mono to **7**, all seven the same reasoned exception. Both are listed in
full by `npm run check:shape-coverage`.

## Phase 11 — Panel's twenty, and the Tabs decision re-taken on four — **DONE 2026-08-21**

**The panel census is 10, from 20**, and the ceiling is 10 in the same commit — `node
tools/check-shape-coverage.mjs`. Ten of the twenty are the primitive's box now, and the ten that are not
each carry a reason of the quality this page has accepted: **not one of them is "it has its own
padding"**, which is the thing being removed.

### `Panel` gained a third variant, and it was added by measurement

**`inset` is `flat` with the box DRAWN**, and that is the whole of the difference: the same `--r-md`
corner, the same `var(--s-3) var(--s-4)` padding, the same `color: inherit; font: inherit; text-align:
left` reset — a `--panel-2` ground and a `--border` edge where `flat` has a transparent one. Which keeps
Panel's variant axis exactly one question wide, *is the box drawn?*, with `raised` answering it for a
surface above the wash and `inset` for a box inside one.

**TEN RULES, ONE BOX, AND EIGHT PADDINGS.** Every one declared a 1px `--border`, a `--r-md` corner, a
ground and a padding, and between them they wrote eight values for that padding:

| rule | ground | padding |
|---|---|---|
| `.tile` | `--panel-2` | `8px 8px` |
| `.archive-item` | `--panel-2` | `6px 8px` |
| `.markdown pre` | `--panel-2` | `0.7rem` |
| `.msg-assistant` | `--panel-2` | `6px 8px` |
| `.gate-list button` | `--panel-2` | `8px 0.7rem` |
| `.copilot-actions button` | `--panel-2` | `4px 8px` |
| `.control-tabs button` | `--panel-2` | `0.2rem 8px` |
| `.exec-run` | `--bg` | `8px 8px` |
| `.links-list` | `--bg` | `8px` |
| `.signin-label` | `--bg` | `8px 0.65rem` |

Eight values for one property on one box is the 27-font-sizes pathology, and the **third** time this page
has met it one level up — Phase 4's eight list-row paddings, Phase 5's five text-box paddings. That is the
`SegmentedControl` argument in the same currency: not a consumer count, a multiset. The primitive takes
`var(--s-3) var(--s-4)`, which is `.archive-item`'s own value and the one `flat` and `.vb-input` already
landed on for the same reason.

**THE GROUND WAS NOT A DISTINCTION ANYBODY CHOSE, and that is measured rather than asserted.** Six
`--panel-2` against four `--bg` — and `.tile` and `.exec-run` are the same object, a record in a column on
a `--panel` parent, answering differently. `--panel-2` is the mode and it is what this system already
calls a drawn nested fill (`.vb-btn-default`'s ground, `.vb-chip-fill`'s); `--bg` is the ground of a
control you TYPE in, which Phase 5b settled for the two select triggers on exactly this kind of
measurement. So `.exec-run`, `.links-list` and `.signin-label` move to `--panel-2`: **three visible
changes, made on a measurement**, the same form as `.mp-chip`'s 12px → 11px and the six selects' 12px →
13px. Contrast held at zero on all ten surfaces on all three themes, which is the check that would have
seen it.

### The ten that migrated

| class | → | call sites |
|---|---|---|
| `.modal` | `Panel raised` — that variant **declaration for declaration**: ground, edge, 10px corner and the head-over-scrolling-body flex column | 3 (`AutopilotHelp`, `SettingsModal`, `useConfirm`) |
| `.mp-modal` | `Panel raised` + its accent edge as a `border-color` | 1 |
| `.chat-menu` | `Panel raised` | 1 |
| `.tile` | `Panel inset`, keeping `role="group"`, the label, the `tabIndex`, the `onKeyDown` and the drag | 1 (3 tiles on the harness fixture, 14 on the owner's board) |
| `.archive-item` | `Panel inset` — the one whose padding did not move | 1 |
| `.exec-run` | `Panel inset` | 1 |
| `.links-list` | `Panel inset` | 1 |
| `.signin-label` | `Panel inset`, a `<div>` rather than a `<p>` | 1 |
| `.gate-list button` | `Panel as="button" inset` — a region of a list that takes a click, with no voice | 1 |
| `.copilot-actions button` | `Button default sm`, and the wrapper class died with it | 1 |

**`.copilot-actions button` WAS `Button` `default` `sm` VALUE FOR VALUE** — the same `--panel-2` ground,
`--text` ink, `--border` edge, `--r-md` corner, `var(--s-2) var(--s-4)` padding, `--t-small` size and the
same disabled dimming, written out by hand. It gains a hover it did not have. **`.copilot-actions` is the
one class that died outright**: what was left of the wrapper was `margin-left: auto` — which is `.push` —
beside a `display: flex` and a `gap` that had one child to separate from nothing, so the button sits
directly in `.copilot-controls`, which is already the flex row with the gap. That death is what pays for
`.vb-panel-inset`: the class budget is **375 and did not move** (`styles.css` 327 → 326, `primitives.css`
61 → 62).

**Nine of the ten classes survive with only what the surface can decide**, which is the result Phase 3
measured on its 27, Phase 4 on its nine rows and Phase 8 on its nine chips: `.tile`'s **2px accent left
edge** (2px where the primitive's is 1px, and the one thing that says which board a card is on) and its
`cursor: pointer` (a `role="group"` is not a `<button>`, so `button.vb-panel`'s pointer does not reach
it); `.archive-item`'s three-cell row; `.exec-run`'s and `.links-list`'s flex columns; `.mp-modal`'s
accent edge and shadow; `.chat-menu`'s float, shadow and inset; `.modal`'s measure; `.signin-label`'s
mono face and `break-all`; `.gate-list button`'s stack of name over path.

### THE TABS DECISION, RE-TAKEN ON FOUR — and refused again, against a wider disagreement

Phase 5b refused `Tabs` on **three candidates of which two were real**, because the two disagreed about
both things a tab primitive would own. The census lists **four** tab boxes, so the measurement is
different and the decision was taken again rather than cited. **It is refused again, and the table is
why: four candidates give three answers to the resting box, four to the face and four to the selected
state.** Measured by `test/panel-twenty.test.tsx`, which pins the table so that it cannot rot — a tab
whose face or selected state changes forces the refusal to be re-read rather than inherited.

| | resting box | face | selected |
|---|---|---|---|
| `.dock-tab` | transparent / transparent | `--font-display`, uppercase, `0.08em` | `--text` ink, `--border` edge, no glow |
| `.tab-btn` | transparent / transparent | `--font-display`, **not** uppercase, `0.04em` | `--accent` ink, `--border` edge, **a glow** |
| `.control-tabs button` | `--panel-2` / `--border` | **none — it inherits the app's** | `--text` ink, `--accent` edge, no glow |
| `.cards-tab` | `--bg` / `--border` | **none — the face is on the LABEL inside it** | **no ink of its own**, `--accent` edge, a glow |

**Four consumers giving four answers to both of a primitive's decisions is four variants for four
consumers, which is a name that decides nothing** — the same test that keeps `ghost` at two, refused
`--t-display` a second consumer and gave `SegmentedControl` its four classes on the opposite evidence.
Going from two candidates to four made the disagreement **wider, not narrower**, which is the one outcome
that settles this: at two it was one variant each, and at four it still is.

**Two findings came out of measuring it, and both make the refusal stronger.** `.cards-tab`'s selected
state changes **no ink at all** — the ink is `.cards-tab.active .cards-tab-label`, one level down on the
control inside the box — so a primitive owning "selected" would also have to decide which ELEMENT the
state colours, and the four answer that in two ways as well. And **`.cards-tab` is not a tab button**: it
declares no padding because the two controls inside it do, which is the mirror of Phase 5b's reading of
`.cards-tab-label` — that was the label inside a tab and this is the box around one.

### The ten survivors, each with what keeps it out

| survivor | which variant would have to lie, and how |
|---|---|
| `.dock-tab` `.tab-btn` `.control-tabs button` `.cards-tab` | **A tab**, refused on four with the table above. |
| `.popover` `.gate-card` | **A document whose adjacent vertical margins COLLAPSE**, and `raised` is a flex column, where they do not. `.ap-agent-heading`'s `0.35rem` bottom against `.ap-agent-detail`'s `0.35rem` top is 0.35rem of gap in block flow and 0.7rem in a flex column; the gate card's `.gate-list` bottom `1rem` against its `h3` top `1.5rem` is 1.5rem against 2.5rem. Both are boxes `raised` matches exactly in ground, edge and corner — and **neither is rendered by the harness**, so a 5.6px and a 16px spacing change would have shipped unseen. See the owner's decision below. |
| `.markdown pre` | **There is no element to put a primitive on.** The `<pre>` is emitted by the markdown renderer from a card's own text; no JSX names it, which is why the census prints `CardView.tsx:96` for the whole `.markdown` family. |
| `.msg-assistant` | **Four corners and a tail** — `--r-lg --r-lg --r-lg --r-sm`. Panel has one corner per box, so every variant would have to lie about the tail. Phase 4's reason, re-measured and unchanged, and the class is still composed at run time from `msg-${role}`. |
| `.inline-view` `.inline-edit` | **One control in two states, and the two share one box on purpose.** A field that looks like text until it is clicked must not move when it becomes an input, so both declare `0.1rem var(--s-3)`; the control box the system owns is `var(--s-3) var(--s-4)`, which would make the text jump 4px on click. `InlineField`'s commit-on-blur is behaviour and is ruled out of `Field` by name. |

### The characterisation suite, written first, and the three things it found

`test/panel-twenty.test.tsx` — **28 tests, run green against the code as it was**, before any migration,
resolving each box out of the stylesheets with `test/css-box.tsx`. **What is deliberately NOT pinned is
the ten paddings**, because pinning a value the phase exists to normalise would make the suite a
description of the old code; what IS pinned is the ground, the edge and the corner. **Five of its own
premises were wrong on the first run and three of the five are findings about the code:**

- **`.mp-modal`'s accent edge was the whole `border` SHORTHAND, not a `border-color`.** The distinction is
  load-bearing for a migration: a shorthand at equal specificity replaces the primitive's width and style
  as well as its colour, so a Panel that ever moved off 1px would have been silently overruled on this one
  surface. It is a `border-color` now, the form the emergency stop's danger hover established.
- **`.conn-pop` IS NAMED AT A CALL SITE AND DEFINED BY NO RULE** — `ConnectionLight.tsx:50` passes it to
  `Popover` and no stylesheet in the tree contains the string. This is the **mirror** of Phase 5b's
  `.vb-label-caps`, and neither gate can see this direction: `check-class-budget.mjs` reads CSS → code.
  Pinned as an equality (`.popover conn-pop` draws exactly what `.popover` draws) so it flips if a rule
  appears, and left in place rather than deleted, because deleting it is not this phase's subject.
- **`.cards-tab`'s selected ink lives on its child**, above.

The other two premises were the suite's own arithmetic: the paddings are eight distinct values across ten
rules and it guessed nine, and the token resolver answers `0.75rem` where the assertion said `12px`.

**THE ASSERTIONS SURVIVED THE MIGRATION AND THE FIXTURES DID NOT**, which is what Phase 4 recorded of
`panel-boxes` and Phase 8 of `chip-boxes`, and is honest to repeat rather than dress up: thirteen of the
28 went red once the box moved into the primitive, for the right reason — the element genuinely carries
two more classes. They are `Panel` renders now, so no class list is hand-written and renaming
`vb-panel-inset` moves the fixture instead of quietly testing a dead class. **Two fixtures elsewhere
needed the same treatment in the same commit** — `test/label-notice-boxes.test.tsx`'s *".archive-item pads
itself"* and `test/control-boxes.test.tsx`'s *"`.modal` is `--panel`"* — and both claims are unchanged.

### Gates

| gate | before | after | planted defect, and what it said |
|---|---|---|---|
| panel census | 20/20 | **10/10** | the border/corner/ground trio put back on `.tile`, **which now sits on a `<Panel>`** → exit **1**, *"panel-shaped: 11 … against a ceiling of 10"*, naming `styles.css:463` and `board/CardTile.tsx:47`. That is the Phase 3 migration-blindness defect planted at directly, and the census sees straight through the primitive's tag |
| `test/card-tile.test.tsx` | 21 pass | 21 pass | `tabIndex` removed → **1 of 21** red (*"expected `matches(FOCUSABLE)` to be true"*); the Enter/Space branch removed → **1** red (*"expected spy to be called 1 times, but got 0"*); the `e.target !== e.currentTarget` guard removed → **2** red, the archive-button and the tag rows; `draggable` removed → **1** red. Each restored |
| `npm run visual`, check 6 | 0/59 | 0/59 | `tabIndex` removed **in the browser** → exit **1** on all three themes, *"3 of 3 card tiles cannot be reached from the keyboard, and are absent from the 56 elements this check protects"*, with the boards ratchet firing beside it at *"the focus walk examined 56, against 59"* |
| `test/panel-twenty.test.tsx` | — | **27 pass, new** | `inset`'s ground moved to `--bg` → **6** red; its `border-color` dropped → **6** red; `.tab-btn` given `.dock-tab`'s uppercase `0.08em` face → the tab table red, which is what forces the refusal to be re-read |
| class budget | 375/375 | **375/375** | a `.vb-panel-planted` added → exit **1**, *"376 class selectors, against a ceiling of 375"* |
| `check:radius-scale` claim 1 | 41 | **31** | `border-radius: 7px` on `.vb-panel-inset` → exit **1** naming `primitives.css:173` |
| `npm run lint` | clean/548 | clean/**549** | a duplicate `background` on `.vb-panel-inset` → exit **1**, `lint/suspicious/noDuplicateProperties` |
| `npm run check` | ok | ok | `'inset'` removed from `PanelVariant` → `typecheck:web` exit **2**, naming all seven call sites |
| `npm run build` | ok | ok | an unresolvable import used by `Panel.tsx` → exit **1**, *"Could not resolve ./does-not-exist"* |

**The examined ratchet fired on its own before anything was re-recorded**, which is the run that read the
drift: `npm run visual` exited **1** with **15 failures** — five surfaces × three themes — each naming its
own count.

### Drift, read before it was re-recorded

**Seven numbers moved per theme and every one has the same single cause: the deleted
`.copilot-actions` wrapper `<div>`.** Five whole-document surfaces lose one element each because the
copilot dock is the shell and renders on all of them, and the board's type TALLY loses one `13px` — the
wrapper itself, which carried no text but inherited `body`'s size and so was in the all-elements walk.

| what | was | now |
|---|---|---|
| boards elements | 236 | **235** |
| execution / diary / control / explorer elements | 146 / 148 / 168 / 127 | **145 / 147 / 167 / 126** |
| board type tally | `13px×135 12px×64 11px×36 15px×1` | **`13px×134`**, the rest byte-identical |

**Nothing else moved, and it was read surface by surface rather than assumed.** Type and radius
conformance **0 findings on all ten surfaces on all three themes**; the drift check printed *"no change
from the baseline"* on both value sets in every theme; the **radius tally is byte-identical** —
`6px×240 999px×84 10px×56 50%×12 4px×4` — which is what says no corner moved despite ten boxes changing
hands. Every finding count is where Phase 10 left it: overflow **0/125**, clipping **1/35** (the exempt
board area), contrast **0/129**, tokens **0/41**, focus **0/59**, rows **0/25**, tiles **3 of 3
reachable**, grid **9 rows / 42 columns / 42 heads** with only `main.boards` scrolling, dock **81px at
rest and 342px with a raw pane, pane 287px of a 287px box**, readouts **31**. The Project Log's two
wrapped `.vb-readout-block` rows are still **2 of 11** and still Phase 12's.

**The five surfaces' finding lists had to be read past their own ratchet to be read at all**, because
`assertExamined` runs before the per-check ratchets and aborted the test. So the assertion was bypassed in
a copy of `surfaces.spec.ts`, the run read in full — every check zero on every surface — and the file
restored from that copy rather than from `git checkout`, which would have reverted the phase instead of
the plant. Verified with `git status` reporting `visual/` clean before re-recording.

**The primitive-ring populations went UP by one on those same five surfaces** — boards 29 → 30, execution
16 → 17, diary 14 → 15, control 15 → 16, explorer 15 → 16 — because the Compact button is a `.vb-btn`
now. Still `N of N`, still **0 without a ring**, in each theme's own accent.

### Exit

**Panel census 20 → 10**, ceiling lowered in the same commit, with a per-survivor reason for the ten.
`Panel` has a third variant. **Class selectors 375 → 375** (`styles.css` 327 → 326: `.copilot-actions`
died; `primitives.css` 61 → 62: `.vb-panel-inset`), ceiling held. Authored `font-size` **115 → 114**,
authored `border-radius` **41 → 31**, both entirely on the scale. **Mono 11/11, control 2/2,
control-geometry / chip / dot / seg / box-less 0, button geometry 4/4 — every other ceiling unmoved.**
Suite **244 files / 4,438 tests** (`test/panel-twenty.test.tsx` adds 27). Harness **93 tests, three
themes, exit 0**. `npm run lint` clean over **549** files. `npm run build` exit 0.
**`querySelector('.class')` calls in `test/`: 106, unchanged** — the new suite reaches its elements
through `Panel` renders and a tag selector, and the two migrated fixtures were never class selectors.

**FOR THE OWNER: `raised` IS A FLEX COLUMN, AND THAT IS NOW THE ONLY THING KEEPING TWO BOXES OUT.**
`.popover` and `.gate-card` match `raised` in ground, edge and corner and are refused solely because a
flex column stops their children's vertical margins collapsing. The choice is a `layout` axis on `raised`
(a `block` form, two consumers, which is the bar `ghost` is held to) against leaving two correct designs
counted as findings. It is not taken here because **neither surface is rendered by the harness**, so a
spacing change on either is invisible to every gate this repository has.

## Phase 12 — the mono eleven, the wrapped figure rows, and the direction nothing read — **DONE 2026-08-21**

Four things, and the fourth is a gate that did not exist. **Mono 11 → 7**, ceiling lowered in the same
commit; **the Project Log's two wrapped figure rows → 0**; a new gate reading **code → CSS**; and a
`npm run build` that can no longer emit a web type error.

### The mono eleven: three moved to the primitive, two merged, and seven are one exception

**The test is the signature's own sentence and not the census number** — *if it is monospaced, the
machine measured it; if it is not, a person wrote it.* A ratchet at 7 reads exactly the same whether
the seven are the seven that were reasoned about or seven somebody added last week, so
`test/mono-census.test.tsx` asserts the SET against a table of survivors with the category that excuses
each, and fails in both directions: a rule in the census and not in the table, or a rule in the table
that has left the stylesheet.

**THREE WERE READOUT FACTS SAYING SO BY HAND**, and each was the primitive value for value:

| was | is | measured how |
|---|---|---|
| `.msg-tool` | `Readout` `small` `accent`, and **the class is gone** | `color: var(--accent); font-family: var(--font-mono); font-size: var(--t-small)` IS that variant. A tool name is machine vocabulary. `msg-tool` still reaches the wrapper `<div>` through `` `msg-${it.kind}` `` and has nothing left to say, because the line's only child is the readout |
| `.report-chip` | `vb-readout` on the `<Chip>` | The form Phase 8 established for `.board-archive`, `.tag-chip` and `.tab-badge`. Three call sites. The rule keeps its uppercase tracking and `flex: 0 0 auto`, which are the surface's; the face is the primitive's |
| `.report-meta dd` | six `Readout` `plain`s | `ui/primitives.css` names this case at `--t-plain` itself — *"a definition in a report's meta list"*. A model id, two timestamps, an attachment list and a cost line are all machine facts |

**AND TWO WERE ONE RULE UNDER TWO NAMES.** `.gate-preview code` and `.ap-help-body code` each declared
mono, `--t-small` and `--accent`; they are now one rule, sitting with `.markdown code` so all three
inline code treatments are read together. `--t-small` is explicit because `.ap-help-body p` is
`--t-body`, and it is what `.gate-preview` already inherited — so the merge emits the same bytes.

**THE SEVEN SURVIVORS ARE ALL THE SAME EXCEPTION, and it is a weaker claim than the signature's: the
CONTENT is machine text rather than a measurement.** Four could not be a `Readout` at all, which is
structural rather than a judgement — a `Readout` is a `<span>` and these are controls:

| survivor | why it is not a fact the machine measured |
|---|---|
| `.raw-area` | A whole card FILE in a textarea. |
| `.control-textarea` | A config file in the editor body. |
| `.skill-editor textarea.vb-input` | A prompt, which is edited like code. |
| `.confirm-require .vb-input` | The exact string the machine demands back, typed character by character — the face is what lets you compare the two. |
| `.gate-preview code, .ap-help-body code` | Inline code in prose. A `<code>` means *this is code*; it is not a measurement. |
| `.markdown code` | The same, in rendered prose, and the one chip exemption in `check-shape-coverage.mjs`. |
| `.signin-label` | A browser's own User-Agent string, quoted back at you. |

**A FOURTH INLINE `<code>` HAS NO RULE AT ALL and is left alone:** `.halt-why code`, in the approval
prompt, renders in the UA's own monospace. It is not in the census — no rule declares anything — and
whether the three treatments should be one generic `code` rule is a question about rendering on two
surfaces the harness never opens, which is not this phase's to answer.

### The Project Log's figure rows: two lines, not one wrapped one

Check 7 reported *"4 children span 33.0px, tallest is 15.0px"* twice on the `diary` surface — the two
`.filed-entry` meta rows. **Ruled 2026-08-21 and not re-opened: check 7 gets no `flex-wrap` exemption**,
because an exemption keyed on that declaration lets anyone silence the check by adding it to an action
row. The fault was the rule's.

**MEASURED BEFORE IT WAS CHANGED, in the browser.** The filed column is `flex: 0 1 42%` — 369px, a
266px line inside the entry — and the row carried **366px of figures plus 36px of gaps**: a state word
at 46px, a full locale timestamp at 130px, a run id chip at 144px and a card id at 46px. It cannot fit,
so the row was split by what the figures MEAN:

- The `ReadoutLine` keeps the two facts the entry states **about itself** — its state and when it was
  filed. 188px of 266px, on one line, and two children rather than three.
- The ids it **points at** — run, card, and what it became — are a `.diary-about` group, which is the
  class the diary beside it already uses for exactly that. **No new class**, so the budget did not move.

**THE GROUP STACKS IN THIS COLUMN, and that is the part the fixture could not have proven.**
`.filed-entry .diary-about` is `flex-direction: column`; the diary's own copy has 408px and stays a row.
Kept as a row, the group fits with a run and a card and wraps the moment a `became` chip appears — and
the harness fixture carries no `became`, so a row would have passed every gate in this repository and
still been wrong. Stacked, the references line up on their left edge whether there are one, two or
three of them, which is the claim the readout makes; wrapped, they were the one it refuses.

**Looked at as well as measured.** Before: `ACTIVE 1/1/2026, 9:20:00 AM` on line one and the two pills
ragged under it, which read as the second line of a paragraph. After: the state line, then the pills
stacked directly beneath it — a small block of references under a header, left-aligned on the same edge
as the title below. The entry is 20px taller and the column scrolls, which it already did.

**Drift, read surface by surface before anything was re-recorded**, with `assertExamined` bypassed in a
copy of `surfaces.spec.ts` and the file restored from that copy rather than by `git checkout` — the same
procedure Phase 11 used, and `git status` reported `visual/` clean before the re-record. **Three numbers
moved, all on `diary`, all with the same cause:**

| what | was | now | why |
|---|---|---|---|
| diary elements | 147 | **149** | the two `.diary-about` spans |
| diary rows EXAMINED | 11 | **9** | a two-child row is below check 7's own three-child threshold, so the two rows leave its population |
| diary rows FINDINGS | 2 | **0** | the phase's subject |

**Nothing else moved, on any of the ten surfaces or any of the three themes**: type and radius
conformance 0 everywhere, the value SETS unchanged (the drift check printed nothing on all thirty
surface-theme pairs), overflow 0, clipping 1 of 35 (the exempt board area), contrast 0, tokens 0, focus
0, and every other surface's `examined` block byte-identical. The board's own tallies in
`board.spec.ts` are untouched.

**STATED PLAINLY, BECAUSE IT IS A REAL COST: check 7 no longer looks at those two rows.** Both
exclusions are the check's own pre-existing rules rather than new exemptions — a row of fewer than three
children is not in its population anywhere in the app, and it only claims about `flex-direction: row` —
but the honest reading is that the rows were removed from the check as well as from the finding list.
What holds them now is `test/diary-view.test.tsx`, which pins the structure and the stacking.

### The gate for the direction nothing read

`tools/check-name-resolution.mjs`, `npm run check:name-resolution`. **Three times** this repository has
found a name written at a call site and defined by nothing, and every one was found by a person:
`.vb-label-caps` (eight call sites, no rule, a caps label rendering lower-case), `--ink` (referenced,
undefined, a wrong ink for weeks) and `.conn-pop` (handed to `<Popover>`, no rule, removed in Phase 11).
`check-class-budget.mjs` reads **CSS → code**; nothing read **code → CSS**. Two claims:

1. **Every class named in a `…ClassName` attribute across `web/src` is defined by a rule.** A RATCHET at
   **5**, with the full list printed on a passing run.
2. **Every `var(--token)` a stylesheet references is defined by a stylesheet, or supplied at run time by
   code that names it.** BLOCKING AT ZERO, and it is at zero: 41 referenced against 42 defined, with `--max-cols` and
   `--exec-cols` supplied from React and read out of the source rather than allow-listed.

**The naive version is wrong in both directions, and both are handled rather than allowed for.**

- **Composition.** `` `ap-bar-${model.tone}` `` reads as the token `ap-bar-`, which is no class.
  `check-class-budget.mjs`'s method is reused rather than re-derived: a token ending in `-` is a PREFIX,
  satisfied when the prefix plus some value written in the corpus is a class that exists. **Never by
  prefix MATCH** — `.conn-pop` prefix-matches its own children `.conn-pop-head` and `.conn-pop-detail`,
  which is how the defect it is named after would have gone on hiding, and the self-test fixture pins
  exactly that case.
- **Legitimate hooks.** A `className` can exist so something can FIND the element. `.column` is read by
  the harness (`.column > .vb-panel-head`) and `.explorer` by both the harness and the suite
  (`section.control.explorer`, `.control:not(.explorer)`). So a class is excused when it is **READ** —
  named as a selector or passed to `classList`, in `web/src`, `test/` or `visual/`. That is a measurement
  and not an allow-list: delete the `querySelector` and the class is a finding again. The selector test
  is anchored, because a bare substring search for `.explorer` matches `'./api/explorer'` in an import
  and would excuse the class on the strength of a module path.

**IT READS `…ClassName`, NOT `className`, and that widening is the `.conn-pop` shape exactly**: a class
handed to a component through a prop of its own is still a class on an element. `Popover` takes
`triggerClassName`, and `.conn-status` and `.ap-agent-state` reach the DOM through it — invisible to a
reader anchored on the literal string `className=`.

**THE READER MOVED INTO `tools/lib/jsx.mjs` AND IT FOUND A DEFECT IN ITSELF.** Two gates now ask the
same question of it from opposite ends, so there is one copy, and the first run of the new one reported
`.rail` — which is the operand of `layout === 'rail'` in the ternary that CHOOSES the class list at
`ui/Field.tsx:67`. A string being compared is a value and not a class, so comparison operands are
blanked, and the change was verified by measurement rather than by reading: it removes **exactly one**
token, `rail`, and `check-shape-coverage.mjs`'s output is **byte-identical** before and after the whole
extraction.

**AND THE FIRST PLANT AT IT FOUND A SECOND DEFECT IN THE GATE ITSELF, which is the whole argument for
planting.** `.conn-pop` was put back at its old call site and the gate exited **0**, because the hook
test was a bare `\.name` search and `test/panel-twenty.test.tsx` contains the string in a TEST TITLE —
*"`.conn-pop` decides nothing about the popover it is passed to"*. Prose in a test name is not a reader.
Selection happens through a NAMED API, so the match is scoped to the argument of one — `querySelector`,
`querySelectorAll`, `closest`, `matches`, `locator` — or to a `classList` call. That repair also took the
left anchor off the dot, and it had to: the anchor broke the COMPOUND selector, so
`page.locator('section.control.explorer')` did not excuse `.explorer` on the surface list that reads it
every run. Both cases are fixture rows now. **The limit that is left**: a selector reached through a
helper — `gone(page, 'section.control.explorer')` — is invisible, and `.explorer` is excused only because
a `locator` call reads it as well.

**No count floor on the findings.** Both existing count floors in this repository failed a run FOR
SUCCEEDING and were withdrawn, so the anti-vacuity instrument is a fixture the tree cannot move, run
through the gate's own functions — and it earned its place immediately: the first draft of the prefix
resolver stripped the trailing dash, so `beta-` + `ok` became `betaok` and a perfectly live composed
class was reported as dead. The fixture caught it. There is a floor on the POPULATION (40 names, 10
token references, against 323 and 41), which is a smoke alarm an order of magnitude below the real
count.

**The five findings, each the `.conn-pop` defect again — a name that styles nothing.** Left where they
are, printed, because removing five is a different change from building the instrument that finds them:

| finding | sites | what is there instead |
|---|---|---|
| `.ap-drawer-col` | `AutopilotBar.tsx:467`, `:482` | `.ap-drawer` and `.ap-drawer-head` have rules; the column does not |
| `.copilot-authority` | `CopilotPanel.tsx:170` | nothing — a bare wrapper `<div>` |
| `.mp-badge` | `ModelPicker.tsx:168`, `:173`, `:178` | `.mp-badges`, the PARENT, has the rule; the three badges have none |
| `.settings-error` | `AutopilotPanel.tsx:265`, `:320` | nothing, and `.vb-error` is the class that draws an error |
| `.status-` | `runs/CardReports.tsx:49` | nothing whatever: no `status-*` rule exists in the tree, so the composed name resolves to zero |

**What it does not catch**, stated so nobody mistakes a ratchet for a proof: a class that is defined but
defined WRONG (this is resolution, not conformance — `.vb-label-caps` with an empty body would pass); a
class reached through a variable rather than an attribute, which is `InlineField`'s `common` object and
the blind spot `check-shape-coverage.mjs` already names for its own arm 2; a hook that is read by a test
that no longer asserts anything; a custom property referenced only from code; and a token defined and
never referenced — which is the other direction again, and is `--s-1`, `--s-7` and `--scan` today.

### `npm run build` can no longer emit a web type error

`tsconfig.json` includes only `src` and `vite build` transpiles without checking, so a bad prop type on
`Field` built clean at exit 0. `npm run typecheck:web` is now the second step of `build`, before the
copy and the bundle. **It costs 1.6s**, taking the build from 2.7s to 4.3s; `npm run visual` builds once
per run, so the harness goes from ~31s to ~33s. That is 5% of a run to close a gap where a reviewer
would reasonably read "build" as "it compiles", and it is worth it.

### Gates

| gate | before | after | planted defect, and what it said |
|---|---|---|---|
| mono census | 11/11 | **7/7** | `font-family: var(--font-mono)` put back on `.report-chip` → exit **1**, *"mono-shaped: 8 … against a ceiling of 7"*, naming `styles.css:1130` and `runs/CardReports.tsx:60` |
| `check:name-resolution` claim 1 | — | **5/5, new** | `.vb-label-caps`-style: `className="vb-label-caps-planted"` → exit **1**, 6 against 5. `.conn-pop`-style: `<Popover className="conn-pop">` put back → exit **1**, naming `ConnectionLight.tsx:46`. **And both negatives, which is the half a ratchet cannot show:** `` className={`conn-pop-${'head'}`} `` — a live composed name — exited **0**, and the same line with a prefix nothing defines (`conn-nope-`) exited **1**; a planted `.planted-hook` with a `querySelector` on it exited **0** and was PRINTED as a hook, and exited **1** the moment the `querySelector` was taken away |
| `check:name-resolution` claim 2 | — | **0, blocking** | `--ink`-style: `color: var(--ink)` on `.ap-remedy-btn` → exit **1**, *"--ink — referenced at web/src/styles.css:1668"* |
| `npm run visual`, check 7 | diary 2/11 | **diary 0/9** | the ids put back inside the `ReadoutLine` → exit **1** on all three themes, *"3 children span 33.0px, tallest is 15.0px"*, with the rows population back at 11 |
| `npm run build` | ok, and **blind** | ok | a bad prop type on `Field` → exit **2**, naming the call site. Before this phase the same plant exited **0** |
| `test/mono-census.test.tsx` | — | **10 pass, new** | the survivor table given a row the stylesheet does not have → red; `.msg-tool` restored → red on both claims |
| `test/diary-view.test.tsx` | 20 pass | **24 pass** | the ids moved back into the `ReadoutLine` → **2** red; the stacking rule removed → **1** red |
| class budget | 375/375 | **374/374** | a `.vb-planted` added → exit **1**, *"375 class selectors, against a ceiling of 374"* |
| `npm run lint` | clean/549 | clean/**551** | a duplicate `flex-direction` on `.filed-entry .diary-about` → exit **1**, `lint/suspicious/noDuplicateProperties` |
| `check:type-scale` | 114 | **113** | `.msg-tool`'s `font-size` went with the rule |

### Exit

**Mono 11 → 7**, ceiling lowered in the same commit, every survivor reasoned in one place.
**Class selectors 375 → 374** (`.msg-tool` died), ceiling lowered. Authored `font-size` **114 → 113**,
authored `border-radius` **31**, unchanged. **Panel 10/10, control 2/2, control-geometry / chip / dot /
seg / box-less 0, button geometry 4/4 — every other ceiling unmoved.** One new gate, at a ratchet of 5
and a blocking zero. Suite **245 files / 4,454 tests** (`test/mono-census.test.tsx` adds 10, and three
existing files add 6 between them). Harness **93 tests, three themes, exit 0**, with the diary surface
re-recorded and the other nine untouched. `npm run lint` clean over **551** files. `npm run build` exit
0 and no longer blind.

**`querySelector`/`querySelectorAll` calls with a class in `test/`: 105 → 112, and the seven are named
rather than waved at.** Measured with `grep -rEoh "querySelector(All)?\((['\"])\." test | wc -l`, on the
working tree and on the same command against `git archive HEAD test` — the *106* Phase 11 recorded was
taken by a method not written down beside it and does not reproduce, so this line carries the command.
The seven: **five in `test/diary-view.test.tsx`** — `.filed-state`, `.filed-entry`, and `.diary-about`
three times — every one of which IS the claim, because the structure of that entry is the phase's
subject and a `data-testid` on the group would assert that a test id exists rather than that the readout
line has two children and the group is its sibling; and **two in `test/report-views.test.tsx`** on
`.report-meta dd` and `.vb-readout`, which are the migration itself. `test/mono-census.test.tsx` adds
none: it reaches its element by text and the rest by reading the stylesheet. None of the seven is a
convenience selector on a class this phase could have renamed.

**STILL OPEN FOR THE OWNER, and deliberately not taken here: `raised` IS A FLEX COLUMN, and that is the
only thing keeping two boxes out of `Panel`.** Phase 11's one open decision, unchanged by this phase.
`.popover` and `.gate-card` match `raised` in ground, edge and corner and are refused solely because a
flex column stops their children's vertical margins collapsing. The choice is a `layout` axis on
`raised` (a `block` form, two consumers, which is the bar `ghost` is held to) against leaving two
correct designs counted as findings. **Neither surface is rendered by the harness**, so a spacing change
on either is invisible to every gate this repository has.

---

# Part Four — one state vocabulary

**Status: Phase 13 done 2026-08-21.** The owner looked at the board and said the state indicators
were not substituted. They are right, and the reason is worth stating exactly: **`Chip` was adopted as a
box and every surface kept its own words and its own colours.**

## Measured

**Six independent state vocabularies, 31 `[data-state]` rules**, each mapping its own names to a colour by
hand:

| owner | values | colours it picks |
|---|---|---|
| `.conn-status` | 9 rules — online, connecting, closed, unauthorized, offline, failing | `--accent`, `--accent-2`, `--danger`, `--warn` |
| `.report-chip` | 5 — success, attention, failed/interrupted, running/queued, cancelled | `--accent`, `--accent-2`, `--danger`, `--text` |
| `.ap-agent-state` | 4 — unknown, bad, warn, (ok) | `--muted`, `--danger`, `--warn` |
| `.filed-entry` | 3 — active, actioned, dismissed | `--warn`, `--accent`, `--border` |
| `.ap-chip` | 3 | — |
| `.chat-backend` | 2 — claude-code, opencode | `--accent`, `--accent-2` |

And four mechanisms show a state, not one: a `Chip` with `state=`; a `data-state` attribute on something
that is **not** a Chip (`.conn-status`, `.ap-agent-state`, `.filed-entry`); a `Dot` with `tone=`; and a
runtime-composed class (`ap-bar-${tone}`, `msg-${kind}`).

**Three specific consequences, each measured:**

- **Two tokens mean "needs attention"** — `--accent-2` at 22 uses and `--warn` at 4. Nothing says which.
- **`.conn-status` uses three tokens for three shades of "not right"** — `--danger` for closed, `--warn`
  for offline, `--accent-2` for failing — on one control.
- **`--ok` is one of `Chip`'s five tone names and is referenced ZERO times in `styles.css`.** The
  primitive offers a vocabulary the stylesheet does not use; every surface says "good" with `--accent`.
- **`.filed-entry[data-state='active']` carries `var(--warn, #b8860b)`**, the dead fallback the comment
  200 lines above it says was removed — surviving on the next surface along.

## Phase 13 — the state vocabulary becomes one thing

- **One set of tone names**, `Chip`'s five, and every state name in the app maps onto them in **one
  table** rather than in 31 rules. A surface may not choose the colour of a state.
- **Equivalent states get the same colour.** failed, closed, interrupted, cancelled and bad are one tone;
  attention, offline, active and warn are one tone. If two of those are genuinely different facts, the
  difference is a different tone name, not the same name with two colours.
- **`--ok` is either used or deleted.** A token in a primitive's vocabulary that no surface references is
  a promise nobody kept.
- **The four mechanisms become as few as the evidence allows.** The bar's left border and the chat bubble
  are not chips and may keep their own shape — but not their own vocabulary.

**Gate:** a static check that every `data-state` value in `web/src` resolves to a tone in the table, and
that no rule outside the table decides a state's colour — blocking at whatever it reaches, printed in
full. Plus a browser assertion that the same tone renders the same ink on every surface that shows it,
on all three themes. `test/chip-boxes.test.tsx` already does this for three tones on one surface; the
claim is the same one widened.

## What Phase 13 did, measured

**The table is `web/src/ui/state-tones.ts` — 26 state names onto five tones, in one object.** The CSS
half is five rules in `ui/primitives.css` assigning one custom property, `--tone`, and **no stylesheet
selector anywhere contains `[data-state`**. `npm run check:state-tones` holds both at zero and prints
the whole table, all nine role declarations and all nine `data-state` sites on a passing run.

| | before | after |
|---|---|---|
| rules that decide a state's colour | 26 `[data-state]` + 4 `.ap-bar-*` + 2 `.copilot-status.{ok,down}` + `.msg-error` = **33** | **5** (`.vb-tone-*`, and they assign a property rather than a colour) |
| independent state vocabularies | 6 named + `.copilot-status.{ok,down}` uncounted = **7** | **1** |
| mechanisms that show a state | **4** (`Chip state=`, raw `data-state`, `Dot tone=`, a composed class) | **2** (`data-state` + the tone class; a literal `tone=` on `Chip` for markers that are not states) |
| classes | 374 | **364** — the largest drop of the sweep |
| dynamic class prefixes | 7 | **6** (`ap-bar-*`, `vb-chip-*`, `vb-dot-*`'s tone half → one `vb-tone-*`) |
| authored `font-size` declarations | 113 | **112** (`.msg-error`'s restated `.msg`'s own) |

**The measurement that settled the argument the old comments were making.** Three files said in prose
that these vocabularies "do not fit the five tones", each defending the token its own surface had
picked. Characterised before the change, per theme, `running` rendered as **`--text` on a report chip,
`--accent-2` on the top bar's chip and `--accent` on the auto-pilot bar's rail** — one fact, three
colours, on three surfaces a person reads in one glance. `complete` was `--accent` on the chip and
`--ok` on the rail. "Good" was `--accent` on four surfaces and `--ok` on one.

**`--ok` is USED.** It was one of `Chip`'s five tone names, referenced by a single rule in `styles.css`
(behind a dead `var(--ok, #3fb950)` fallback) and by no chip at all. Seven states are `ok` now —
`online`, `success`, `complete`, `ready`, `actioned`, `available` — and the gate refuses a tone no state
reaches, so it cannot go back to being a promise nobody kept.

**Both dead fallbacks are gone:** `var(--warn, #b8860b)` on `.filed-entry[data-state='active']`, which
the comment two hundred lines above it already claimed had been removed, and `var(--ok, #3fb950)` on
`.ap-bar-complete`, which nothing had noticed.

**Equivalent, and split.** `closed`, `unauthorized`, `failed`, `interrupted`, `cancelled`, `halted`,
`blocked` and `unavailable` are one tone: each means a thing you wanted did not happen and will not
without you, and a colour cannot say which of `lightAdvice`'s five remedies applies. `offline`,
`failing`, `attention` and `active` are one tone: each wants attention while the app keeps working.
`idle` and `stopped` are one tone, which the transport dot already rendered by omission. **`offline` and
`closed` stayed apart** — two facts with two remedies, the order `connection-light.ts` argues at length.
**A backend name is not a state at all**, so `claude-code`/`opencode` have no rows and `.chat-backend`
is `neutral` with the word doing the work.

**`--accent-2` is not a state token.** That is the ruling on the two tokens that both meant "needs
attention": `--warn` is the attention token; `--accent-2` is the palette's secondary hue and keeps its
22 non-state uses.

**Contrast stayed at zero** on all ten surfaces on all three themes, examined counts unchanged, so no
baseline was re-recorded. Every token in every palette clears 4.5:1 on all three grounds — measured
before the change rather than discovered after it.

**One collision left for the owner.** `active` is a row in the table (a filed finding nobody has acted
on) and also this app's selection modifier, on twelve rules — `.tab-btn.active`, `.tag-chip.active`,
`.control-item.active` and nine more — none of whose elements carries a `data-state`. No cascade
interaction, but two facts wearing one word. A gate arm for it was written, ran, reported all twelve
correctly and was removed: a gate that fires on twelve correct rules is a gate that gets switched off.
Fixing it means renaming one of the two.

---

## Phase 14 — the owner's pass over the board

Seven things the owner found in a minute of using the board that fourteen phases and 99 browser checks had
not. Six are one-line fixes and the seventh is the merge Phase 13 stopped one step short of. Recorded
together because the pattern behind them is the interesting part: **every one of them was invisible to a
gate that was measuring the right thing in the wrong place.**

| what he saw | what it was | what could have seen it |
|---|---|---|
| the Start button is too big | `Button size="md"` on a row of `sm` — a step taller than everything beside it | nothing. Check 7 asserts the row does not WRAP, and a taller row does not wrap |
| the collapse arrows are too small to see | six disclosure glyphs at `--t-micro`, the step meant for chip text — about five pixels of ink | nothing. 11px is ON the scale, so type conformance passed |
| Authorise is touching the board | its row was a classless `<div>`; the other six rows in the dock each pad by `0.75rem` | nothing. jsdom loads no CSS and the harness never opens the dock |
| the second line of a card title is cut in half | `-webkit-line-clamp: 2` inside a fixed `height: 112px` that only fits one | nothing — and the FIRST instrument written for it could not either. See below |
| I can't find the column scrollbar | `thin`, with a `--border` thumb on a transparent track, one token from the panel behind it | nothing, and still nothing: headless Chromium draws overlay scrollbars |
| the bar's tail is one undifferentiated queue | selector, state and three buttons at equal spacing — two statements and three actions | nothing |
| the state indicators are four different things | four shapes, three sizes, three answers to "where is the explanation" | nothing. Phase 13 unified the COLOUR and left the shape |

**Phase 13 did half the job and said so.** It gave the app one state vocabulary — five tones, one table, no
surface choosing a colour — and it left four separate mechanisms for DRAWING a state: a 12px dot with a
word and a balloon, a bordered pill with no dot and a tooltip, a 7px dot that became a button only once
something broke, and a full-width row with two numbers glued on by ` · `. They agreed on the colour and on
nothing else. `ui/StatusChip.tsx` is the fifth mechanism that replaces all four, and the two rulings in it
are the owner's: every indicator is **clickable in every state**, and the explanation lives in the balloon
rather than in a `title`.

**A control that only exists once something is broken is one nobody has ever pressed.** The agent chip was
a `<span>` while the agent was healthy and a `<button>` once it was not, and the old CSS defended that at
length — *"the whole point of this element is that it does NOT read as a control"*, and *"it IS a button
precisely when there is something wrong"*. Both sentences are coherent and both are withdrawn: the
affordance appeared for the first time at the exact moment a person needed it, on the surface they were
already frustrated with. A healthy state's balloon is not an invented reassurance either — `agentStatus`
has always written one sentence per state and hidden it in an attribute.

**364 → 362 classes.** Seven died, five arrived, and the interesting pair is `.conn-pop-{head,detail,next}`
against `.ap-agent-{heading,detail,next}`: two copies of one balloon's prose, 150 rules apart, which had
already drifted — one gave the heading a bottom margin and the detail none, the other gave both `0.35rem`,
which is `0.35rem` of gap in block flow and `0.7rem` inside a flex column. `test/panel-twenty.test.tsx`
pinned the second pair as the reason `.popover` cannot be a `raised` Panel; that reason is now gone, which
is recorded there rather than quietly deleted.

**The check written for the card titles was green and worthless, for one commit.** It counted
`getClientRects().length`, which is one rect per line box of an *inline* formatting context and exactly one
rect for a block element whatever it contains. Planting the old two-line clamp back left it passing. Height
over computed `line-height` is the instrument that sees it — and with the clamp restored it reports **every
title on the board at two lines**, not just the long one, because a 180px column wraps `Sample product
card`. That is the seventh gate in this document to have been proved worthless by a planted defect, and the
count is the argument for the practice.

**The scrollbar is the one claim here that is NOT held by a gate, and it is worth being exact about why.**
The only instrument that would prove pixels is the gutter the browser reserves, `offsetWidth -
clientWidth`. It reads 0 in this harness under every flag spelling tried — `OverlayScrollbar`,
`OverlayScrollbars`, the Fluent variants — because headless Chromium draws overlay scrollbars, which
occupy no layout. What check 12 holds instead is the CASCADE: `.column-body` computes the `auto` width and
the opaque two-token colour pair it declares, rather than the `thin`/`--border`-on-transparent the
app-wide `*` rule would give it by inheritance. That is how this regresses in practice. It is not proof
that the bar is wide enough to see; that part was checked by eye.

**And the assertion that nearly shipped vacuous, for the record.** The track-visibility check was first
written as `not.toContain('transparent')` — against a computed value, where `transparent` resolves to
`rgba(0, 0, 0, 0)`. It could never have fired against the rule it exists to reject. Found by feeding both
forms through the pattern rather than by reasoning about the spec. The pattern itself was wrong too:
splitting `rgb(127, 154, 163) rgb(17, 28, 34)` on whitespace gives six tokens, not two, because the commas
inside a colour function carry spaces.

**The fixture grew three cards, and that is a finding about the harness rather than housekeeping.** A
column shows three fixed-height tiles and then scrolls, and every board in the scaffolded fixture had ONE
card — so no check in this file could have said anything about a scrolling column, and none of them
noticed they could not. One of the three carries a title far too long for a tile, for the same reason: a
title that fits cannot distinguish "clamped to one line and ellipsised" from "clamped to two and cut
through the middle".

## Risks, and what would stop this

- **Class renames break tests.** There are **106** `querySelector('.class')` calls in the React tests — Phase 9 migrated one and its own characterisation suite added five, all five of which ARE the subject (`.vb-field` and `.vb-label`, whose treatment is the claim), the same shape as Phase 4's; 102 before it, and Phase 8 migrated six, four to `data-testid` and two to a `testId` the primitive takes as a named prop, and moved a seventh assertion off an exact-`className` comparison that a composing primitive would have pinned; 108 before it and unchanged across Phase 5b, which took two out and put two back and says so under *Selector migrations*; 127 before Phase 5, which migrated nineteen —
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
