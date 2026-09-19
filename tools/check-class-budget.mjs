#!/usr/bin/env node
//
// Two claims about the CLASS SELECTORS in every stylesheet under web/src.
//
//   1. Every one of them is referenced from web/src — literally, or through a class name composed at
//      run time from a prefix and a value. BLOCKING at zero.
//   2. How many there are, against a ratchet. BLOCKING on any increase. The target is 146.
//   3. How many LAYOUT classes each surface names, against a per-surface ceiling of 4. A ratchet on the
//      COUNT OF SURFACES over that ceiling — see PER_SURFACE below.
//
// A NAIVE IMPLEMENTATION OF CLAIM 1 DELETES LIVE CODE, and this is the check docs/design-system.md's
// *Risks* section was written to stop being written badly. Classes are named nowhere as literals when
// they are built from a prefix and a value: `` `msg-${it.kind}` `` makes the chat bubbles, and
// `` `vb-tone-${tone}` `` makes the five state colours the whole app shares. A literal grep finds none of
// them — and deleting them breaks the state colours ONLY in the states a person sees when something has
// already gone wrong. A board that has not failed anything looks perfectly correct; the colour that says
// a run halted is the one that has gone. Nothing in the suite would catch it either: the browser harness
// measures a board in one state, and every React test runs in jsdom.
//
// `ap-bar-{running,halted,complete,stopped}` was the other half of that sentence until Phase 13, which
// deleted all four: the bar's rail takes `--tone` from the one table now. `vb-chip-${tone}` and
// `vb-dot-${tone}` went the same way, so three composing prefixes became one.
//
// SO COMPOSITION IS RESOLVED RATHER THAN ALLOWED FOR. The document offers two implementations — resolve
// the template literals, or keep an explicit allow-list of prefixes with the composing `file:line`
// beside each — and says of the second that it is "the cheaper of the two and the one that rots: it needs
// its own check that every prefix in it still has a composing call site, or it becomes a licence to keep
// dead classes". This is the first, which cannot rot for a structural reason: both halves of a composed
// name are read out of the source, so a prefix whose call site is deleted stops resolving anything and
// its classes go back to being findings.
//
// A class is REFERENCED when either:
//   (a) its name occurs as a whole token in web/src/**/*.{ts,tsx} — comments stripped, so a class named
//       only in a comment is dead. Several comments in this repository name classes they have just
//       removed, which is exactly the case that must not count as a reference; or
//   (b) it is `prefix` + `suffix`, where `` `prefix-${` `` appears in a template literal in the code and
//       `suffix` appears as a quoted string token somewhere in the corpus. Both halves have to be real:
//       `ap-bar-running` resolves because `` `ap-bar-${model.tone}` `` is at AutopilotBar.tsx and
//       `'running'` is a member of AUTOPILOT_STATES, while `ap-bar-runningx` resolves as neither.
//
// WHAT IT DELIBERATELY DOES NOT CATCH: a class that is referenced but dead — a `className` on an element
// that never renders. That is a different claim needing a different instrument, and the harness's element
// census is the closest thing to it.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classesOf, rulesOf, shapedRules } from './lib/css.mjs';
import { codeOf, lineOf, walk as walkFiles } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
// EVERY SHEET IN THE CORPUS, DISCOVERED RATHER THAN LISTED. It was the two names `styles.css` and
// `ui/primitives.css`; the split made those 48 files, and a hand-written list of 48 is a list that goes
// stale the first time a phase adds a layer sheet — which would drop its classes out of the count
// silently, and the count is a ratchet. The list below is the opposite direction and is safe for it: it
// only SPLITS a total that is already discovered, so a sheet missing from it lands in the other column.
// Documentary here — the ratchet is on the UNION — but the split of the count into "what the shared
// layer names" and "what the surfaces name between them" is the pair the record quotes.
// FOURTEEN SHEETS AND NOT SEVEN AS OF THE MOLECULE LAYER, and `ui/primitives.css` is not among them
// because it no longer exists: what was left of it — the tone table, the pip, the status chip, the
// segmented control, the field, the select trigger and the notice — WAS the molecule layer, and it is
// seven sheets beside the six atoms now. Reading only the atoms would have moved 29 classes into the
// surfaces' column overnight, which is the same mistake the atom phase caught one layer down.
const PRIMITIVE_LAYER = [
  ...['button', 'chip', 'control', 'readout', 'surface', 'text', 'stack'].map((name) =>
    join('web', 'src', 'atoms', `${name}.css`),
  ),
  ...['tones', 'status-chip', 'tabs', 'menu', 'field', 'notice', 'figure-row'].map((name) =>
    join('web', 'src', 'molecules', `${name}.css`),
  ),
];

// THE RATCHET, and the number is what the tree holds today rather than what the plan wants. The target is
// **146** and it is not reached.
//
// TWO NUMBERS STOOD FOR ONE START AND THIS FILE HELD THE WRONG ONE. It said 443; docs/design-system.md
// says 457. Measured with this file's own reader over the tree at each commit: **457** at `85cfa06`
// (2026-08-20, the last commit before any of this work), **361** at `0f983f2` (2026-08-22, the commit the
// seven-phase plan starts from), **305** now. 443 reproduces at no commit and is withdrawn. So there are
// two honest starts and they answer different questions: the design-system work took 457 → 361, and these
// seven phases took 361 → 305. THE SEVEN-PHASE PROGRAMME ENDS
// HERE, so this is the closing number and the shortfall is the owner's to rule on rather than a gate's to
// hide. The derivation of 146, the gap, and where the gap sits are all in `CLASS_TARGET` below, and they
// are written into `docs/design-system.md` as 183 was.
//
// WHERE THE SURFACE CLASSES LIVE, counted per directory rather than estimated: runs 35, board 32,
// copilot 27, cards 25, autopilot 22, diary 17, execution 12, explorer 11, skills 10, control 9,
// suggestions 8, gate 8, topbar 6, dock 3, signin 3, settings 2 — **230 summed, 213 distinct** across the
// sixteen feature directories. 17 of the 230 are counted twice because two feature sheets declare them.
//
// `organisms/shared/` WENT FROM 26 TO 42 IN THIS PHASE AND THAT IS A REAL COST, stated where the number
// is. Thirteen classes moved there to close `check:layers` — each one a shape two features wear, each one
// named after whichever feature wrote it first. It buys the structural claim (a class lives in a directory
// that says who may read it) and it does NOT buy a smaller number. The target wants ten there.
//
// AND THE 42 IS NOT 41: `.reports-forgiven.vb-text-error`, the contrast repair this phase made, names
// `vb-text-error` inside this sheet, so it joins this term. It adds no class NAME, so the ratchet below
// does not move. A term can grow while the union does not, which is the reason the union is the ratchet.
//
// "NINE OF THE THIRTEEN ARE TYPE FACES" WAS WRONG AND IS WITHDRAWN. Classified from the declarations:
//   FACES, reachable by a `Text` option (4)      `.control-tag` (uppercase + track + `--accent-2`),
//                                                `.filed-title` (`--t-lead`/1.5/`--text`),
//                                                `.signin-row-label` (`--t-body` + `word-break`),
//                                                `.report-chip` (uppercase + track, plus a `flex`)
//   PART FACE, PART SOMETHING ELSE (3)           `.settings-section` (a face plus a `border-bottom` and
//                                                two margins), `.diary-empty` (a flex column with a gap),
//                                                `.control-new` (ink only)
//   NOT FACES AT ALL, and no `Text` ruling reaches them (6)
//                                                `.tag` (a ground), `.cv-link-btn` (`fit-content` + a
//                                                hover border), `.control-empty` (padding),
//                                                `.report-stop` (flex + hover colour),
//                                                `.reports-forgiven` (flex-basis + opacity), and
//                                                **`.signin-row`**, which is display/align/gap/padding/
//                                                border — that is a `Row`, and its own comment admits it
//                                                re-declares three of `.vb-row`'s at equal specificity and
//                                                wins only on sheet order.
// So "a surface may not have a type face of its own" reaches AT MOST 7 of the 13 and cleanly 4. The
// collapse is worth about that, not thirteen.
//
// AND 10 OF THE 42 ARE NOT SHARED AT ALL: `.mp`, `.mp-badges`, `.mp-chip`, `.mp-def-tag`, `.mp-empty`,
// `.mp-filters`, `.mp-list`, `.mp-pick-bot`, `.mp-pick-top`, `.mp-star` — the model picker's own family,
// ONE surface, filed here only because §5.2 sends `models/` to `organisms/shared/`. Measured consequence:
// they are exempt from the per-surface ceiling of 4 AND from `check:layers`'s cross-surface claim, because
// `organisms/shared/` is an open layer. As `organisms/models/` this term would read 32, there would be a
// seventeenth feature directory at 10, and the per-surface over-budget count would go 13 → 14, which
// breaks that ratchet. Recorded rather than done: it is a directory rename against a named §5.2 placement.
//
// 183 WAS ITSELF WITHDRAWN — see CLASS_TARGET below, which is 146. What follows is why 183 replaced an
// earlier 150, kept because it is the record of how a target gets derived from an uncounted term twice:
//
// THE TARGET IS 183 AND NOT THE PLAN'S "UNDER 150", which is withdrawn. 150 was derived from ten bespoke
// surfaces at about eight layout classes each plus roughly thirty primitive classes, and neither term was
// counted: the tree holds **17** surfaces (16 feature directories under web/src besides ui/ and api/, plus
// markdown.tsx) and **47** primitive classes. At the plan's own allowance that is 17 × 8 + 47 = 183, so
// 150 was not merely missed — it was excluded by the arithmetic it was derived from. The derivation and
// its commands are in docs/design-system.md under *Under 150 is WITHDRAWN*.
//
// A CEILING AND NOT THE TARGET, deliberately: a blocking gate pointed at a backlog has to be bypassed on
// every commit, which teaches everyone to ignore it — the same argument that kept radius conformance
// reporting until Phase 3 drove it to zero. Lower this as the sweep continues; the commit that reaches
// 183 is the commit that sets it to 183 and deletes this paragraph. NEVER raise it.
// 377 before Phase 9, 375 after it, measured: three classes died in styles.css — `.theme-select`,
// `.mp-prov` and `.link-option` — and `.vb-field-check` was added to primitives.css. The other eight
// control classes the phase touched survive with a declaration only the surface can make, which is the
// same result Phase 3 measured on its 27 and Phase 8 on its nine.
// 375 before Phase 12, 374 after it: `.msg-tool` died — a tool name is a `Readout` `small` `accent`, and
// the rule was that primitive written out by hand.
// 374 before Phase 13, 364 after it, and it is the largest single drop of the sweep. Fifteen died:
// `.ap-bar-{running,halted,complete,stopped}` (the rail is one declaration reading `--tone`),
// `.vb-chip-{neutral,accent,ok,warn,bad}` and `.vb-dot-{neutral,accent,ok,warn,bad}` (ten rules that
// each named a token, replaced by five that name it once), and `.msg-error` (a state's colour picked on
// a surface). Five arrived: `.vb-tone-*`, which IS the table. Plus `.vb-chip-tone` and `.vb-dot-glow`,
// and `.ok`/`.down` off `.copilot-status` — the fifth mechanism, which no census had counted.
// 364 before the status-indicator merge, 362 after it. Seven died — `.conn-status`'s box kept the class
// but `.conn` went with it, and `.conn-pop-{head,detail,next}` plus `.ap-agent-{heading,detail,next}` were
// two copies of one balloon; `.ap-agent-state` went too, with the `button.` qualifier that undid the UA
// styles by hand. Five arrived: `.vb-status`, `.vb-status-{head,detail,next}` — the one copy — and
// `.vb-twist`, which is a font-size for six disclosure glyphs drawn at the chip step. Plus
// `.copilot-authority`, a row that had never had a class and therefore never had the gutter its six
// siblings all have.
// 362 before the owner's second pass, 361 after it: `.ap-transport` lost its whole rule — a `min-width`
// that measured 104px around 49px of ink — and `.ap-chip` moved from the top bar to the auto-pilot bar's
// own chip rather than being added again.
// 361 before the ATOM LAYER, 354 after it, and the arithmetic is 20 out against 13 in:
//   OUT (20)  `.vb-readout-{small,body,plain,accent,accent2,text,quiet}` — a Readout is a TREATMENT and
//             takes the step and the ink of the atom it sits in, so nine classes are one;
//             `.vb-label`, `.vb-label-caps`, `.vb-hint`, `.vb-error`, `.vb-empty`, `.vb-empty-small` —
//             six names for one face times three options, and the last of the six was the fifth
//             declaration for declaration; `.vb-label-rail`, `.vb-input` and the five `.vb-panel*`,
//             which are renames rather than deletions.
//   IN (13)   `.vb-text` + four modifiers; `.vb-ctl` and `.vb-ctl-mono`; `.vb-field-rail`; the five
//             `.vb-surface*`. Nine of the thirteen are the renames' other half.
// The renames net to zero on purpose and are worth their churn for one reason: one vocabulary, one word
// per thing. `Panel` meant six things in this tree and `.vb-input` named a class that is now a component.
// 354 before the MOLECULE LAYER, 341 after it, and the arithmetic is 21 out against 8 in:
//   OUT (21)  the six families' nineteen — `.tab-btn` `.tab-badge` `.topbar-tabs`, `.chat-menu` and its
//             four, `.dock-tab` `.dock-strip`, `.cards-tab` `.cards-tab-label` `.cards-tab-x`,
//             `.control-tabs` and `.vb-seg` `.vb-seg-cell` `.vb-seg-cell-sm` — minus `.cards-tabs`, which
//             SURVIVES as two declarations no other tab strip has (it is the only one that scrolls and the
//             only one with a rule under it); plus three the plan did not name: `.vb-dot-7`, `.vb-dot-8`
//             and `.vb-dot-12`, because `Dot` had three sizes and exactly ONE consumer, and
//             `.vb-trigger-label`, which is a rename.
//   IN (8)    `.vb-tabs` `.vb-tabs-grouped` `.vb-tab`; `.vb-menu` `.vb-menu-list` `.vb-menu-item`
//             `.vb-menu-backdrop`; `.vb-clip`, which is `.vb-trigger-label`'s other half and now serves
//             three molecules rather than one.
// SIX FACES, SIX SELECTED STATES AND SIX HEIGHTS BECAME TWO COMPONENTS AND SEVEN CLASSES. `.active` is
// not counted here in either direction: it is one name for the whole app and it survives on the toggles.
// 341 before the ORGANISM LAYER, 307 after it, and the arithmetic is 44 out against 10 in:
//   OUT (44)  MODAL, 21 — `.modal-{backdrop,head,title,body,foot}` and `.modal` (6), `.mp-modal-*` (4),
//             `.confirm-{backdrop,body,actions,require}` and `.confirm` (5), `.halt-{backdrop,title,why,
//             hint,error}` and `.halt` (6). Four dialogs, one shape, and the three axes they disagreed on
//             (measure, colour, dismissable) are ATTRIBUTES rather than classes — see modal.css.
//             LIST/ROW, 17 — `.control-item` `.control-item-name` `.control-group-head`, `.mp-item`
//             `.mp-sel` `.mp-def` `.mp-pick` `.mp-name`, `.filed-entry` `.filed-list`, `.diary-entry`,
//             `.suggestions-row`, `.gate-row`, `.report-row`, `.settings-row`, `.resource-row`,
//             `.skill-row`, `.exec-run`, `.archive-item` — minus `.diary-list`, `.gate-list`,
//             `.suggestions-list`, `.blockers`, `.control-list`, `.explorer-list`, `.mp-list`,
//             `.signin-row`, `.dispatch-row`, `.explorer-item`, `.cv-links`, `.links-list`, which SURVIVE
//             carrying a measure or a one-off the shared row cannot know (a 260px width, a `flex-wrap`, a
//             `border-bottom`, a 68ch column).
//             AND FIVE THE PLAN DID NOT NAME: `.link-title` (three overflow declarations that ARE
//             `.vb-clip`, plus a muted ink given up), `.control-blank` (`.empty` a second time, four
//             import lines away), `.control-editor-actions` (`push` on a `.vb-row`), `.control-preview`
//             (the same editor slot as `.control-textarea`, one written as a margin and one as a padding),
//             and `.gate-row`.
//   IN (10)   `.vb-modal` + four; `.vb-list` `.vb-row` `.vb-row-rail` `.vb-row-hit` `.vb-row-main`.
// The renames in it net to zero: `.control-editor{,-head}` → `.vb-editor{,-head}` and `.control-textarea`
// → `.vb-editor-body`, which is the template taking its own names off one feature's stylesheet.
// 307 before TEMPLATES AND PAGES, 305 after it, and the arithmetic is 2 out against 0 in:
//   OUT (2)   `.filed-text` — `font-size: var(--t-body); line-height: 1.5; color: var(--muted)`, which is
//             `Text lead` FOR THOSE THREE DECLARATIONS, at both of its call sites. AND A FOURTH THAT WAS
//             NOT NAMED, which is a geometry change and not a rewording: the old element was a `<p>` and
//             nothing in this tree resets `p`, so it carried the UA's `margin-block: 1em` — 13px top and
//             bottom. `Text`'s base is `margin: 0`. Measured in Chromium against the app's own ordered
//             sheet list: font-size 13px both, line-height 19.5px both, ink `rgb(127,154,163)` both,
//             margins 13/13 → 0/0, and **the filed row goes 120.00px → 94.00px, −26.00px, at both call
//             sites in all three themes**. Tier 4 records no padding, margin, gap or line-height, so the
//             drift baseline reports NOTHING for this — do not read "zero drift" as "nothing moved".
//             The predicted `line-height: 1.45 → 1.5` does NOT happen: `.vb-text-lead` sets 1.5, so the
//             composite is 19.5px before and after. `atoms/Text.tsx` argues for exactly this ("half the
//             lines this replaces were `<p>`s taking the UA's paragraph margins — which nobody chose"),
//             so it is the intended change and not a regression; it is the SIZE of it that was missing.
//             Its twin survives one line away: `.filed-reason` (`diary.css`) is this plus `font-style:
//             italic`, i.e. `Text lead role="hint"` declaration for declaration. First candidate next pass.
//             And
//             `.reports-forgive-error` — `flex-basis: 100%` (what the result line beside it already says)
//             plus `color: var(--danger)`, which is `Text error`.
//   IN (0)    nothing. Nineteen classes MOVED between sheets to take `check:layers` to zero, and a move is
//             not a deletion: `.tag`, `.cv-link-btn`, `.control-{new,tag,empty}`, `.diary-empty`,
//             `.filed-title`, `.settings-section`, `.signin-row{,-label}`, `.report-{chip,stop}` and
//             `.reports-forgiven` to `organisms/shared/`; `.control` and `.gate{,-card,-preview}` to
//             `templates/`; `.pop-wrap` to `molecules/popover.css`. `.vb-readout-block` became
//             `.vb-figure-row`, which is a rename and nets to zero.
// THE PHASE THAT WAS MEANT TO CLOSE THIS NUMBER MOVED FILES, NOT CLASSES, and that is worth stating
// plainly rather than leaving to be inferred from a flat ratchet: the TREE and the COUNT are two
// different claims, and only one of them was reachable by moving 115 files.
// THIS RATCHET GOES UP BY TWO, AND IT IS THE ONLY TIME IN EIGHT PHASES THAT IT HAS. The classes are
// `.vb-stack` and `.vb-fixed`, and the reason it is worth a ratchet increase is that it is the instrument the next commit
// uses to take the number down by roughly a hundred. A census of all 246 surface classes, grouped by the
// SHAPE of what they declare rather than by value, found 63 redundant names inside 27 clusters — a column
// with a gap written six times, a centred row with a gap five times, `flex: none` six times, `margin: 0`
// NINE times. None of them was a bad decision; there was simply no atom that could say "a row with a
// gap", so every surface that needed one named it after itself. Buying that atom for one name is the
// cheapest trade available in this tree, and every option on it is a `data-` attribute precisely so that
// it stays one name — `Modal`'s precedent from the organism phase, applied to layout.
// 221 -> 220 ON 2026-08-31, and the motion phase added NONE of its own.
//
// The first cut of `web/src/atoms/Pulse.tsx` declared two — `.vb-pulse` for an inline-flex row with a
// gap, and `.vb-pulse-dot` for an 8px circle — and the owner had already ruled that a legitimate
// class must not be blocked by this ratchet. Neither turned out to be legitimate. `check:shape-coverage`
// caught the dot at once, because its dot census BLOCKS AT ZERO: `.vb-dot` in molecules/status-chip.css
// is that circle already, tone-aware and `flex: none`, and its 8px is allowed BY NAME in
// `check:box-scale` — where the hand-rolled `calc(var(--mark-h) / 2)` was a third box height, the exact
// thing four phases of this design system went to delete. The wrapper was `Stack gap={2}` written out
// longhand. So the atom spends the primitive layer and declares nothing.
//
// The departure is `.msg-running`, the copilot's `…working` line, deleted with the element it styled
// when `ThinkingIndicator` replaced it. Net −1, and the ceiling is the count with ZERO SLACK: a
// ratchet sitting above the tree is one that would not notice the next class.
// 220 -> 221 ON 2026-09-18, FOR `.wizard-card`, under the ruling recorded above: a legitimate class must
// not be blocked by this ratchet. The setup wizard is a new surface (`pages/wizard/`) and it spends ONE
// name. Its frame declares nothing — `Stack fill scroll justify="center" align="start" pad={[7, 6]}` is
// the four declarations `.gate` writes by hand — and the one thing no atom in this tree can say is a
// MEASURE, so `max-width: var(--measure)` on the card is the whole of it. It could have worn `.gate-card`,
// which is the same box, and that is exactly what it must not do: the browser harness proves the board by
// counting the picker's frame at zero, and a screen that renders with a project OPEN while wearing the
// picker's names would make that proof answer for two screens. Zero slack is restored at 221.
const CLASS_CEILING = 221;
// THE TARGET IS 146, and the derivation is in docs/design-system.md, *The atomic revamp: the class target
// is 146*. Two numbers stood in this tree for two phases — this constant said 183 and the revamp said
// 146 — and the gate PRINTED 183 at the developer, so the reconciliation was the gate's to make. 146 wins because 183's derivation is the one that was withdrawn, by name: 183 = 17 surfaces × 8
// layout classes + 47 primitive classes, where the 8 is recorded as *"inherited from the plan and marked
// as inherited"* — never measured against a surface built to it — and the 47 assumed the shared layer
// stayed a six-primitive set rather than becoming a full atomic layer. The paragraph below that argues for
// 183 is kept as the record of a withdrawn number, not as the target.
//
// 146 IS COUNTED TERM BY TERM: atoms 29 (Button 8, Chip 4, tones 5, Control 1, Text 5, Readout 1,
// Surface 5), molecules 26 (Field 4, Tabs 5, Menu 4, StatusChip 5, Popover 3, Notice 4, FigureRow 1),
// shared organisms 10 (Modal 5, List/Row 5), globals 5, surface layout 76 (19 surfaces × 4).
//
// AND THE GAP AT THE END OF THE SEVEN PHASES IS **159**, WHICH IS NOT A DELETION PROGRAMME ANY PHASE OF
// THE PLAN CARRIED.
//
// THE DECOMPOSITION PRINTED HERE BEFORE WAS WRONG THREE WAYS and it is worth saying how, because the owner
// acts on this number: it read the three terms as `60 vs 55`, `41 vs 10`, `230 vs 76`, whose over-counts
// are 5 + 31 + 154 = **190 rather than 159**; it OMITTED `templates/` entirely; and its 230 was a sum of
// per-directory counts, 17 of which are declared in two feature sheets. Measured 2026-08-23 with this
// file's own reader, mapped onto §5.3's own five terms — `tones.css` under the atoms term and `popover.css`
// under molecules, exactly as §5.3 enumerates them:
//
//   §5.3 term                                          measured   target   over
//   atoms (incl. `tones` 5)                                  33       29     +4
//   molecules (incl. `Popover`)                              33       26     +7
//   shared organisms (`organisms/shared/`)                   42       10    +32
//   globals (`templates/` 17 + `design/` 0 + `prose.css`)    17        5    +12
//   surface layout (16 feature dirs, DISTINCT)              213       76   +137
//   sum of the five terms                                   338      146   +192
//   less classes counted in two or more terms                −33        —      —
//   DISTINCT UNION — and the union is what ratchets         *305*    *146*  *+159*
//
// SO IT IS NOT "ONE TERM". It is ONE DOMINANT term — surface layout, **+137 of the 159, 86%** — plus three
// real secondary ones: `organisms/shared/` +32 (of which 10 are the model picker, above), globals +12
// (all of it `templates/`, which nobody has looked at), molecules +7. Calling it one term writes off about
// fifty classes the owner could act on. The terms do not add to 159 and cannot: 33 classes are in two
// terms, so only the union is ratchetable.
//
// THE CHARACTER OF THE DOMINANT TERM IS KNOWN: **type faces and one-off positions, not boxes.**
// `.tile-title`, `.msg-user`, `.report-meta dd`, `.diary-kind`, `.filed-state`, `.dispatch-title` — a
// surface deciding how ITS words are set. The fourteen big families measured were drawing boxes and the six
// phases before this one took the boxes away.
//
// THE TWO ROUTES, AND BOTH ARE THE OWNER'S CALL RATHER THAN A GATE'S:
//   1. A shared "one-off position" vocabulary. RECORDED AS REFUSED: `docs/design-system.md` refuses it by
//      name, as the utility framework this project exists without, and that refusal stands.
//   2. A ruling that a surface may not have a type face of its own, so face classes become options on
//      `Text`. This is the live one — same shape of change as `Readout` losing its nine options in the atom
//      phase: plannable, measurable, and it changes how the app LOOKS in about a hundred places.
//
// BUT "ROUGHLY 150 FACE CLASSES" IS SUPPORTED BY NO CENSUS IN THIS REPOSITORY, and the one population that
// HAS been classified declaration by declaration — the thirteen in `organisms/shared/`, above — came out at
// 4 certain faces and 7 at the outside. About a third, not two thirds. So before route 2 is ruled on,
// somebody has to count the faces across the 213: an afternoon with the readers that already exist, and it
// converts the headline from "159, character known" into "159, of which N are faces". That census is the
// successor card. `.filed-title` is the cheapest single illustration of what it would find:
// `--t-lead`/1.5/`--text` is `Text lead` with exactly ONE declaration `Text` does not give
// (`color: var(--text)`, where `Text` is `--muted`), so one `Text` option would take it and several like it.
const CLASS_TARGET = 146;

// Anti-vacuity floor on the SELECTOR PARSER, not on the class count: a regex that stops matching reports
// zero findings, exits 0 and looks exactly like success. This one is safe from the trap Phase 3's button
// floor fell into (a floor that fails the run for succeeding) because it is far below the target the
// sweep is driving towards — 183 classes is the goal and 40 is a broken parser.
const PARSE_FLOOR = 40;

// The walk, the line counter and the comment blanker are `tools/lib/source.mjs`; the rule scanner and
// the selector reader are `tools/lib/css.mjs`. One copy each — see that file's header.
// A SMOKE ALARM, NOT A TARGET: 50 css files and a hundred components, floored an order of magnitude
// below each so deleting a file never fails the run. See walk() in lib/source.mjs for why it is here.
const FLOOR = { '.css': 2, '.ts': 10, '.tsx': 20 };
const walk = (ext) => walkFiles(ROOT, CORPUS, ext, FLOOR[ext] ?? 1);

// THE METHOD IS THE DOCUMENT'S, and it has to be: three different answers have been quoted for this
// property, and a target expressed against a number nobody can reproduce is not a target. Strip
// comments, take the selector text before each `{`, skip at-rule preludes, extract every `.name` token,
// count the DISTINCT names — and the union across every stylesheet, because `vb-btn` and `vb-dot` are
// named by the surfaces too.
export function classesIn(css) {
  // `rulesOf` is the brace matcher, `shapedRules` drops the at-rule preludes and `classesOf` reads the
  // `.name` tokens — the same three the other gates use, so a selector this file counts is a selector
  // they see. The file name is documentary here: nothing in the returned set carries it.
  const names = new Set();
  for (const rule of shapedRules(rulesOf('sheet.css', css)))
    for (const cls of classesOf(rule.selector)) names.add(cls);
  return names;
}

// `prefix-${` inside a template literal: the left-hand half of a composed class name.
export function prefixesOf(code) {
  return [...code.matchAll(/([\w-]*[a-z\d])-\$\{/g)].map((m) => m[1]);
}

// Every quoted string token in the corpus: the right-hand half. A tone, a state, a kind, a backend name —
// whatever the value is, it has to be written down somewhere for the composition to produce it.
export function vocabularyOf(code) {
  const out = new Set();
  for (const m of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
    for (const word of (m[1] ?? m[2] ?? '').split(/[\s|,]+/)) if (word) out.add(word);
  }
  // NUMBERS TOO, and they were not a widening for convenience: `Dot`'s size was a `7 | 8 | 12` union, so
  // `` `vb-dot-${size}` `` composed three real classes out of values that are numeric literals rather
  // than quoted strings, and leaving them out reported all three as dead — the exact defect this check
  // exists to prevent, produced by the check itself.
  // THAT CONSUMER IS GONE AS OF THE MOLECULE LAYER: `StatusChip` absorbed the pip, one size is left and
  // `.vb-dot` is a literal. Measured: with this clause removed the census still reports zero
  // unreferenced classes. It stays because a numerically composed name is a real shape and the cost of
  // being wrong about it is a deleted rule, not a missed finding — but it has no consumer today, which is
  // stated here so the next reader is not looking for one.
  for (const m of code.matchAll(/(?<![\w-])\d+(?![\w-])/g)) out.add(m[0]);
  return out;
}

function corpus() {
  return walk('.ts')
    .concat(walk('.tsx'))
    .map((file) => ({ file, code: codeOf(readFileSync(join(ROOT, file), 'utf8')) }));
}

// THE PARSER SELF-TEST, and it goes through the same functions the census does — the lesson from
// check-radius-scale.mjs, whose first self-test carried its own regex and so had no opinion about the
// code under test at all. A fixture the tree cannot move: one literal class, one composed from a prefix
// and a quoted value, one composed from a prefix whose value is written nowhere, and one named only in a
// comment.
const FIXTURE_CSS = `
/* .commented-only { color: red } */
.alpha { color: red }
.beta-ok, .beta-nope { color: red }
@media (min-width: 1px) { .gamma { color: red } }
`;
const FIXTURE_CODE = `
// .commented-only is named here and nowhere else, so it is DEAD.
const kinds = ['ok'];
const a = <div className="alpha" />;
const b = <div className={\`beta-\${kind}\`} />;
const c = <div className="gamma" />;
`;

function selfTest() {
  const names = [...classesIn(FIXTURE_CSS)].sort().join(',');
  if (names !== 'alpha,beta-nope,beta-ok,gamma') return `selector parse: got [${names}]`;
  const code = codeOf(FIXTURE_CODE);
  if (/commented-only/.test(code)) return 'comment stripping: a commented class survived';
  const prefixes = prefixesOf(code);
  if (!prefixes.includes('beta')) return `prefix parse: got [${prefixes.join(',')}]`;
  const vocabulary = vocabularyOf(code);
  if (!vocabulary.has('ok')) return 'vocabulary parse: a quoted value was not found';
  const dead = [...classesIn(FIXTURE_CSS)].filter(
    (cls) => !referenced(cls, [{ file: 'fixture', code }], prefixes, vocabulary),
  );
  // `beta-nope` is the one that must be a finding: the prefix is composed and the suffix is not written
  // anywhere, which is exactly the shape of a renamed dynamic class. `commented-only` is not in the CSS
  // fixture's rules at all (it is inside a comment there too), so it cannot be one.
  if (dead.join(',') !== 'beta-nope') return `resolution: findings were [${dead.join(',')}]`;
  // CLAIM 3'S READER, on a fixture the tree cannot move. Both directions and the exclusion: renaming the
  // two layer prefixes was planted and printed `0 of 0 surface(s)` and exited 0, so a fixture that only
  // proved the positive would have passed with the whole population gone.
  if (surfaceDirOf('web/src/organisms/board/board.css') !== 'board') return 'surface: an organism';
  if (surfaceDirOf('web/src/pages/gate/gate.css') !== 'gate') return 'surface: a page';
  if (surfaceDirOf('web/src/organisms/shared/list.css') !== null) return 'surface: shared is not one';
  if (surfaceDirOf('web/src/templates/app-shell.css') !== null) return 'surface: a template is not one';
  if (surfaceDirOf('web/src/atoms/button.css') !== null) return 'surface: an atom is not one';
  return null;
}

function referenced(cls, sources, prefixes, vocabulary) {
  const token = new RegExp(`(?<![\\w-])${cls.replace(/-/g, '\\-')}(?![\\w-])`);
  if (sources.some(({ code }) => token.test(code))) return true;
  return prefixes.some(
    (prefix) => cls.startsWith(`${prefix}-`) && vocabulary.has(cls.slice(prefix.length + 1)),
  );
}

const sources = corpus();
const allCode = sources.map((s) => s.code).join('\n');
const prefixes = [...new Set(prefixesOf(allCode))];
const vocabulary = vocabularyOf(allCode);

const perSheet = walk('.css').map((file) => ({
  file,
  names: classesIn(readFileSync(join(ROOT, file), 'utf8')),
}));
const union = new Set(perSheet.flatMap(({ names }) => [...names]));
// The two numbers the record quotes, and they are still the two that mean something: what the primitives
// name, and what the surfaces name between them. Printing 48 per-file counts would bury both.
const primitives = new Set(
  perSheet.filter(({ file }) => PRIMITIVE_LAYER.includes(file)).flatMap(({ names }) => [...names]),
);
const surfaces = new Set(
  perSheet.filter(({ file }) => !PRIMITIVE_LAYER.includes(file)).flatMap(({ names }) => [...names]),
);

// Where each dynamic prefix is composed, so a failing run can be read against the source rather than
// against this file's opinion of it.
const sites = new Map();
for (const { file, code } of sources) {
  for (const m of code.matchAll(/([\w-]*[a-z\d])-\$\{/g)) {
    if (!sites.has(m[1])) sites.set(m[1], `${file}:${lineOf(code, m.index)}`);
  }
}

const unreferenced = [...union].filter((cls) => !referenced(cls, sources, prefixes, vocabulary)).sort();

console.log(
  `class budget: ${union.size} distinct class selector(s) across ${perSheet.length} sheet(s) — ` +
    `the ${PRIMITIVE_LAYER.length}-sheet primitive layer ${primitives.size}, the surfaces ${surfaces.size}`,
);
console.log(
  `dynamic composition: ${prefixes.length} prefix(es) resolved against ${vocabulary.size} quoted value(s) — ${[
    ...sites,
  ]
    .map(([prefix, site]) => `${prefix}-* (${site})`)
    .join(', ')}`,
);

if (union.size < PARSE_FLOOR) {
  console.error(`\nonly ${union.size} class selector(s) found, against a floor of ${PARSE_FLOOR}.`);
  console.error(`This check is vacuous: the selector parser has stopped matching the stylesheets. Fix it`);
  console.error(`in tools/check-class-budget.mjs — do NOT lower the floor.`);
  process.exit(1);
}

const parserFault = selfTest();
if (parserFault) {
  console.error(`\nthe class parser is broken: ${parserFault}.`);
  console.error(`Both claims are vacuous — they would report nothing whatever the tree holds. Fix the`);
  console.error(`pattern in tools/check-class-budget.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

// CLAIM 3 — A PER-SURFACE CEILING, and it is what turns the 4-per-surface allowance from an estimate
// into a claim. The 8-per-surface figure the old 183 rested on was never that: the plan records it as
// "inherited from the plan and marked as inherited", never measured against a surface built to it.
//
// THE PER-SURFACE ZERO IS POINTED AT A BACKLOG OF THIRTEEN SURFACES — which is exactly the condition this
// repository refuses to make blocking. It reaches zero when `organisms/runs` gets from 35 to 4, and its
// remainder is type faces rather than boxes, so that is not a commit anybody can write today. Fifteen
// before this phase and thirteen after it: `organisms/settings` (2) and `organisms/signin` (3) came inside
// the allowance, because what they held was two other surfaces' shapes.
//
// SO THE CLAIM IS A RATCHET ON THE COUNT OF OVER-BUDGET SURFACES, and it is the second thing this arm
// lacked. As shipped it set `failed` from nothing at all: the plan's own planted defect — a fifth layout
// class in `organisms/diary/` — moved the printed line from `diary 20` to `diary 21` and contributed
// nothing to the exit code, and the 1 it got came from the 307 ceiling on the way past. Two classes into
// `organisms/dock/`, the ONE under-budget surface, is the plant that reaches THIS claim: it takes dock from
// 3 to 5 and the count from 15 to 16, and it now fails.
//
// A SURFACE'S TALLY IS EVERY CLASS ITS OWN SHEET NAMES, including a shared one it specialises: `autopilot`
// is 20 rather than 19 because `.vb-modal.ap-help` has to name `.vb-modal` to outrank `[data-size]`. That
// is a selector the surface spends, so it counts — but it is why the per-surface figures are a proxy and
// the ratchet is on the COUNT OF SURFACES over the line rather than on any one of them.
const PER_SURFACE = 4;
const OVER_BUDGET_CEILING = 13;
// The 16 feature directories under `organisms/` and `pages/`. `organisms/shared/` is the shared layer and
// not a surface: its classes are `Modal`'s and `List`'s, which every surface spends. Counting them against
// a 4-per-SURFACE allowance would be counting the primitives twice. Its own function so `selfTest` can go
// through the code the census uses — the third thing this arm lacked, and plant G10e is why: renaming the
// two layer prefixes to `organismsXX/`/`pagesXX/` printed `0 of 0 surface(s) over a ceiling of 4` and
// exited 0. Every other claim in this file has a floor and a fixture; this one had neither.
export function surfaceDirOf(file) {
  const path = file.slice('web/src/'.length);
  const scoped = ['organisms/', 'pages/'].find((layer) => path.startsWith(layer));
  if (!scoped) return null;
  const dir = path.slice(scoped.length).split('/')[0];
  return dir === 'shared' || !dir ? null : dir;
}
const surfaceDirs = new Map();
for (const { file, names } of perSheet) {
  if (PRIMITIVE_LAYER.includes(file)) continue;
  const dir = surfaceDirOf(file);
  if (!dir) continue;
  if (!surfaceDirs.has(dir)) surfaceDirs.set(dir, new Set());
  for (const cls of names) surfaceDirs.get(dir).add(cls);
}
// ANTI-VACUITY, and it is the floor G10e walked past. A reader that finds no surfaces reports `0 of 0` and
// exits 0, which reads identically to a tree with four classes per surface. 12 against the 16 that exist.
const SURFACE_FLOOR = 12;
if (surfaceDirs.size < SURFACE_FLOOR) {
  console.error(`\nonly ${surfaceDirs.size} surface directory(ies) found, against a floor of`);
  console.error(`${SURFACE_FLOOR}. The layer prefixes have stopped matching, so this claim is vacuous.`);
  process.exit(1);
}
const overBudget = [...surfaceDirs]
  .filter(([, names]) => names.size > PER_SURFACE)
  .sort((a, b) => b[1].size - a[1].size);
console.log(
  `per surface: ${overBudget.length}/${OVER_BUDGET_CEILING} of ${surfaceDirs.size} surface(s) over a ` +
    `ceiling of ${PER_SURFACE}` +
    (overBudget.length > 0
      ? ` — ${overBudget.map(([dir, names]) => `${dir} ${names.size}`).join(', ')}`
      : ''),
);

let failed = false;

if (overBudget.length > OVER_BUDGET_CEILING) {
  console.error(
    `\n${overBudget.length} surface(s) over the ceiling of ${PER_SURFACE}, against ` +
      `${OVER_BUDGET_CEILING}. A surface that was inside its allowance has left it — the new class belongs` +
      ` in an atom, a molecule or organisms/shared/, not in a sixteenth surface's own sheet.`,
  );
  failed = true;
}

if (unreferenced.length > 0) {
  console.error(`\n${unreferenced.length} class selector(s) referenced from nowhere in ${CORPUS}:\n`);
  for (const cls of unreferenced) console.error(`  .${cls}`);
  console.error(`\nEither delete the rule, or — if the name is COMPOSED at run time — check that the`);
  console.error(`prefix is still built in a template literal and that the value is still written as a`);
  console.error(`string somewhere. Both halves are read from the source; neither is allow-listed.`);
  failed = true;
}

if (union.size > CLASS_CEILING) {
  console.error(`\n${union.size} class selectors, against a ceiling of ${CLASS_CEILING}.`);
  console.error(`This gate is a RATCHET: it blocks an increase, not the backlog. The target is`);
  console.error(`${CLASS_TARGET} — see docs/design-system.md. Merge the new shape into an atom in`);
  console.error(`web/src/atoms/ or a molecule in web/src/molecules/ instead of giving a surface a`);
  console.error(`class of its own.`);
  failed = true;
}

if (failed) process.exit(1);

console.log(`every class is referenced; ${union.size}/${CLASS_CEILING} against a target of ${CLASS_TARGET}`);
