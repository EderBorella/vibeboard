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

| file | pages | cites |
|---|---|---|
| `accounting.ts` | `decisions.md` | `S10` |
| `autopilot-cover.ts` | `decisions.md` | `decision 45`, `decision 52`, `decision 59` |
| `autopilot-state.ts` | `decisions.md`, `security/containment.md` (its `unreviewedGates` comment explains a live rule by naming the dead profile) | `decision 15`, `decision 20`, `decision 47`, `S13`, `C2` |
| `autopilot.ts` | `decisions.md` | `decision 40`, `decision 42`, `decision 45`, `decision 51`, `decision 52`, `decision 57`, `S5` |
| `bounds.ts` | `decisions.md` | `decision 46`, `decision 47`, `decision 58`, `decision 60` |
| `config.ts` | `decisions.md` | `decision 45`, `C1`, `C2`, `C3`, `C4` |
| `created.ts` | `decisions.md` | `decision 40`, `decision 43`, `decision 47` |
| `derived-status.ts` | `decisions.md` | `decision 45`, `decision 46`, `decision 62` |
| `dispatch-gate.ts` | `decisions.md` | `decision 47`, `S10`, `S13` |
| `entry-column.ts` | `decisions.md` | `decision 37` (superseded — the row says so) |
| `foundation.ts` | `decisions.md`, `foundation-bootstrap.md` | `decision 66`, `decision 67` |
| `harness-feature.ts` | `decisions.md`, `foundation-bootstrap.md` | `decision 3`, `decision 44`, `decision 66`, `decision 67` |
| `layout.ts` | `decisions.md`, `security/containment.md` (`SUGGESTIONS_DIR`'s comment names the dead profile; the rule is now a read-only mount) | `decision 20` |
| `links.ts` | `decisions.md` | `decision 65` |
| `mutations.ts` | `decisions.md` | `decision 58`, `decision 65` |
| `phases.ts` | `decisions.md` — the phase table itself | `decision 38`, `decision 44`, `decision 47`, `decision 50`, `decision 52`, `decision 56`, `decision 61` |
| `position.ts` | `decisions.md` | `decision 38`, `decision 39` |
| `runs.ts` | `decisions.md` | `decision 18`, `decision 40`, `S11` |
| `seed-docs.ts` | `foundation-bootstrap.md` — it is what seeds it | — |
| `seed-skills.ts` | `decisions.md` — `decision 11` and `decision 64` are cited **only** by `test/seed-skills.test.ts` against these bodies | `decision 51` |
| `setup-feature.ts` | `decisions.md` | `decision 50`, `decision 51` |
| `smoke-declaration.ts` | `decisions.md`, `foundation-bootstrap.md` | `decision 3`, `decision 66`, `decision 67` |
| `suggestions.ts` | `decisions.md` | `decision 49` |
| `tick.ts` | `decisions.md` — the lifecycle machine; more rulings meet here than anywhere else | `decision 4`, `decision 39`, `decision 42`, `decision 44`, `decision 45`, `decision 47`, `decision 50`, `decision 52`, `decision 53`, `decision 54`, `decision 55`, `decision 58`, `decision 59`, `decision 66` |
| `types.ts` | `decisions.md` | `decision 50`, `decision 58` |
| `verify.ts` | `decisions.md` | `decision 18`, `decision 57` |

## `src/server/` — the Fastify app, auth, credentials, containers, dispatch

| file | pages | cites |
|---|---|---|
| `agent-runner.ts` | `decisions.md`, `security/containment.md` (credential redaction, and why stdin rather than argv) | `decision 8`, `decision 18`, `decision 60`, `S1`, `S11` |
| `agent-turn.ts` | `security/containment.md` | — |
| `api-socket.ts` | `security/containment.md` — the socket **directory** is what is mounted, read-only | — |
| `app.ts` | `decisions.md` | `decision 8`, `decision 13`, `S11` |
| `auth.ts` | `decisions.md` — `RULES` is the single answer to "who may call this", and a route absent from it is admin-only | `decision 3`, `decision 5`, `decision 10`, `decision 18`, `decision 21`, `decision 44`, `decision 51`, `decision 65`, `decision 66`, `decision 67` |
| `autopilot-runtime.ts` | `decisions.md` | `decision 12`, `decision 13`, `decision 47` |
| `autopilot-store.ts` | `decisions.md` | `S13` |
| `box-manager.ts` | `security/containment.md` — adoption by name **and** spec, and the network rules | — |
| `box-service.ts` | `security/containment.md`, `decisions.md` | `S2` |
| `commands.ts` | `decisions.md`, `security/containment.md` — gate commands run unsandboxed in the loop's own process, deliberately | `decision 7`, `decision 13`, `C4` |
| `containers.ts` | `security/containment.md` — the mount set, the protected paths, the writable hole, the flags | `S1` |
| `copilot-authority.ts` | `security/containment.md` — why a credential is redacted out of anything persisted | — |
| `copilot-env.ts` | `security/containment.md`, `decisions.md` — per-project, per-backend state, and why | `S2` |
| `copilot-turns.ts` | `decisions.md`, `security/containment.md` — the shared box, the session transcript, and the eager end of a chat credential | `decision 12` |
| `copilot.ts` | `security/containment.md` — the copilot shares the project's box | `S1` |
| `credentials.ts` | `decisions.md`, `security/containment.md` — `~/.vibeboard/` is not among the mounts; `VIBEBOARD_TOKEN_FILE` is the exception | `decision 10` |
| `devices.ts` | `security/containment.md` — why a hash is stored, and why the `token-` prefix survives its old reason | — |
| `git-measure.ts` | `decisions.md` | `S11` |
| `logging.ts` | `decisions.md` | `decision 20` |
| `opencode-server.ts` | `decisions.md`, `security/containment.md` — the server is the box's main process, one box per project | `decision 12` |
| `process-group.ts` | `decisions.md` | `decision 13` |
| `reaper.ts` | `decisions.md` | `decision 13` |
| `route-context.ts` | `decisions.md` | `decision 20` |
| `run-prompt.ts` | `decisions.md` — it generates the agent's permitted endpoint list from `auth.ts` | `decision 3`, `decision 18`, `decision 40`, `decision 51`, `decision 55`, `decision 60`, `decision 63`, `S9` |
| `run-store.ts` | `decisions.md`, `security/containment.md` — the agent writes a report under `runs/`; this folds it in | `decision 13` |
| `sandbox.ts` | `security/containment.md` — the gate, and why it is a probe | — |
| `service-process.ts` | `decisions.md`, `security/containment.md` — the loop is deliberately **not** boxed; the scope table is what confines it | `decision 13`, `decision 20`, `decision 47` |
| `signin-terminal.ts` | `security/containment.md` — the `VIBEBOARD_TOKEN_FILE` warning it prints | — |
| `signin.ts` | `decisions.md` | `decision 21` |
| `snapshot.ts` | `decisions.md` | `decision 46` |
| `suggestion-store.ts` | `security/containment.md` — the agent cannot write here, so the endpoint is the only way in | — |
| `write-queue.ts` | `decisions.md` | `decision 20`, `C2` |
| `routes/autopilot.ts` | `decisions.md` | `decision 12`, `decision 47` |
| `routes/cards.ts` | `decisions.md` — the create rules: the stamp, the parent link, the duplicate-title refusal | `decision 10`, `decision 44`, `decision 56`, `decision 58`, `decision 61`, `decision 65` |
| `routes/control.ts` | `decisions.md`, `foundation-bootstrap.md` | `decision 3`, `decision 67` |
| `routes/diary.ts` | `security/containment.md` — the "profile denies the file" comment is stale; the read-only mount is what does it now | — |
| `routes/project.ts` | `decisions.md` | `S7` |
| `routes/runs.ts` | `decisions.md` | `decision 3`, `decision 5`, `decision 12`, `decision 18`, `decision 40`, `decision 52`, `decision 60`, `decision 63`, `S6`, `C2` |
| `routes/sandbox.ts` | `security/containment.md` — `profile` in the payload is now the image name | — |
| `routes/suggestions.ts` | `decisions.md` | `decision 49`, `decision 50` |
| `routes/toolchain.ts` | `security/containment.md` — the brokered install, the privileged half | — |

## `src/service/` — the auto-pilot loop, a separate process

| file | pages | cites |
|---|---|---|
| `act.ts` | `decisions.md` | `decision 3`, `decision 8`, `decision 10`, `decision 40`, `decision 43`, `decision 44`, `decision 47`, `decision 50`, `decision 51`, `decision 54`, `decision 55`, `decision 57`, `decision 60`, `decision 66` |
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
| `components/AutopilotPanel.tsx` | `decisions.md` | `decision 52`, `S10`, `C2`, `C4` |
| `components/CardTile.tsx` | `decisions.md` | `decision 45`, `decision 46` |
| `components/DiaryView.tsx` | `decisions.md` | `decision 48` |
| `components/ExecutionView.tsx` | `decisions.md` | `S10` |
| `components/HaltOverlay.tsx` | `decisions.md` | `decision 12` |
| `components/SandboxPanel.tsx` | `security/containment.md` — it renders what is confining agents | — |
| `components/SettingsModal.tsx` | `decisions.md` | `decision 52` |
| `components/SuggestionsPane.tsx` | `decisions.md` | `decision 48`, `decision 49` |

## Repository configuration

| file | pages |
|---|---|
| `src/server/auth.ts` | the scope table is a security property in its own right — see `decisions.md`, `decision 21` |
| `stryker.config.mjs` | its exclusions carry their own reasoning inline; it is invisible to both biome and tsc, so a stale path there scores green over zero mutants |
| `tools/check-citations.mjs` | the gate behind `decisions.md` — `npm run check:citations` |
| `tools/docker/` | the image, the relay, the entrypoint and the install helper — see `security/containment.md` |
