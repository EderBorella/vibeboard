# The decision register

Comments and tests across `src/`, `web/src/` and `test/` cite rulings by number — *"decision 45"*,
*"ruling 66"*, *"the S10 case"*, *"C2's minimal control"*. Those numbers were assigned in design
documents that are **not in this repository**, so on their own they resolve to nothing. This file is
what makes them mean something: one row per identifier, the ruling restated, and where it binds.

**Every ruling is restated here rather than linked.** A link to a document nobody who clones this
repository can open is worse than no reference at all, which is the defect this file exists to
remove. If a row disagrees with the code, **the code wins** — bring the row up to date.

`npm run check:citations` fails if any cited identifier has no row here. Adding a citation to the
source means adding a row.

**Where it binds** names the module and, where one symbol clearly owns the rule, the symbol. It is
not exhaustive — several rulings are cited at a dozen sites — but it names the place the rule is
enforced rather than merely mentioned.

**Two identifiers are ambiguous and say so in their own rows** (`S1`, and `S2` by association): two
independent design efforts each numbered their findings `S1`, `S2`, `S3`, and both series are cited
in the code.

**Not registered here:** a handful of rulings are cited by DATE rather than by number — *"ruling
2026-08-11"* in `src/service/main.ts`, *"the shape ruling of 2026-08-13"* in `test/run-prompt.test.ts`,
*"the ruling of 2026-08-13"* in `test/runs-parse.test.ts`. They are a different notation, they carry no numeric
identifier, and the gate does not scan for them.

---

## Numbered decisions and rulings

Numbers 1–37 come from the original auto-pilot design; 38–67 from the lifecycle redesign that
replaced its routing table with a phase machine. The two series do not collide — the later document
starts at 38 deliberately.

| id | the ruling | where it binds |
|---|---|---|
| `decision 3` | Nothing advances on a run's own self-assessment: work is judged by commands with exit codes, and a missing or empty gate set **fails** rather than passing by default. | `src/server/auth/auth.ts` (`RULES` — `PUT /api/control/foundation/:name` is `assist`-only), `src/core/smoke-declaration.ts`, `src/server/content/control-routes.ts`, `src/server/runs/prompt/index.ts` |
| `decision 4` | One feature at a time, worked vertically — ordering only, and the reason two agents must never be dispatched at one card's work at once. | `src/core/tick.ts` (`TickInput.inFlight`) |
| `decision 5` | One acceptance criterion per card, judged structurally rather than by an estimate; anything beyond it is filed as a suggestion, and over-delivery is recorded rather than failed. | `src/server/auth/auth.ts` (the suggestions rows), `src/server/runs/routes.ts` (a project run is confined to no card) |
| `decision 7` | Pre-flight is a distinct, visibly different phase that authors the foundation documents and stops at the one human approval gate; the setup feature implements them. | `src/exec/commands.ts` (`COMMAND_TIMEOUT_MS`, and the unsandboxed-shell warning above it) |
| `decision 8` | Budget is enforced in backend code between dispatches — never by telling a model its balance — and every model run, checkups included, counts against every cap. | `src/server/runs/agent-runner.ts`, `src/service/loop.ts`, `src/service/act.ts` |
| `decision 10` | Endpoints are the only write path an agent has to board state, and the restriction is enforced by the OS rather than by instruction. | `src/server/auth/auth.ts` (`RULES`), `src/server/auth/credentials.ts`, `src/server/boards/cards-routes.ts`, `src/service/board-client.ts`, `src/service/stamp.ts` |
| `decision 11` | Agent Suggestions: an agent that finds work it must not act on files it, uncapped, and carries on — nothing is blocked and nothing is lost. | No production site cites it; pinned by `test/seed-skills.test.ts` against the skill bodies in `src/store/project/seed-skills.ts` |
| `decision 12` | Three levels of stopping — soft stop, emergency stop, restart — and while `halted` nothing dispatches, **nothing respawns lazily**, and the UI states the reason and the way back. | `src/server/autopilot/autopilot-runtime.ts`, `src/server/boxes/opencode-server.ts` (the lazy respawn), `src/server/copilot/copilot-turns.ts`, `src/server/runs/routes.ts`, `web/src/organisms/autopilot/HaltOverlay.tsx` |
| `decision 13` | An emergency stop kills process **groups**, not direct children, and nothing is signalled unless the recorded pgid **and** the group leader's start time both still match. | `src/exec/process-group.ts`, `src/exec/commands.ts`, `src/server/runs/reaper.ts`, `src/store/run-store.ts`, `src/server/autopilot/service-process.ts` |
| `decision 15` | Auto-pilot's state is persisted, so `running` and `halted` both survive a reload, and a server restart reconciles the state rather than assuming its dead children are still going. | `src/core/autopilot-state.ts` (`reconcile`) |
| `decision 18` | Every verdict records its evidence on the run it judged — the failing command and its output, the reason, and the measured actuals — so "why did this card advance?" is answerable from disk. | `src/core/verify.ts` (`Verification`), `src/core/runs.ts`, `src/server/runs/routes.ts`, `src/server/runs/agent-runner.ts` |
| `decision 20` | Auto-pilot is a separate process that reaches the board only over HTTP, with the counters in `autopilot-state.json` as its one deliberate direct-write carve-out. | `src/core/layout.ts` (`AUTOPILOT_STATE_FILE`), `src/service/board-client.ts`, `src/server/autopilot/service-process.ts`, `src/store/write-queue.ts` |
| `decision 21` | The API is authenticated and every run gets a scoped credential minted at dispatch and invalidated when the run settles; the admin credential lives outside the project tree. | `src/server/auth/auth.ts` (`RULES`, the scope table), `src/server/auth/credentials.ts`, `src/server/auth/signin.ts` |
| `decision 37` | **Superseded.** Derived features once had to land in `features/todo` to stop `features/backlog` dispatching them straight back through the phase that made them; under the phase machine a column dispatches nothing, so created cards belong in `backlog`. | `src/core/entry-column.ts` (`entryColumn`) |
| `decision 38` | A phase is a **position in a nested machine**, not a `(board, column)` pair — a column is a state the loop stamps, not a question the loop asks. | `src/core/phases.ts` (the phase table), `src/core/position.ts`, `src/service/stamp.ts` |
| `decision 39` | The machine's position is **derived from the board every tick and never stored**, and at most one feature and one story may be open at a time. | `src/core/position.ts` (`OPEN`, `derivePosition`), `src/core/tick.ts` |
| `decision 40` | A card advances when its phase's run **completes**, and no run judges its own work: the two outcomes an agent may write are treated identically, timeouts and cancellations are overridden by the runner, and a `failed` run never advances its card. | `src/core/autopilot.ts`, `src/core/runs.ts`, `src/service/act.ts`, `src/server/runs/prompt/index.ts` |
| `decision 42` | A feature completes by its **checkup**, never by rolling up its children; the `rollup` config block and `src/core/rollup.ts` are gone with it. | `src/core/autopilot.ts`, `src/core/tick.ts` |
| `decision 43` | Creating work is not idempotent, so a creating phase must read the board first and create one card per API call — and a phase whose only product is cards has not done its job if the **board** shows none appeared, whatever the run reported. | `src/core/created.ts` (`createdNothing`), `src/service/act.ts` |
| `decision 44` | The project's first feature is its own scaffolding, and the **loop** stamps `setup: true` on it at the bootstrap's exit through a `service`-only write path no agent scope can reach. | `src/core/harness-feature.ts`, `src/core/tick.ts`, `src/server/auth/auth.ts`, `src/server/boards/cards-routes.ts` |
| `decision 45` | Blocked is a settled **outcome**, not a halt: a task or story that exhausts its fix attempts blocks, its parent carries on, and `complete` must check positive evidence and name what it left behind. | `src/core/tick.ts`, `src/core/autopilot-cover.ts` (the blocked column is validated non-terminal), `src/core/derived-status.ts`, `web/src/organisms/board/CardTile.tsx` |
| `decision 46` | A story's or a feature's status is **derived from what sits under it**, never stamped on the card, so it self-heals when the blocked card is fixed. | `src/core/derived-status.ts` (`blockedUnder`), `src/server/boards/snapshot.ts`, `web/src/lib/shared.ts`, `web/src/organisms/board/CardTile.tsx` |
| `decision 47` | A checkup gets **one** round of creation at a given point; after that it may only close or stop, anything still missing becomes a suggestion, and the periodic checkup (`checkupEvery`, `needsCheckup`) retires. | `src/core/created.ts` (`creatingRoundSpent`), `src/core/phases.ts`, `src/core/tick.ts`, `src/server/autopilot/autopilot-runtime.ts` |
| `decision 48` | Suggestions get a **surface** — a split Project Log and a dock pane — never a fourth board, because a suggestions board would make an empty project look like it had work. | `web/src/organisms/suggestions/SuggestionsPane.tsx`, `web/src/organisms/diary/DiaryView.tsx`, `web/src/lib/api.ts` |
| `decision 49` | Nothing is ever dispatched from a suggestion: it is carded as a feature or a story, or it is dismissed — two fixed actions and no third. | `src/core/suggestions.ts`, `src/server/suggestions/routes.ts`, `web/src/organisms/suggestions/SuggestionsPane.tsx` |
| `decision 50` | Work arriving after the first pass hangs off **one open follow-up feature**, created and linked in a single endpoint call; and a card that already has children skips its break-down. | `src/core/setup-feature.ts`, `src/core/phases.ts`, `src/core/types.ts` (`Card.followUp`), `src/server/suggestions/routes.ts` |
| `decision 51` | The review phase is **deterministic first**: the loop runs the gate commands in its own process and they fail closed; only if they pass does a `review` run judge what a gate cannot express. The refusal to run any foundation-declared command while `unreviewedGates` is non-empty moves with the execution. | `src/service/act.ts`, `src/core/autopilot.ts`, `src/server/runs/prompt/index.ts`, `src/store/project/seed-skills.ts` |
| `decision 52` | The phase table lives in **code**, not in `config.yaml` — the config keeps the numbers, `terminal` and `blockedColumn`, and nothing else. | `src/core/phases.ts`, `src/core/autopilot.ts`, `src/core/autopilot-cover.ts`, `web/src/organisms/settings/SettingsModal.tsx` |
| `decision 53` | A sent-back task sits in `engineering/in-progress` while its `fix` runs; which of the two meanings that column carries is derived from an outstanding failed verdict rather than given a column of its own. | `src/core/tick.ts` (`taskPhase`) |
| `decision 54` | The story checkup closes its story in the same round it creates siblings; only the **feature** checkup stays open across a second round. | `src/core/tick.ts`, `src/service/act.ts` |
| `decision 55` | The loop runs the smoke command and hands the result to `checkup-feature` as **evidence**, not as a gate — a failing smoke command must be reported, not used to stop the project. | `src/core/tick.ts`, `src/service/act.ts`, `src/server/runs/prompt/index.ts` |
| `decision 56` | Each phase declares which board it may create on, enforced at the endpoint — replacing the self-loop refusal that used to read the retired routing table. | `src/core/phases.ts` (`phaseForRun`, the `creates` declaration), `src/server/boards/cards-routes.ts` |
| `decision 57` | A review verdict lives in two places: what the reviewer said on its own record, and `Verification` with `mode: 'review'` on the run it judged. | `src/core/autopilot.ts` (`VERIFY_MODES`), `src/core/verify.ts`, `src/service/act.ts` |
| `decision 58` | The create endpoint stamps **which run created a card**, and refuses a second card with the same title in the same column, telling the caller the id that already holds it. | `src/server/boards/cards-routes.ts` (`stampForRun`), `src/core/types.ts` (`Card.createdBy`), `src/store/cards/mutations.ts` |
| `decision 59` | No config migration: every VibeBoard project that exists is a disposable test project and is re-scaffolded, so an old block is simply valid and a missing key is backfilled on open. | `src/core/autopilot-cover.ts`, `src/store/project/config.ts` (`ensureAutopilotKeys`) |
| `decision 60` | The **loop** assembles a checkup's evidence into its prompt; the checkup gains no new read authority and its credential stays `work`. | `src/service/board-client.ts`, `src/service/act.ts`, `src/server/runs/prompt/index.ts`, `src/core/bounds.ts` |
| `decision 61` | A card a run creates on its **own** board is stamped too — only the bootstrap phase skips the stamp, because an unstamped card gets no entry column and no group. | `src/server/boards/cards-routes.ts` (`stampForRun`), `src/core/phases.ts` |
| `decision 62` | `hasUnfinishedChildren` survives the deletion of `eligibility.ts`, with tests of its own, in the module that owns the derived status. | `src/core/derived-status.ts` (`hasUnfinishedChildren`) |
| `decision 63` | Evidence the loop computes reaches a prompt on **`service`-only** fields, refused from every working scope — a review agent that could send `gatesPassed: true` would talk its own reviewer into a pass. | `src/server/runs/routes.ts`, `src/server/runs/prompt/index.ts`, `src/service/board-client.ts` |
| `decision 64` | A skill file states **obligations**, never facts the prompt owns: what is true right now — which gates ran, what the reviewer said — is the loop's to compute and the prompt's to state. | No production site cites it; pinned by `test/seed-skills.test.ts` against the bodies in `src/store/project/seed-skills.ts` |
| `decision 65` | The **server** writes the parent link, derived from the run's vertical; `links?` comes off the create contract for a run, and every create path goes through `setCardLinks` so the far side is written. | `src/store/cards/links.ts` (`createLinkedCard`), `src/server/boards/cards-routes.ts`, `src/store/cards/mutations.ts`, `src/server/auth/auth.ts` |
| `decision 66` | A gate command and a smoke command that are the **same command** are one check, so every project gets a mandatory smoke-harness feature created by the loop, sorted last, and `complete` refuses while the two are identical. | `src/core/harness-feature.ts` (`HARNESS_FEATURE`), `src/core/tick.ts` (`smokeIsAGate`), `src/core/smoke-declaration.ts`, `src/service/act.ts` |
| `decision 67` | A run may declare the `smoke:` command through `POST /api/foundation/smoke`, and that is the **only** foundation write any run may make; the write refuses a command that collides with a gate. | `src/store/project/foundation.ts` (`writeSmokeCommand`), `src/core/smoke-declaration.ts`, `src/server/auth/auth.ts`, `src/server/content/control-routes.ts` |
| `decision 68` | VibeBoard is an **application, not a library**: the root barrel `src/index.ts` is deleted and no published surface replaces it. Consuming it as a package was studied and deferred — see *Shipping VibeBoard as a library* below for what it would take and what is already true. | Nothing in production. The one importer was `test/integration.test.ts`, which now names the modules that own each function |

---

## Shipping VibeBoard as a library — studied, deferred

`src/index.ts` was a twelve-line barrel of `export *` lines fronting **77 symbols** from seven
`core/` modules and five `store/` ones. It looked like a public API and was not one: its only
importer in the whole repository was `test/integration.test.ts`, and it granted no visibility —
every symbol it re-exported was already `export`ed by its own module, so the barrel was a second
home for a surface rather than a surface. `decision 68` deletes it.

What was checked, so that reopening this starts from facts rather than from scratch:

- **The compiler is already ready.** `tsconfig.json` sets `declaration: true`, `outDir: dist`,
  `rootDir: src`, `module`/`moduleResolution` `NodeNext`. `npm run build` therefore already emits
  `.js` alongside `.d.ts` in the layout a package needs.
- **The manifest is not.** `package.json` declares no `main`, no `module`, no `exports`, no `types`
  and no `files` — all five are absent, so `npm pack` today would ship the entire working tree with
  no entry point. Those five keys, plus `"type": "module"` staying as it is, are the whole
  mechanical cost.
- **The natural surface is `core/` + `store/`, and only those.** `core/` is pure and `store/` is the
  filesystem-is-the-database layer; between them they export **317 symbols**. `server/`, `exec/` and
  `service/` are an application — a Fastify app, a process spawner and a supervised loop — and
  belong behind a binary, never behind an import.
- **The real cost is the contract, not the plumbing.** All 317 exports exist for this application's
  own convenience and change whenever it is convenient. A published surface means choosing which of
  them are promises, and a barrel is the wrong instrument for that choice because `export *` makes
  the decision by omission: a module that stops exporting a symbol narrows the package's API
  silently, with nothing red anywhere.

**Deferred because nothing consumes it.** The trigger to build it is a second program that needs to
read a VibeBoard project — at that point the surface is defined by what that program asks for, which
is a far better constraint than guessing. Until then a hand-picked `exports` map is a maintenance
cost paid for a consumer that does not exist.

---

## Design-review findings (`S`…) and build slices (`C`…)

`S` numbers are findings from an independent review of the auto-pilot design; `C` numbers are the
four sub-slices the auto-pilot service was built in. Neither series is a decision number, and both
dangle at the same absent documents.

| id | the ruling | where it binds |
|---|---|---|
| `S1` | **Two series share this number, and the code cites both.** *Design-review finding S1:* a run that was cancelled or timed out is settled as such **before** its report is folded in, so a killed run that already wrote a report cannot record `success`. *Containment S1:* the scoped-credential HTTP layer stays and is where per-agent differences belong — agents differ by their **token**, not by their filesystem — which is why one box serves every agent on a project and why the privileged install runs from outside it. | (finding) `src/server/runs/agent-runner.ts` (`#takeEvidence` / `#settle`); (containment) `src/server/boxes/containers.ts` (`INSTALL_HELPER`), `src/server/copilot/copilot.ts` (the copilot shares the project's box) |
| `S2` | **Containment S2**, and the only sense cited in the code: one box per `(project, backend)`. The backend is in the key for credential isolation alone — an OpenCode box must never see the Claude credential, or the reverse. (The design-review series also has an `S2`, about a childless card rolling up vacuously; it is not cited anywhere.) | `src/server/boxes/box-service.ts` (`boxPathsForBackend`), `src/server/boxes/copilot-env.ts` (`claudeStateDir`, `opencodeStateDir`) |
| `S5` | The setup feature is identified by a **frontmatter flag**, never a reserved id — and `setupFeatureFlag`, a config key that was typed, validated, mirrored to the UI and read by nothing, was the same failure reached through the key meant to prevent it. | `src/core/autopilot.ts` (`DEFAULT_AUTOPILOT`) |
| `S6` | The project is **locked while auto-pilot runs**: a by-hand dispatch is refused, because the runner, the concurrency cap and the queue are shared and the loop's commit-then-dispatch has to stay atomic. | `src/server/runs/routes.ts` (`dispatchLock`) |
| `S7` | **Switching** project is refused while auto-pilot runs — reopening the project already open is not, because the reconcile that fixes a crashed `running` state happens on open. | `src/server/boards/project-routes.ts` (the open handler) |
| `S9` | A judge returns a **score and the threshold it was compared against**, never a bare pass/fail. Retired with the critic: `decision 40` ruled the other way, and the surviving citation records why a review is no longer asked for a number. | `src/server/runs/prompt/contracts.ts` (`judgedLines`) |
| `S10` | When cost is unavailable or notional — a subscription-backed or local model — `maxIterations` is the governing cap, and every surface must say **which cap actually bounds this project** rather than showing a dollar dial that can never trip. | `src/core/accounting.ts` (`governingCap`), `src/core/dispatch-gate.ts` (`mayDispatch`), `web/src/organisms/autopilot/AutopilotPanel.tsx`, `web/src/pages/execution/ExecutionView.tsx` |
| `S11` | Files-changed becomes a `RunRecord` field measured from git around each dispatch, and an absent `turns` is recorded as **absent** rather than misread as a low number. | `src/exec/git-measure.ts`, `src/core/runs.ts` (`AgentReport`), `src/server/runs/agent-runner.ts` |
| `S13` | An unreadable auto-pilot state file fails **closed**, to `halted` with reason `unreadable` — deliberately inverting the house rule of "absent or corrupt, start fresh" for the one state that must not fail open. | `src/core/autopilot-state.ts` (`parseState`), `src/core/dispatch-gate.ts` (`STOP_REASONS`), `src/store/autopilot-store.ts` |
| `C1` | Sub-slice C1 — verification: the gates, the critic's score and threshold, the smoke command, and the verdict's evidence on the run record. The citation is about the regression it caused: adding a required config key invalidated every project that predated it, which is why missing keys are backfilled on open. | `src/store/project/config.ts` (`ensureAutopilotKeys`) |
| `C2` | Sub-slice C2 — the auto-pilot service and the tick: its own process, spawn and supervise, the pick, the stops, the branch and commit-before-dispatch, and the Start control (an endpoint nobody can press is not a feature). It is where the state file gained a second writer in a second process. | `src/core/autopilot-state.ts`, `src/store/write-queue.ts` (`chains`), `src/server/runs/routes.ts` (the `running` lock), `web/src/organisms/autopilot/AutopilotPanel.tsx` |
| `C3` | Sub-slice C3 — the checkup: its run, the `checkup` credential, its mandatory diary entry and its own commit, and suggestion triage. Its *periodic* form was later retired by `decision 47`; the two lifecycle checkups replaced it. | `src/store/project/config.ts` (cited only as one of the slices each adding config keys) |
| `C4` | Sub-slice C4 — the way in: pre-flight, the approval gate, the two new states, the PR at the end and the opt-in push. **The approval gate it was to build now exists** (`unreviewedGates`), so a comment describing it in the future tense is stale rather than a live deferral. | `src/store/project/config.ts`, `src/exec/commands.ts`, `web/src/organisms/autopilot/AutopilotPanel.tsx` |
