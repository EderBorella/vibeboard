// THE CASCADE, IN ONE PLACE. `styles.css` — 116KB, 309 classes, 22 sections in one file — is a file per
// layer surface now, plus the primitive layer above them, and this is the only list of them that exists:
// the app loads it, the Storybook preview loads it and `test/css-box.tsx` resolves boxes through it.
//
// 41 SHEETS WHERE THERE WERE 59, AND THAT IS THE LAYER TREE FINALLY ARRIVING — docs/design-system.md,
// *The atomic revamp: the layer tree*. The 47 parts the split
// produced were an artefact of the BYTE-IDENTITY CONTIGUITY CONSTRAINT and never of the tree: a rule could
// only leave `styles.css` at the byte position it already held, so a surface whose rules were scattered
// across four sections became four files. The tree asks for one `.css` beside every component and every
// organism directory, and twelve directories held two to five. They are merged here — each merged sheet
// imported at the position its FIRST member's bytes held, so the order among the parts is unchanged and
// only their position relative to other directories moves. Every directory is now at one sheet except the
// five that are one-per-COMPONENT by construction: `design/` (4), `atoms/` (6 + the prose surface),
// `molecules/` (7), `organisms/shared/` (Modal, List/Row, and the two callers that live beside them) and
// `templates/` (3).
//
// `npm run check:split` PROVED THE SPLIT WAS A MOVE — the 47 concatenated in this order were the old
// file byte for byte — and it is gone, with its 116KB witness, in the commit that put the hand-written
// lengths onto the space scale. What replaced it as the guard on this ORDER is `npm run visual`:
// `ui/primitives.css` moved to the end put a 15.5px span in a 14.0px flex row on all three themes, which
// is 21 failing checks.
//
// ONE LIST RATHER THAN TWO, and that is the whole reason this is a module and not 41 imports in
// `main.tsx`. `.storybook/preview.tsx` already carried a second copy of the four-line version with a
// comment saying the order was load-bearing; a second copy would have drifted from the app's cascade
// silently, and a workbench showing a cascade the app does not have is worse than one showing nothing.
//
// Bare side-effect imports, so biome's import sorting leaves them where they are: each one is a barrier
// rather than a member of a sortable group. Sorting them would be a silent cascade change.
//
// THE SEVEN MISFILED STRAYS ARE DISCHARGED, and this is the phase that had to do it — after the components
// moved, nothing notices. What each one was and where it went:
//   `.push` / `.switch-btn.active`  topbar.css   → templates/app-shell.css   (app-wide, not the bar's)
//   `.mp`                           confirm.css  → organisms/shared/shared.css (with its own picker)
//   `.link-title`                   card-view.css → DELETED — it IS `.vb-clip` plus a muted ink
//   `.drop-line`                    control.css  → organisms/board/board.css (the board's drag line)
//   `.gate-preview code`            prose.css    → DISCHARGED as a `code` type selector: it named two
//                                                  SURFACES from inside an atom's sheet
//   `.cv-*` overrides               inline-field.css → organisms/cards/cards.css
//   `.tab-badge`                    execution.css → discharged in the molecule layer with `Menu`'s badge

// Geometry before colour, and both before anything that spends them: the primitives are one layer and
// the split is what `npm run check:tokens` asserts.
import './design/tokens.css';
import './design/themes.css';
// BEFORE every surface sheet, so a surface can still override a primitive's COLOUR at equal specificity
// — the emergency stop is a ghost button with a danger hover, and the connection light tints its own
// dot. What stops that override becoming a padding is `npm run check:radius-scale`, not the cascade.
//
// The order inside the group is `ui/primitives.css`'s own order wherever two of these contend at equal
// specificity, and three pairs do:
//   chip BEFORE readout   — `.vb-readout` puts the mono face on `.board-archive` and `.tag-chip`, and
//                           `.vb-chip` declares `font-family: inherit`. Both (0,1,0).
//   chip BEFORE primitives — `.vb-status` is a step up ON a chip, and `.vb-chip` declares `font-size`.
//   control BEFORE readout — `Control mono` and the readout both name a `font-family`, and `.vb-ctl`
//                           declares `font: inherit`, which resets the family.
// `atoms/prose.css` is NOT in this group and is not an atom sheet: it is the markdown surface, and it
// keeps the position its bytes had further down.
import './atoms/button.css';
import './atoms/chip.css';
import './atoms/surface.css';
import './atoms/control.css';
import './atoms/readout.css';
import './molecules/figure-row.css';
import './atoms/text.css';
// `atoms/stack.css` LAST IN THE ATOM GROUP, and the position is a claim rather than a habit: every rule in
// it is `.vb-stack[data-…]` at (0,1,1) or `.vb-stack > [data-flex]` at (0,1,1), so nothing above can
// outrank it on specificity and nothing below needs to. It contends with no other atom — no other sheet in
// this group declares `gap`, `flex-direction` or `align-items` on a class these elements carry.
import './atoms/stack.css';
// THE MOLECULE LAYER, at the byte position `ui/primitives.css` held. `molecules/field.css` ABSORBED
// `molecules/inline-field.css` in this phase, which is the merge the molecule layer argued for: `Field`
// took `InlineField` as an option and the two sheets stayed apart for a phase. The five `.cv-*` overrides
// that file also held are the card view's and went with the card view. The move is upward in the cascade,
// from after `design/reset.css` to before it, and it is safe by specificity rather than by luck: the only
// thing the reset says about these boxes is `button, input, select, textarea { font-size: inherit }`, a
// (0,0,1) type selector that `.inline-view` and `.inline-edit` outrank whatever the order.
import './molecules/tones.css';
import './molecules/status-chip.css';
import './molecules/tabs.css';
import './molecules/menu.css';
import './molecules/field.css';
import './molecules/notice.css';
// POPOVER JOINS THE MOLECULE GROUP, and until this phase it was three sheets down among the surfaces —
// after `templates/app-shell.css` and `organisms/topbar/topbar.css`, where its bytes fell. It could not
// move while `organisms/shared/list.css` sat below the surfaces: lifting the shared organisms above them
// without lifting this would have put an ORGANISM above a MOLECULE, which is the layer order backwards.
// The two moves are one move. Verified by an independent flip analysis rather than by reasoning: no
// contending pair in the tree changes order — see the note on the shared organisms below.
import './molecules/popover.css';

// AFTER the primitives although it is a design file, and the reason is BYTES rather than cascade: the
// UA control reset opened `styles.css`, and the phase that made this list a list may not move a rule.
// Lifting this above the primitives was planted and changed NOTHING the browser harness could see, on any
// of the three themes. It stays where its bytes were, and the browser harness is what pins the position —
// not because this pair contends, but because the pair below it does: `ui/primitives.css` moved to the end
// put a 15.5px span in a 14.0px flex row on all three themes.
import './design/reset.css';
// THE TWO SHARED ORGANISMS, ABOVE EVERY SURFACE SHEET — WHICH IS WHAT THE PARAGRAPH THAT USED TO STAND
// HERE SAID WAS PHASE 7'S JOB. It was at `.modal-*`'s byte position, five surface sheets down
// (`templates/app-shell.css`, `organisms/topbar/topbar.css`, `templates/work-area.css`,
// `organisms/board/board.css`, `pages/gate/gate.css`), so an equal-specificity override of a `.vb-list` or
// `.vb-row` property in those five LOST. One did: `.gate-list`'s 6px gap became 2px silently, and the
// repair was a (0,2,0) selector bought to outrank a sheet that should never have been above it.
//
// IT WAS NOT MOVED IN THE ORGANISM PHASE ON PURPOSE, and the recorded reason was that doing so "would
// invalidate the phase's 0-flipped-pairs proof". That reason does not survive this phase: the proof was
// the instrument, not the goal, and it is re-run here OVER THIS REORDER. Measured, over all 508 rules:
// **47 contending pairs** in the tree (equal specificity, a shared class token, a shared property), of
// which **3 change relative order** and all three are the same false positive — `.vb-row-hit.active`
// against `.switch-btn.active`, `.board-archive.active` and `.tag-chip.active`, which overlap ONLY on
// `.active`, the app's one selection word. No element can carry two of those: `.vb-row-hit` is emitted
// by `Row interactive` and nothing else, and the other three are on a `Button` and two `Chip`s.
// **Excluding `.active` from the overlap, zero pairs flip.**
//
// `list.css` AFTER `atoms/surface.css` IS STILL LOAD-BEARING and is unchanged: the UA list reset in it is
// keyed on the element for that reason — see that file. `shared.css` after `list.css` for the same reason
// one layer up: `.signin-row` declares `display`, `align-items` and `gap` at `.vb-row`'s own specificity.
import './organisms/shared/modal.css';
import './organisms/shared/list.css';
import './organisms/shared/shared.css';
// `templates/globals.css` IS GONE INTO THIS FILE: it was one rule, `.empty`, and a one-rule sheet for a
// class the shell owns is a file with nothing in it. `.control-blank` was that rule a second time, four
// import lines away, and it is deleted rather than merged.
import './templates/app-shell.css';
import './organisms/topbar/topbar.css';
import './templates/work-area.css';
import './organisms/board/board.css';
import './pages/gate/gate.css';
import './organisms/settings/settings.css';
import './organisms/copilot/copilot.css';
import './organisms/cards/cards.css';
import './organisms/diary/diary.css';
import './organisms/dock/dock.css';
import './organisms/skills/skills.css';
import './design/motion.css';
import './pages/control/control.css';
import './pages/explorer/explorer.css';
import './templates/editor-layout.css';
import './atoms/prose.css';
import './organisms/runs/runs.css';
import './pages/execution/execution.css';
import './organisms/signin/signin.css';
import './organisms/suggestions/suggestions.css';
import './organisms/autopilot/autopilot.css';
