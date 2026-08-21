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
| `api.ts` | `decisions.md` | `decision 48`, `S10` |
| `shared.ts` | `decisions.md` — a deliberate hand-mirror of `src/core/`, guarded by `test/mirror.test.ts`; never deduplicated | `decision 46`, `decision 49`, `decision 52` |
| `styles.css` | `decisions.md` | `decision 48` |
| `useAutopilot.ts` | `decisions.md` | `decision 20` |
| `autopilot/AutopilotPanel.tsx` | `decisions.md` | `decision 52`, `S10`, `C2`, `C4` |
| `board/CardTile.tsx` | `decisions.md` | `decision 45`, `decision 46` |
| `diary/DiaryView.tsx` | `decisions.md` | `decision 48` |
| `runs/ExecutionView.tsx` | `decisions.md` | `S10` |
| `autopilot/HaltOverlay.tsx` | `decisions.md` | `decision 12` |
| `settings/SandboxPanel.tsx` | `security/containment.md` — it renders what is confining agents | — |
| `settings/SettingsModal.tsx` | `decisions.md` | `decision 52` |
| `suggestions/SuggestionsPane.tsx` | `decisions.md` | `decision 48`, `decision 49` |

## Repository configuration

| file | pages |
|---|---|
| `src/server/auth/auth.ts` | the scope table is a security property in its own right — see `decisions.md`, `decision 21` |
| `stryker.config.mjs` | its exclusions carry their own reasoning inline; it is invisible to both biome and tsc, so a stale path there scores green over zero mutants |
| `tools/check-citations.mjs` | the gate behind `decisions.md` — `npm run check:citations` |
| `tools/check-type-scale.mjs` | the gate behind the type and space scales — `npm run check:type-scale`. It reads the FILE, where the browser harness reads the board, and the two do not overlap: twelve of the 27 authored font sizes were on surfaces `npm run visual` never opens. See `design-system.md` |
| `tools/check-radius-scale.mjs` | the gate behind the radius scale and the BUTTON-GEOMETRY ratchet — `npm run check:radius-scale`. Two claims: every authored `border-radius` is one of the four steps or `50%` (blocking at zero), and no class rendered on a `<button>`/`<Button>`/`<Panel as="button">` declares its own geometry outside `primitives.css` (a ratchet, 56 → 4). `OFF_SCALE_ON_PURPOSE` is where a deliberate exception is written with its reason. See `design-system.md`, Phases 3 and 4 |
| `tools/check-class-budget.mjs` | the gate behind the CLASS COUNT — `npm run check:class-budget`. Two claims: every class selector in both stylesheets is referenced from `web/src` (blocking at zero, and it RESOLVES template-literal composition rather than allow-listing it, because a literal grep deletes the seven dynamically composed state classes and breaks the colours only in the states that matter), and the count against a ratchet with a target of 183. See `design-system.md`, Phase 5 |
| `tools/check-shape-coverage.mjs` | the gate behind the OTHER SIX PRIMITIVES — `npm run check:shape-coverage`. Six censuses (chip, panel, mono, dot, seg, control), a second arm on chip and control, and `BOXLESS_CHIPS`, a named list for the chips no shape rule can see. It exists because `check-radius-scale.mjs` was the only coverage gate and it only inspects buttons, so nine hand-rolled chip classes accumulated through six green phases. See `design-system.md`, Phases 7–9 |
| `tools/lib/` | the parsers the five gates share — the stylesheet rule scanner, the JSX opening-tag reader, the comment blanker and the line counter. One copy because three copies is how the at-rule double-count came to be fixed in one gate and left in another. See `design-system.md`, Phase 10 |
| `tools/docker/` | the image, the relay, the entrypoint and the install helper — see `security/containment.md` |
