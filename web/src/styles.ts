// THE CASCADE, IN ONE PLACE. `styles.css` — 116KB, 309 classes, 22 sections in one file — is 47 files
// now, one per layer surface, and this is the only list of them that exists: the app loads it, the
// Storybook preview loads it, `test/css-box.tsx` resolves boxes through it and
// `npm run check:split` proves the concatenation of it is the old file byte for byte.
//
// ONE LIST RATHER THAN TWO, and that is the whole reason this is a module and not 47 imports in
// `main.tsx`. `.storybook/preview.tsx` already carried a second copy of the four-line version with a
// comment saying the order was load-bearing; a second copy of a 47-line version would have drifted from
// the app's cascade silently, and a workbench showing a cascade the app does not have is worse than one
// showing nothing.
//
// THE ORDER IS THE OLD FILE'S OWN ORDER, and it is load-bearing rather than tidy. Equal-specificity
// rules are decided by source order, so every part is imported at the position its bytes held inside
// `styles.css`. That is what makes the split a move: `npm run check:split` fails the moment a part is
// reordered, edited or resliced, and `npm run visual` would report drift on the surfaces where two rules
// meet.
//
// Bare side-effect imports, so biome's import sorting leaves them where they are: each one is a barrier
// rather than a member of a sortable group. Sorting them would be a silent cascade change.
//
// SEVEN PARTS HOLD A RULE THAT BELONGS TO A DIFFERENT SURFACE, and they hold it deliberately: the old
// file scattered a handful of rules away from their own section, and gathering them would move them in
// the cascade, which is a change rather than a move. They are the backlog `npm run check:layers`
// reports, and the phase that moves the components is the phase that re-homes them:
//   `.push` and `.switch-btn.active`  in organisms/topbar/topbar.css   — app-wide, not the top bar's
//   `.mp`                            in organisms/shared/confirm.css  — the model picker's anchor
//   `.link-title` / `.links-*`       in organisms/cards/card-view.css — the link picker's, shared
//   `.drop-line`                     in pages/control/control.css     — the board's drag indicator
//   `.gate-preview code`             in atoms/prose.css               — one rule for two surfaces
//   `.tab-badge`                     in pages/execution/execution.css — the dock's tab count
//   `.cv-*` overrides                in molecules/inline-field.css    — the card view's editable face

// Geometry before colour, and both before anything that spends them: the primitives are one layer and
// the split is what `npm run check:tokens` asserts.
import './design/tokens.css';
import './design/themes.css';
// BEFORE every surface sheet, so a surface can still override a primitive's COLOUR at equal specificity
// — the emergency stop is a ghost button with a danger hover, and the connection light tints its own
// dot. What stops that override becoming a padding is `npm run check:radius-scale`, not the cascade.
import './ui/primitives.css';

// AFTER the primitives although it is a design file, because that is where its bytes were: the UA
// control reset opened `styles.css`, and `ui/primitives.css` has rules that meet it — `.vb-input`'s
// step beats the `button, input, select, textarea` reset on specificity, but `*`, `body` and
// `:focus-visible` are decided by order. Moving it above the primitives is a cascade change, which is
// the one thing this phase must not make.
import './design/reset.css';
import './templates/app-shell.css';
import './organisms/topbar/topbar.css';
import './molecules/popover.css';
import './templates/globals.css';
import './templates/work-area.css';
import './organisms/board/board.css';
import './pages/gate/gate.css';
import './organisms/shared/modal.css';
import './molecules/field.css';
import './organisms/cards/raw-area.css';
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
import './organisms/topbar/top-tabs.css';
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
