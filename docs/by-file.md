# Index by source path

You are holding a `file:line` and want to know **why**. Find the file here; it names the pages that
explain it, and the numbered rulings its comments cite.

- **`decisions.md`** — the register. Every `decision NN` / `ruling NN` and every `S`/`C` slice
  reference, restated with where it binds.
- **`security/containment.md`** — how agents are confined today, what the read-only bind mounts deny
  and why, and where the writable holes are. **Read it before trusting any comment that mentions an
  AppArmor profile** — that profile was deleted on 2026-08-09 and is not in this repository.
- **`foundation-bootstrap.md`** — what the five `foundation/` documents must decide, and the two
  machine contracts inside them. Seeded into every project.

A file absent from this index has no reasoning filed anywhere but its own comments. That is the
normal case and not a defect: most modules explain themselves adequately at the point of use, and
this index exists for the ones whose reason lives somewhere else.

---

## `src/core/` — pure decisions, no I/O

Nothing here imports `node:*`. That is checked by resolving the import graph from `core/tick.ts` and
looking for a `node:` import anywhere it reaches — **not** by grepping this directory, which proves
nothing: a pure-looking module can reach `node:fs` through three hops, and that is exactly how it used
to. One value edge upward remains, `find.ts` → `store/cards/board.js`; it is outside the lifecycle
machine's closure, and it is why the purity gate is still unarmed.

| file | pages | cites |
|---|---|---|
| `accounting.ts` | `decisions.md` — the spend arithmetic, and the SHAPE `GET /api/accounting` answers with (`Accounting`, `CardAccount`). The shape lived in the autopilot route module until it was the last thing making `src/service/` import from `src/server/`; the loop needs the type to read the answer, and nothing about it is a server concern | `S10` |
| `autopilot-cover.ts` | `decisions.md` | `decision 45`, `decision 52`, `decision 59` |
| `autopilot-state.ts` | `decisions.md`, `security/containment.md` (its `unreviewedGates` comment explains a live rule by naming the dead profile) | `decision 15`, `decision 20`, `decision 47`, `S13`, `C2` |
| `autopilot.ts` | `decisions.md` | `decision 40`, `decision 42`, `decision 45`, `decision 51`, `decision 52`, `decision 57`, `S5` |
| `bounds.ts` | `decisions.md` | `decision 46`, `decision 47`, `decision 58`, `decision 60` |
| `created.ts` | `decisions.md` | `decision 40`, `decision 43`, `decision 47` |
| `derived-status.ts` | `decisions.md` | `decision 45`, `decision 46`, `decision 62` |
| `dispatch-gate.ts` | `decisions.md` | `decision 47`, `S10`, `S13` |
| `entry-column.ts` | `decisions.md` | `decision 37` (superseded — the row says so) |
| `harness-feature.ts` | `decisions.md`, `foundation-bootstrap.md` | `decision 3`, `decision 44`, `decision 66`, `decision 67` |
| `layout.ts` | `decisions.md`, `security/containment.md` (`SUGGESTIONS_DIR`'s comment names the dead profile; the rule is now a read-only mount) | `decision 20` |
| `lifecycle/stop-sentences.ts` | `decisions.md` — the sentences a stop carries, and what each one used to say: most are corrections that named a mechanism the product no longer has | `decision 44`, `decision 45`, `decision 52`, `decision 55`, `decision 66` |
| `lifecycle/tick.ts` | `decisions.md` — the lifecycle machine; more rulings meet here than anywhere else. `tick.ts` is the re-export barrel and holds no reasoning of its own | `decision 4`, `decision 39`, `decision 42`, `decision 45`, `decision 47`, `decision 50`, `decision 52`, `decision 53`, `decision 54`, `decision 58`, `decision 59` |
| `phases.ts` | `decisions.md` — the phase table itself | `decision 38`, `decision 44`, `decision 47`, `decision 50`, `decision 52`, `decision 56`, `decision 61` |
| `position.ts` | `decisions.md` | `decision 38`, `decision 39` |
| `runs/types.ts` | `decisions.md` — the record's shape; `runs.ts` is the re-export barrel and holds no reasoning of its own | `decision 18`, `decision 40`, `S11` |
| `setup-feature.ts` | `decisions.md` | `decision 50`, `decision 51` |
| `smoke-declaration.ts` | `decisions.md`, `foundation-bootstrap.md` | `decision 3`, `decision 66`, `decision 67` |
| `suggestions.ts` | `decisions.md` | `decision 49` |
| `types.ts` | `decisions.md` | `decision 50`, `decision 58` |
| `verify.ts` | `decisions.md` | `decision 18`, `decision 57` |

## `src/exec/` — spawns a process against the working tree

Below `src/server/` and shared with it by `src/service/`, which is a separate process. That sharing is
the reason this layer exists: running a project's gate commands and writing its git history are
deliberate, documented trust decisions taken in the loop's OWN process, not server internals the loop
reaches around. Putting arbitrary command execution behind an HTTP endpoint would be a far larger hole
than it closes, so the code moved to where both callers legitimately sit. Nothing here imports
`src/server/`.

| file | pages | cites |
|---|---|---|
| `commands.ts` | `decisions.md`, `security/containment.md` — gate commands run unsandboxed in the loop's own process, deliberately | `decision 7`, `decision 13`, `C4` |
| `git-measure.ts` | `decisions.md` | `S11` |
| `process-group.ts` | `decisions.md` | `decision 13` |

## `src/store/` — the filesystem is the database

There is no database and no ORM. A card is a `.md` file with YAML frontmatter and the column it is in is
the folder it sits in, so every module that reads or writes that format is a data-access layer, however
much it looks like domain logic. These modules used to be split between `src/core/`, where they made the
pure decision layer transitively impure, and `src/server/`, where they made a store look like a server
internal — which is why the loop reaching one of them read as a layer violation when it was in fact the
documented state-file carve-out.

Two folders inside, and the rest flat. `cards/` is the card database proper; `project/` is the project's
own files — its config, its conventions, the documents and skills seeded into it. The `*-store.ts`
modules stay flat because each is the single owner of one artefact and its name already says which; a
folder over them would need a noun covering a run report, a chat transcript, a project log, a suggestion
and the loop's state file, and there isn't an honest one. `write-queue.ts` is flat because all three
groups write through it.

| file | pages | cites |
|---|---|---|
| `cards/links.ts` | `decisions.md` | `decision 65` |
| `cards/mutations.ts` | `decisions.md` | `decision 58`, `decision 65` |
| `project/config.ts` | `decisions.md` | `decision 45`, `C1`, `C2`, `C3`, `C4` |
| `project/control-files.ts` | `security/containment.md` — the path sandbox behind Project Control: the `..` rejection, the symlink realpath walk and the category allow-list. It still reaches `server/fs-sandbox.ts` for the first two halves | — |
| `project/foundation.ts` | `decisions.md`, `foundation-bootstrap.md` | `decision 66`, `decision 67` |
| `project/seed-docs.ts` | `foundation-bootstrap.md` — it is what seeds it, and it resolves the bundled folder by **climbing** to the package root rather than counting `..` segments. The count was wrong the moment this file moved, and a wrong path here throws nothing and fails no type check: the reader treats an unreadable source as a packaging problem and carries on. `test/seed-docs.test.ts` asserts the resolved directory exists on disk | — |
| `project/seed-skills.ts` | `decisions.md` — `decision 11` and `decision 64` are cited **only** by `test/seed-skills.test.ts` against these bodies | `decision 51` |
| `autopilot-store.ts` | `decisions.md` — the loop's one deliberate direct-write carve-out, and the reason `src/service/main.ts` may import it | `S13` |
| `run-store.ts` | `decisions.md`, `security/containment.md` — the agent writes a report under `runs/`; this folds it in | `decision 13` |
| `suggestion-store.ts` | `security/containment.md` — the agent cannot write here, so the endpoint is the only way in | — |
| `write-queue.ts` | `decisions.md` — the atomic write and the per-path chain everything above goes through | `decision 20`, `C2` |

## `src/server/` — the Fastify app, grouped by feature

One folder per feature, each holding its implementation AND its HTTP surface, so the answer to "where
does this endpoint's logic live" is "beside it". The route module is `routes.ts` where a feature has one
HTTP surface and `<subject>-routes.ts` where it has several; there is no `routes/` directory any more,
and `test/entry-column.test.ts` still enforces that no route imports another route — over every route
module by that naming convention rather than over one flat directory.

**What is flat, and why.** `app.ts` and `main.ts` are the app and the process. `route-context.ts`,
`logging.ts`, `errors.ts`, `redaction.ts`, `static.ts`, `ws.ts` and `fs-sandbox.ts` are mechanisms every
feature reaches through, and a mechanism shared by two features belongs to neither — the same rule that
keeps `store/write-queue.ts` flat. `fs-sandbox.ts` says so in its own header: the path rule is shared by
Project Control's allow-listed documents and the Explorer's whole tree, deliberately as one copy.
`agent-turn.ts` and `copilot-events.ts` are flat for exactly that reason too, and it is worth stating
because their names suggest otherwise: one turn of an agent process and the parser for what it writes
back are what BOTH dispatch and the chat go through, so filing them under either would mislead whoever
arrives from the other. `copilot-system-prompt.md` is flat because `agent-turn.ts` reads it as a
sibling, and `package.json`'s build step copies it to the matching place in `dist/`.

**`boxes/` is the container an agent runs in and the backend process inside it** — the box verbs, the
spec, the gate, the socket, the OpenCode server and its client, and the config home that server is
given. **`copilot/` is the chat**, and the model catalogue its picker offers. **`content/`, `diary/` and
`suggestions/` hold routes only**: what they read and write is a store, and the stores live in
`src/store/`.

| file | pages | cites |
|---|---|---|
| `app.ts` | `decisions.md` | `decision 8`, `decision 13`, `S11` |
| `agent-turn.ts` | `security/containment.md` | — |
| `logging.ts` | `decisions.md` | `decision 20` |
| `route-context.ts` | `decisions.md` | `decision 20` |
| `auth/auth.ts` | `decisions.md` — `RULES` is the single answer to "who may call this", and a route absent from it is admin-only. It moved as ONE WHOLE FILE and its contents are not divided: a per-feature fragment that failed to register would silently remove rows, and `endpointsFor` iterates the table in declaration order because that order is the endpoint list every agent is given | `decision 3`, `decision 5`, `decision 10`, `decision 18`, `decision 21`, `decision 44`, `decision 51`, `decision 65`, `decision 66`, `decision 67` |
| `auth/credentials.ts` | `decisions.md`, `security/containment.md` — `~/.vibeboard/` is not among the mounts; `VIBEBOARD_TOKEN_FILE` is the exception | `decision 10` |
| `auth/devices.ts` | `security/containment.md` — why a hash is stored, and why the `token-` prefix survives its old reason | — |
| `auth/signin.ts` | `decisions.md` | `decision 21` |
| `auth/signin-terminal.ts` | `security/containment.md` — the `VIBEBOARD_TOKEN_FILE` warning it prints | — |
| `autopilot/autopilot-runtime.ts` | `decisions.md` | `decision 12`, `decision 13`, `decision 47` |
| `autopilot/service-process.ts` | `decisions.md`, `security/containment.md` — the loop is deliberately **not** boxed; the scope table is what confines it. It resolves the loop's entry by **climbing** to whichever ancestor holds `service/main<ext>`, not by rewriting its own path: the old derivation hard-coded both the directory it sat in and its own filename, so filing it here made it answer with its OWN path — and nothing type-checks a string. `test/service-process.test.ts` asserts the resolved path exists on disk | `decision 13`, `decision 20`, `decision 47` |
| `autopilot/routes.ts` | `decisions.md` — the readiness composer, and the accounting endpoint whose SHAPE lives in `core/accounting.ts` | `decision 12`, `decision 47` |
| `boards/snapshot.ts` | `decisions.md` | `decision 46` |
| `boards/cards-routes.ts` | `decisions.md` — the create rules: the stamp, the parent link, the duplicate-title refusal | `decision 10`, `decision 44`, `decision 56`, `decision 58`, `decision 61`, `decision 65` |
| `boards/project-routes.ts` | `decisions.md` | `S7` |
| `boxes/api-socket.ts` | `security/containment.md` — the socket **directory** is what is mounted, read-only | — |
| `boxes/box-manager.ts` | `security/containment.md` — adoption by name **and** spec, and the network rules | — |
| `boxes/box-service.ts` | `security/containment.md`, `decisions.md` | `S2` |
| `boxes/containers.ts` | `security/containment.md` — the mount set, the protected paths, the writable hole, the flags | `S1` |
| `boxes/copilot-env.ts` | `security/containment.md`, `decisions.md` — per-project, per-backend state, and why | `S2` |
| `boxes/opencode-server.ts` | `decisions.md`, `security/containment.md` — the server is the box's main process, one box per project | `decision 12` |
| `boxes/sandbox.ts` | `security/containment.md` — the gate, and why it is a probe | — |
| `boxes/sandbox-routes.ts` | `security/containment.md` — `profile` in the payload is now the image name | — |
| `boxes/toolchain-routes.ts` | `security/containment.md` — the brokered install, the privileged half | — |
| `content/control-routes.ts` | `decisions.md`, `foundation-bootstrap.md` | `decision 3`, `decision 67` |
| `copilot/copilot.ts` | `security/containment.md` — the copilot shares the project's box | `S1` |
| `copilot/copilot-authority.ts` | `security/containment.md` — why a credential is redacted out of anything persisted | — |
| `copilot/copilot-turns.ts` | `decisions.md`, `security/containment.md` — the shared box, the session transcript, and the eager end of a chat credential | `decision 12` |
| `diary/routes.ts` | `security/containment.md` — the file is inside `.vibeboard/`, mounted read-only in every box, so the endpoint is the only way in | — |
| `runs/agent-runner.ts` | `decisions.md`, `security/containment.md` (credential redaction, and why stdin rather than argv) | `decision 8`, `decision 18`, `decision 60`, `S1`, `S11` |
| `runs/reaper.ts` | `decisions.md` | `decision 13` |
| `runs/routes.ts` | `decisions.md` | `decision 3`, `decision 5`, `decision 12`, `decision 18`, `decision 40`, `decision 52`, `decision 60`, `decision 63`, `S6`, `C2` |
| `runs/prompt/index.ts` | `decisions.md` — the input contract, and the order the sections are assembled in. It also records why the `run-prompt.ts` barrel that used to front this directory is gone: NodeNext has no directory-index resolution, so a barrel is what makes a SPLIT cost its importers nothing — and filing the directory under `runs/` changed the specifier for all four importers anyway, leaving a file whose only job was to keep a path stable that nobody could still use | `decision 18`, `decision 40`, `decision 51`, `decision 55`, `decision 60`, `decision 63` |
| `runs/prompt/contracts.ts` | `decisions.md` — what a run is asked to produce, and why a judging run's contract REPLACES the reporting one rather than adding to it | `decision 3`, `decision 40`, `decision 51`, `S9` |
| `runs/prompt/credential.ts` | `decisions.md` (`decision 10`'s scope table), `security/containment.md` — the only part of the prompt that reaches `auth/auth.ts`. The agent's permitted endpoint list is GENERATED from that table, and `test/run-prompt.test.ts` asserts the assembled prompt's catalogue against it in both directions | — |
| `runs/prompt/sections.ts` | `decisions.md` — one section per thing the agent is told, and why several of them return nothing rather than a heading over nothing | `decision 55`, `decision 60` |
| `suggestions/routes.ts` | `decisions.md` | `decision 49`, `decision 50` |

## `src/service/` — the auto-pilot loop, a separate process

| file | pages | cites |
|---|---|---|
| `act/index.ts` | `decisions.md` — the two paths one action can take, and the four rules the order carries; `act.ts` is the re-export barrel and holds no reasoning of its own | `decision 3`, `decision 10`, `decision 40`, `decision 43`, `decision 51`, `decision 55`, `decision 57` |
| `act/bootstrap.ts` | `decisions.md` — the tail of the one run with no card: the scaffolding flag, then the harness feature | `decision 44`, `decision 50`, `decision 51`, `decision 66` |
| `act/checkup.ts` | `decisions.md` — what a checkup is told, and the gate-document refusal in front of the smoke command | `decision 40`, `decision 51`, `decision 55`, `decision 60` |
| `act/outcomes.ts` | `decisions.md` — what a settled card run earned, and the four endings that take no exit stamp | `decision 40`, `decision 43`, `decision 47`, `decision 51`, `decision 54` |
| `act/refusals.ts` | `decisions.md` — why a refused write still reports the dispatch that happened | `decision 8` |
| `act/review.ts` | `decisions.md` — the gates first, in this process, and the model only after them | `decision 40`, `decision 51` |
| `act/sentences.ts` | `decisions.md` — every sentence a person reads afterwards, including the run summary agents cannot append themselves | `decision 10` |
| `act/settle.ts` | — the wait for a dispatched run, and the clamps that make it terminate | — |
| `board-client.ts` | `decisions.md` — the loop reaches the board over HTTP and nowhere else | `decision 10`, `decision 18`, `decision 20`, `decision 60`, `decision 63`, `decision 65`, `decision 66` |
| `loop.ts` | `decisions.md` | `decision 8`, `decision 20`, `decision 66` |
| `main.ts` | `decisions.md` — also carries a **date-stamped** ruling (`2026-08-11`), which the register does not cover | `decision 20` |
| `stamp.ts` | `decisions.md` | `decision 10`, `decision 38` |

## `web/src/` — the React front end

| file | pages | cites |
|---|---|---|
| `lib/api.ts` | `decisions.md` | `decision 48`, `S10` |
| `lib/shared.ts` | `decisions.md` — a deliberate hand-mirror of `src/core/`, guarded by `test/mirror.test.ts`; never deduplicated | `decision 46`, `decision 49`, `decision 52` |
| `styles.ts` | THE CASCADE — the one ordered list of the 41 stylesheets the app loads, imported by `main.tsx` and by `.storybook/preview.tsx` so the workbench cannot show a cascade the app does not have. 59 became 41 in the organism phase: the 47 parts the split produced were an artefact of the byte-identity contiguity constraint, and §5.1 asks for one sheet per component and per organism directory. It also records where each of the seven misfiled strays went | — |
| `organisms/shared/modal.css` | `Modal` — four hand-built dialogs and 21 classes in five, with the measure, the colour and the dismissability as ATTRIBUTES rather than classes | — |
| `organisms/shared/list.css` | `List` + `Row` — the nineteen list-and-row families in five classes, and the one place `--rule` and `--tone` meet | `decision 48` |
| `lib/useAutopilot.ts` | `decisions.md` | `decision 20` |
| `organisms/autopilot/AutopilotPanel.tsx` | `decisions.md` | `decision 52`, `S10`, `C2`, `C4` |
| `organisms/board/CardTile.tsx` | `decisions.md` | `decision 45`, `decision 46` |
| `organisms/diary/DiaryView.tsx` | `decisions.md` | `decision 48` |
| `pages/execution/ExecutionView.tsx` | `decisions.md` | `S10` |
| `organisms/autopilot/HaltOverlay.tsx` | `decisions.md` | `decision 12` |
| `organisms/settings/SandboxPanel.tsx` | `security/containment.md` — it renders what is confining agents | — |
| `organisms/settings/SettingsModal.tsx` | `decisions.md` | `decision 52` |
| `organisms/suggestions/SuggestionsPane.tsx` | `decisions.md` | `decision 48`, `decision 49` |

## Repository configuration

| file | pages |
|---|---|
| `src/server/auth/auth.ts` | the scope table is a security property in its own right — see `decisions.md`, `decision 21` |
| `stryker.config.mjs` | its exclusions carry their own reasoning inline; it is invisible to both biome and tsc, so a stale path there scores green over zero mutants |
| `tools/check-citations.mjs` | the gate behind `decisions.md` — `npm run check:citations` |
| `tools/check-scale.mjs` | the gate behind the type AND space scales and the tracking token — `npm run check:scale`. Three claims, all blocking at zero: every authored `font-size` is one of the five type steps; every `gap`, `padding` and `margin` value is `0`, a keyword, a percentage, `auto`, one of the seven `--s-*` steps or a `calc()` built only from them; every `letter-spacing` is `var(--track)`, `normal` or a named exception; and every `top`/`right`/`bottom`/`left`/`inset` is on the same seven-step grid, which closed the last hand-written length in the tree (`.explorer-head { top: -0.75rem }` — `top` had been in no gate at all). It was `check-type-scale.mjs`, whose space claim was a 0.25–0.6rem BAND rather than a scale — so `padding: 0.7rem` passed above it and `padding: 0.05rem` below it, and `margin` was in no gate at all, which is where the values actually were. `OFF_SCALE_ON_PURPOSE` and `TRACKING_ON_PURPOSE` are where a deliberate exception is written with its reason, and a row nothing exercises is itself a finding. It reads the FILE, where the browser harness reads the board, and the two do not overlap: twelve of the 27 authored font sizes were on surfaces `npm run visual` never opens. See `design-system.md` |
| `tools/check-radius-scale.mjs` | the gate behind the radius scale and the BUTTON-GEOMETRY ratchet — `npm run check:radius-scale`. Two claims: every authored `border-radius` is one of the four steps or `50%` (blocking at zero), and no class rendered on a `<button>`/`<Button>`/`<Panel as="button">` declares its own geometry outside `primitives.css` (a ratchet driven to **0/0** in the organism phase, from 56: `.board-label` was the last, and it is a `Row rail="accent" interactive` whose class is now a face with no geometry in it). `OFF_SCALE_ON_PURPOSE` is where a deliberate exception is written with its reason. See `design-system.md`, Phases 3 and 4 |
| `tools/check-box-scale.mjs` | the gate behind THE TWO BOX HEIGHTS, the meaning edge, the elevation and the four layers — `npm run check:box-scale`. Four claims over every `.css` in `web/src`, all blocking at zero: every authored `height`/`min-height` is `var(--ctl-h)`, `var(--mark-h)`, `var(--tile-h)`, `0`, `auto`, `100%`, a viewport unit or a named exception; every border WIDTH is `1px`, `var(--rule)` or `0`; every `box-shadow` is `var(--glow)`, `var(--lift)`, a comma-pair of the two, or `none`; every `z-index` is one of the four `--z-*` names. It is a separate file from `check-radius-scale.mjs` for a structural reason: that gate's second instrument is a ratchet on a CLASS COUNT, and a count cannot see a new property on a class it has already counted — `height: 30px` on `.tab-btn` moves no count. `OFF_SCALE_ON_PURPOSE` is keyed on the SELECTOR rather than the value, so a row is exercised by exactly one rule, and a row no rule exercises is itself a finding. See `design-system.md` |
| `tools/check-class-budget.mjs` | the gate behind the CLASS COUNT — `npm run check:class-budget`. Two claims: every class selector in both stylesheets is referenced from `web/src` (blocking at zero, and it RESOLVES template-literal composition rather than allow-listing it, because a literal grep deletes the seven dynamically composed state classes and breaks the colours only in the states that matter), and the count against a ratchet — **305 against a target of 146**, and the split it prints is the THIRTEEN-sheet atom + molecule layer (60) against the surfaces (259). A third claim holds a per-surface ceiling of four, as a ratchet on the COUNT of surfaces over it (13). The gap of 159 is located term by term in the file itself, and it is ONE term: the sixteen feature directories hold 230 against 76, and the remainder is TYPE FACES rather than boxes. See `design-system.md`, *The atomic revamp: the class target is 146* — and NOT that page's "Phase 5", which this row used to cite and which is an earlier and different programme's phase |
| `tools/check-shape-coverage.mjs` | the gate behind the OTHER SIX PRIMITIVES — `npm run check:shape-coverage`. Four shape censuses (chip, panel, mono, dot), TWO SELECTION ARMS (`Tabs` and `Menu`, one each, keyed on the ARIA a mutually-exclusive cell has to carry — the segmented census is folded into the tab arm), a second arm on chip and control, and `BOXLESS_CHIPS`, a named list for the chips no shape rule can see. It exists because `check-radius-scale.mjs` was the only coverage gate and it only inspects buttons, so nine hand-rolled chip classes accumulated through six green phases. See `design-system.md`, Phases 7–9 and 11 |
| `tools/check-name-resolution.mjs` | the gate for THE DIRECTION NOTHING READ — `npm run check:name-resolution`. `check-class-budget.mjs` asks CSS → code; this asks code → CSS. Two claims: every class named in a `…ClassName` is defined by a rule (a ratchet, with a class that is READ by a selector or a `classList` call excused as a hook rather than allow-listed), and every `var(--token)` a stylesheet references is defined or supplied at run time (blocking at zero). It exists because `.vb-label-caps`, `--ink` and `.conn-pop` were each found by hand. See `design-system.md`, Phase 12 |
| `tools/check-state-tones.mjs` | the gate behind ONE STATE VOCABULARY — `npm run check:state-tones`. Five claims, all blocking at zero: every row of `STATE_TONES` maps to one of the five tones and every tone is reached by a row; every row is named in `web/src`; every `data-state=` resolves to a row, literally or through a `StateName`-typed channel the compiler checks; NO stylesheet selector contains `[data-state`; and `--tone` is assigned by exactly the five `.vb-tone-*` rules. It exists because twenty-six `[data-state]` rules across six surfaces each picked a token by hand, so `running` rendered as three different colours on three surfaces read in one glance. Prints the whole table, every role and every site on a passing run. See `design-system.md`, Phase 13 |
| `tools/check-tokens.mjs` | the gate behind THE PRIMITIVE LAYER — `npm run check:tokens`. Three claims over `web/src/design/*.css`, all blocking at zero: every custom property defined is referenced from a stylesheet or signed for in `UNCONSUMED` with the phase that spends it (a row that has since acquired a consumer is a finding too, because an exception list nobody prunes would pass an empty tree); every property defined in one `[data-theme]` block is defined in all three; and the shared block defines no colour while the theme blocks define no geometry. It exists because `--scan` sat in three palettes with zero consumers for three palettes worth of history and no gate here ran that direction, and because `--warn` was referenced by `styles.css` and defined by NO theme, so every theme fell through to a hardcoded dark-ground fallback and the light one wore it. `COLOUR_IN_TOKENS_ON_PURPOSE` is where a colour that is really a geometry is written down with its reason. Prints the whole vocabulary with a consumer count per name on a passing run |
| `tools/check-layers.mjs` | the gate behind THE LAYER — `npm run check:layers`. Two claims about where a class LIVES against who reads it: a class under `atoms/`, `molecules/`, `organisms/shared/`, `templates/` or `design/` may be referenced from anywhere, and a class under `organisms/<name>/` or `pages/<name>/` only from `<name>`, and a class declared in two SCOPED directories is an ORPHAN owned by neither. The organism phase narrowed the READER — a reference is now a class name in a `className` position rather than any token in any file, which took 72 findings to 44 and removed 28 that were a class name happening to be an ordinary English word (`.board` was accused because `api/cards.ts` declares `board: string`). The 44 were one fault, not 44: the stylesheets were in the layer tree and the components were not, and 15 of the 44 were two files — `runs/ExecutionView.tsx`, which the tree says IS `pages/Execution`, and `app/TopBar.tsx`. **BOTH CLAIMS NOW BLOCK AT ZERO**, in the commit that moved 115 files into the tree: 13 of the 44 closed on the move alone, and the other 31 were shapes two surfaces each wear, which moved to `organisms/shared/` (13), `templates/` (4), `molecules/popover.css` (1), the surface that names them (12) or were deleted as `Text` options (2) |
| `web/src/molecules/state-tones.ts` | THE STATE TABLE — 26 state names, five tones, one place. What each tone MEANS, which states were judged equivalent and which were split, and why a backend name is not a state. `stateClass()` is the only place a tone becomes a class; `asState()` is the same type check without one, for the row that carries a `data-state` and takes no colour from it. See `design-system.md`, Phase 13 |
| `web/src/molecules/StatusChip.tsx` | THE ONE STATE INDICATOR — the census of the four it replaces (the connection light, the top bar's auto-pilot chip, the auto-pilot bar's agent chip, the copilot's backend row), why all four are buttons in every state rather than only once something breaks, and why the word is a node rather than a string. Its box comes from `Chip`'s `chipClasses`, because `Popover` renders the `<button>` |
| `test/copilot-rows.test.tsx` | THE COPILOT DOCK'S GUTTER, read out of the stylesheet — the Authorise button sat in a classless `<div>` with no padding while its six siblings each had the dock gutter (`--s-5`), and neither the suite nor the browser harness could see it: jsdom loads no CSS and the harness never opens the dock |
| `tools/lib/` | the parsers the ten gates share — the stylesheet rule scanner, the JSX opening-tag reader, the comment blanker and the line counter. One copy because three copies is how the at-rule double-count came to be fixed in one gate and left in another. See `design-system.md`, Phase 10 |
| `tools/docker/` | the image, the relay, the entrypoint and the install helper — see `security/containment.md` |
