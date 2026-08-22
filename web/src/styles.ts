// THE CASCADE, IN ONE PLACE. `styles.css` — 116KB, 309 classes, 22 sections in one file — is a file per
// layer surface now, plus the primitive layer above them, and this is the only list of them that exists:
// the app loads it, the Storybook preview loads it and `test/css-box.tsx` resolves boxes through it.
// 59 sheets: 50 at the split, 55 once the atom layer gave each of the six atoms a file of its own, and 59
// now that `ui/primitives.css` has become the seven molecule sheets it always was — six in, one out, and
// `organisms/topbar/top-tabs.css` gone with `.tab-btn` and `.topbar-tabs`, its only two rules.
//
// `npm run check:split` PROVED THE SPLIT WAS A MOVE — the 47 concatenated in this order were the old
// file byte for byte — and it is gone, with its 116KB witness, in the commit that put the hand-written
// lengths onto the space scale. That commit changes 176 declarations on purpose, so the claim is false
// by design from here on, and a gate nobody can run pointing at a file nobody reads is worse than none.
// What replaced it as the guard on this ORDER is `npm run visual`: `ui/primitives.css` moved to the end
// put a 15.5px span in a 14.0px flex row on all three themes, which is 21 failing checks.
//
// ONE LIST RATHER THAN TWO, and that is the whole reason this is a module and not 47 imports in
// `main.tsx`. `.storybook/preview.tsx` already carried a second copy of the four-line version with a
// comment saying the order was load-bearing; a second copy of a 47-line version would have drifted from
// the app's cascade silently, and a workbench showing a cascade the app does not have is worse than one
// showing nothing.
//
// THE ORDER IS THE OLD FILE'S OWN ORDER, and it is load-bearing rather than tidy. Equal-specificity
// rules are decided by source order, so every part is imported at the position its bytes held inside
// `styles.css`. That is what made the split a move, and it is what still has to hold: `npm run visual`
// reports drift on the surfaces where two rules meet, which is the only instrument left now that the
// byte-identity gate has gone.
//
// Bare side-effect imports, so biome's import sorting leaves them where they are: each one is a barrier
// rather than a member of a sortable group. Sorting them would be a silent cascade change.
//
// SIX PARTS HOLD A RULE THAT BELONGS TO A DIFFERENT SURFACE, and they hold it deliberately: the old
// file scattered a handful of rules away from their own section, and gathering them would move them in
// the cascade, which is a change rather than a move. They are the backlog `npm run check:layers`
// reports, and the phase that moves the components is the phase that re-homes them:
//   `.push` and `.switch-btn.active`  in organisms/topbar/topbar.css   — app-wide, not the top bar's
//   `.mp`                            in organisms/shared/confirm.css  — the model picker's anchor
//   `.link-title` / `.links-*`       in organisms/cards/card-view.css — the link picker's, shared
//   `.drop-line`                     in pages/control/control.css     — the board's drag indicator
//   `.gate-preview code`             in atoms/prose.css               — one rule for two surfaces
//   `.cv-*` overrides                in molecules/inline-field.css    — the card view's editable face
// `.tab-badge` in pages/execution/execution.css WAS THE SEVENTH and it is discharged rather than moved:
// the top bar's attention count is `Menu`'s `badge` option, so the rule is deleted and the stray with it.

// Geometry before colour, and both before anything that spends them: the primitives are one layer and
// the split is what `npm run check:tokens` asserts.
import './design/tokens.css';
import './design/themes.css';
// BEFORE every surface sheet, so a surface can still override a primitive's COLOUR at equal specificity
// — the emergency stop is a ghost button with a danger hover, and the connection light tints its own
// dot. What stops that override becoming a padding is `npm run check:radius-scale`, not the cascade.
//
// SEVEN FILES WHERE `ui/primitives.css` WAS ONE, AND THE POSITION IS THE POINT: the six atoms took their
// own sheets and they are imported here, at the byte position that one file held, so the split is a move.
// The order inside the group is `primitives.css`'s own order wherever two of these contend at equal
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
// `.vb-readout-block` WAS THE TAIL OF `atoms/readout.css` and it is `FigureRow`'s, not `Readout`'s — a
// molecule's class in an atom's sheet, kept there with a comment saying the phase that moved the molecules
// would move it. Imported here, at the byte position that tail held, so it is a move.
import './molecules/figure-row.css';
import './atoms/text.css';
// `ui/primitives.css` IS GONE, AND THESE SIX SHEETS HOLD ITS BYTES IN ITS ORDER. It was "what is left of
// the primitive stylesheet" — the tone table, the pip, the status chip, the segmented control, the field,
// the select trigger and the notice — which is the MOLECULE layer, waiting for the phase that moved the
// molecules. Each is imported at the position its rules held inside that file, so the dissolution is a
// move: the tones first, then the pip and the chip that wears it, then the segmented control's position
// (which `Tabs grouped` now occupies, with `Menu` beside it), then the field and its trigger, then the
// notice. `.vb-twist` and `.vb-clip` went UP into `atoms/text.css` instead — they are a type step and an
// overflow, they belong to no component, and `check:radius-scale` requires the first to sit in the
// primitive layer because two of its six consumers are inside a `<Button>`.
import './molecules/tones.css';
import './molecules/status-chip.css';
import './molecules/tabs.css';
import './molecules/menu.css';
import './molecules/field.css';
import './molecules/notice.css';

// AFTER the primitives although it is a design file, and the reason is BYTES rather than cascade: the
// UA control reset opened `styles.css`, and the phase that made this list a list may not move a rule.
// The cascade argument that stood here was wrong, and was withdrawn after it was tested: it claimed
// `*`, `body` and `:focus-visible` were decided by order against `ui/primitives.css`, and that file
// declares none of the three — its only non-class selectors are `button.vb-chip`, `button.vb-surface`
// and `select.vb-ctl`, all (0,1,1) and so above every reset rule here whatever the order. Lifting
// this above the primitives was planted and changed NOTHING the browser harness could see, on any of
// the three themes. It stays where its bytes were, and the browser harness is what pins the position —
// not because this pair contends, but because the pair below it does: `ui/primitives.css` moved to the end
// put a 15.5px span in a 14.0px flex row on all three themes.
import './design/reset.css';
import './templates/app-shell.css';
import './organisms/topbar/topbar.css';
import './molecules/popover.css';
import './templates/globals.css';
import './templates/work-area.css';
import './organisms/board/board.css';
import './pages/gate/gate.css';
import './organisms/shared/modal.css';
import './organisms/settings/settings.css';
import './organisms/shared/confirm.css';
import './organisms/shared/model-picker.css';
import './organisms/copilot/session-notice.css';
import './organisms/cards/card-view.css';
import './organisms/shared/modal-foot.css';
import './organisms/diary/diary-refresh.css';
import './organisms/dock/dock.css';
import './organisms/cards/cards-pane.css';
import './organisms/skills/card-skills.css';
import './molecules/inline-field.css';
import './organisms/cards/raw-pane.css';
import './organisms/copilot/copilot.css';
import './design/motion.css';
import './pages/control/control.css';
import './pages/explorer/explorer.css';
import './organisms/shared/confirm-typed.css';
import './pages/control/inline-rename.css';
import './templates/editor-layout.css';
import './atoms/prose.css';
import './pages/control/resources.css';
import './organisms/cards/dispatch.css';
import './organisms/runs/reports.css';
import './pages/execution/execution.css';
import './organisms/skills/skill-editor.css';
import './organisms/settings/sandbox.css';
import './organisms/board/tile-states.css';
import './organisms/runs/ledger.css';
import './organisms/autopilot/halt.css';
import './organisms/signin/signin.css';
import './organisms/autopilot/ap-chip.css';
import './organisms/diary/diary.css';
import './organisms/suggestions/suggestions.css';
import './pages/log/log.css';
import './organisms/autopilot/autopilot-bar.css';
