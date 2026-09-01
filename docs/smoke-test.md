# The smoke test

**The manual pass against a running product, covering every part of it.** Say *"run a smoke test"* and
this is the sequence.

Part A is the machine — it takes about ten minutes and it is the minimum for any change that touches
boxes, credentials, the run lifecycle or the explorer. Part B walks every surface the app has, and takes
about half an hour. **Do Part B before a release, and for any change you cannot confine to one tab.**

---

## Why it exists, in one incident

A branch passed `npm run check` — four typechecks and twelve source gates — plus **4,620 unit tests** and
the browser harness. The very first live dispatch failed:

    could not start the agent box: docker: Error response from daemon: Conflict.
    The container name "/vibeboard-…-opencode" is already in use by container "04f35f9369bf…"

Every agent run on that machine was broken. The cause was one Go template in a `docker inspect` call:
`.NetworkSettings` is rendered from a map with no `GlobalIPv6Address` key, so the template did not print
an empty string, it **errored** — and a non-zero exit from that call means *"no such container"*, so the
box manager created one that already existed.

**Nothing in the suite could have caught it.** Every unit test drives a fake docker, so the template is
never executed. `test/box-integration.test.ts` does use a real daemon, and only ever *creates* boxes —
so it never reaches the adoption path, which is where the bug lived. A test that creates but never
re-adopts cannot see a bug in adoption.

That is the shape to expect here. This test is not better than the unit suite at logic. It is the only
thing that can see **the assumptions the fakes encode**: what a real daemon prints, what a real model
writes, what a real filesystem already holds, and what a whole screen looks like once every part of it
has real data behind it.

---

## Before you start

You need Docker running, a signed-in agent credential, and a **throwaway project** to aim at. Ask the
owner which project is safe; do not pick one yourself. Everything below assumes:

- `PROJECT` — the absolute path of that throwaway project
- `TOKEN` — the admin token, `~/.vibeboard/token`
- `BASE` — `http://localhost:4610`

**Take a credential backup first.** The start path reconciles the host's Claude and OpenCode credentials
in both directions, and the OpenCode migration rewrites per-project state. Copy
`~/.claude/.credentials.json` and `~/.local/share/opencode/auth.json` somewhere outside the repository
before the first start, and diff them at the end.

**Prefer the browser where a browser can do it.** Curl proves a route answers; it cannot see a control
that renders behind another one, a list that never re-renders, or a button that does nothing. Part B is
written as things to *do on screen*, with the endpoint named only so you know what to blame.

---

# Part A — the machine

## A1. Build and start

```bash
npm run build && npm start
```

**What the banner must say.** It reports the port, the reopened project, the log file, the API socket,
and — the line that matters — `agents run in containers (<image>)`. If it says agents are DISABLED, stop
and read the reason; that is a finding, not a nuisance.

**What silence proves.** If the agent image is already built, the start prints nothing about it. That is
the idempotent path working. If the image is missing it builds it here, streaming into the terminal,
which takes minutes on a first run — also correct, and the reason that build lives in the start script
rather than in a command somebody has to know about.

## A2. The refusals refuse

`POST /api/boxes/build` with an empty body. With the image present it must answer
`{"ok":true,"already":true}` and do nothing.

Then the delete guards, which are the important ones, because this is the only recursive delete a user
can aim. **All four must refuse and nothing may be removed:**

| aimed at | expected |
|---|---|
| the project, with the wrong name typed | `400`, naming the folder it wants |
| a directory that is not a project (`/tmp` is a good one) | `400`, and **check `/tmp` is still there** |
| a relative path | `400`, about absolute paths |
| the project, with **no `Authorization` header** | `401` |

The last one is the whole of the auth model: `POST /api/project/delete` is absent from the scope table in
`src/server/auth/auth.ts`, and absence means admin-only. Every route in that file's table is reachable by
some agent scope **on purpose**; every route not in it is admin-only **by default**. If an absent route
ever answers anything but `401` without a credential, stop.

## A3. A card, and a real run against it

**Write a new card as a file**, the way an agent would, into a column folder under
`<PROJECT>/.vibeboard/boards/<board>/<column>/`. Pick an id above the highest already present. Keep the
task trivial and self-contained — writing one small file at the project root is ideal, because the result
is checkable by looking at it.

Confirm `GET /api/state` shows it within a second or two: that is the filesystem watcher, and it is the
premise the whole product rests on.

Then dispatch `POST /api/runs` with `{board, card, skill: "implement"}`.

**While it runs**, `docker ps --filter label=io.vibeboard.box=1` must show one container for the project.
And check the per-project OpenCode state directory: if it held a legacy `auth.json` **file**, it must now
be a **symlink** into `~/.cache/vibeboard/creds/opencode/`. Count `*.superseded` files — one appears only
where a legacy copy was neither adopted nor identical to the host, which is worth knowing about but is
not a failure.

**When it settles, the record must say** `status: success`, `outcome: success`, **no `fault`**, a non-zero
`filesChanged`, and the file the card asked for must be on disk with exactly the contents it asked for.

An `unreadable-report` fault means the report identity check rejected what the agent wrote. A `failed`
with *"could not start the agent box"* is the incident at the top of this page.

## A4. The copilot

Driven over the websocket, not over HTTP, so `curl` cannot reach it. Connect to `ws://localhost:4610/ws`
with the admin token in an `Authorization` header and send:

```json
{ "type": "copilot:send", "text": "Reply with exactly the word PONG and nothing else." }
```

**Watch three things, not one:**

1. A `copilot:state` frame with `running: true` arriving **before** the answer. This has been broken
   before — the state was computed before the send, so the UI never learned a turn had started and the
   thinking indicator showed nothing at all.
2. `copilot:event` frames carrying the text.
3. `running: false` afterwards.

An `error` event is a finding; read its `text`, which is a sentence from `core/copilot-errors.ts` and not
a raw provider payload. When one appears in the browser it must carry a **Retry** beside it, and the
message must be a sentence rather than the provider's raw JSON.

**Then the rest of the chat, which is not one message.** `copilot:new` starts a fresh one, `copilot:open`
reopens a stored one and resumes the underlying session where the backend matches (a mismatch continues
fresh and says so), `copilot:delete` removes one, and `copilot:compact` sends `/compact`. Switch between
two chats and confirm each keeps its own transcript.

**And the authority**, which is separate from the chat and is the copilot's permission to call the API on
your behalf (`GET`/`POST /api/copilot/authority`). Grant it, confirm the copilot can then read the board,
and confirm it is **revoked by switching project** — a credential names the project it was minted
against, and coming back must not silently hand the same one over again.

---

# Part B — every surface

Five tabs, the bar above them, the chrome around all of it, and the two screens you only see when
something is wrong. Work through them in the browser.

**Every route in `src/server/` is reachable from one of the sections below.** If you add a route and it
does not belong to any of them, that is worth noticing before you add a section for it: it may mean the
feature has no home on screen either.

## B1. Boards

The default tab, and the largest surface. **Three boards** — features, product, engineering — each with
its own column set.

- **Read one card.** Open it. Its title, description, tags, links and body all render; the raw editor
  round-trips (`PUT /api/cards/:board/:id/raw`).
- **Create a card** (`POST /api/cards`) and confirm it appears without a reload.
- **Drag it within a column and into another one** (`POST …/place`). The order must survive a reload —
  that is a file rename on disk, and the column a card is in *is* the folder it sits in.
- **Archive it and restore it** (`…/archive`, `…/restore`). The archive view is its own surface.
- **Link two cards** (`PUT …/links`) and confirm the link renders on both.
- **Flags** (`…/flags`) — the ones an agent may set on itself.

The thing to watch across all of it: **the board is pushed, not polled.** Edit a card file on disk with
an editor and the board must move on its own. If it does not, the watcher is the fault, not the UI.

## B2. Execution

Runs, and everything that judges them.

- The run from A3 appears with its report, its usage and its timings.
- **Dispatch from the pane** rather than from curl — model and effort come from the picker, and the
  picker is its own surface (`GET /api/models`, `GET /api/model-status`).
- **Cancel a run** mid-flight (`POST /api/runs/:run/cancel`). It must record `cancelled`, and a
  cancellation must not burn an attempt.
- **Forgive attempts** on a card (`POST /api/runs/:board/:card/forgive`) and the project-level one
  (`/runs/project/forgive`). Both are the human override for a card the machine has cornered.
- **Resolve** a run that needs it — the card version and the project version are different routes on
  purpose (`/runs/:board/:card/:run/resolve`, `/project-runs/:run/resolve`).
- **The verdict on a run** (`…/:run/verification`) is written by the loop that judged it and is
  **service-scoped**: neither working scope may reach it, because a run that could write its own
  verification would be advancing itself on self-assessment. Try it with a work credential and watch it
  be refused.
- Check the accounting (`GET /api/accounting`) matches what the runs actually cost.

## B3. Suggestions

The channel an agent files a finding into when it notices something outside the card it was given — the
answer to scope creep that is neither "do it anyway" nor "lose it".

- **File one** (`POST /api/suggestions`) and confirm it appears.
- **Turn one into a card** (`POST /api/suggestions/:id/card`). The card must exist **before** the
  suggestion is retired: marking it first and then failing would lose the finding, which is the one
  outcome this whole channel exists to prevent.
- **Dismiss one** (`PATCH /api/suggestions/:id`).
- Filing is open to both working scopes and **reading the list is not** — a work agent that could see
  every open problem in the project is a work agent scoped to one card talking itself into five.

## B4. Project Log

The diary — `.vibeboard/PROJECT-LOG.md`, append-only, one line per event.

- Entries from the A3 run are there, in order, with iteration numbers.
- `POST /api/log` appends; the file is the truth and the tab is a view of it.
- Append a line to the file by hand and watch the tab follow.

## B5. Project Control

The allow-listed documents, and the only writable surface that is *not* the whole filesystem. Five
categories: **instructions, foundation, skills, docs, resources**.

- Each category lists (`GET /api/control/files`) and each file opens (`GET /api/control/file`).
- **Edit and save** a foundation document (`PUT /api/control/foundation/:name`).
- **Create and rename** (`POST /api/control/create`, `/rename`) and **delete** (`DELETE`).
- **Resources** round-trip (`GET`/`PUT /api/control/resources`) — the external links agents are handed.
- **Skills** edit (`PUT /api/skills/:slug`) and the catalogue lists (`GET /api/skills`).
- **The smoke declaration** (`POST /api/foundation/smoke`) — the command a project declares as proof it
  runs, which is deliberately not allowed to be one of the gates.

The path sandbox is the point here: this tab reaches a **category allow-list**, not the project. A path
outside it must be refused, and that refusal is worth trying once (`../` in a filename).

## B6. Explorer

The whole project as a filesystem, bounded only by the project root.

- The tree lists, folders expand, a text file opens in the editor and saves (`PUT /api/explorer/file`).
- **Create, rename, move and delete** (`POST /explorer/create`, `/rename`, `/move`,
  `DELETE /explorer/entry`, `/tree`). Deleting a folder asks for the folder's name to be typed.
- A **binary** file says so instead of loading into a textarea; a **too-large** one says that instead.
- A **symlink** is marked, and one pointing outside the project is marked `outside` and is listed but
  never opened.
- **The markers**, which is the check with a known trap:

| path | expected marker |
|---|---|
| `.git` | `git` (git-internal) |
| `.vibeboard` | `board state` |
| `.vibeboard/runs` | `run files` (run-scratch) |
| `.gitignore` | **none** |
| `README.md` | **none** |

`.gitignore` is the one that matters. It is an ordinary file people edit constantly and it begins with
`.git`, so a prefix match instead of a path-segment match flags it — and a warning on ordinary content is
a dialog people learn to click through, which then costs you the deletion dialogs too.

- **Save over `.vibeboard/config.yaml`.** A dialog must appear **before** the write, quoting the server's
  own sentence, and it must not be dressed as a deletion — no red, no typing. Cancel it and confirm
  nothing was written and the buffer is still dirty.

## B7. Auto-pilot

The bar under the header, on every tab. This is the part with the most states and the fewest ways to
reach them by accident.

- **Readiness** (`GET /api/autopilot/readiness`) with a project that is not ready: every blocker carries
  a **sentence**, never a bare boolean. Read them — they are the whole design.
- **Start** (`POST /autopilot/start`), watch it dispatch, then **soft stop** (`/stop`). The state on disk
  survives a reload; that is the point of it being a file.
- **A soft stop on a project that never ran is a no-op** — 200, and the state is untouched.
- **Emergency stop** (`/kill`). The overlay appears and a reload does not get you out of it. A soft stop
  while halted is refused, naming Restart.
- **Restart** (`/restart`) clears the halt and the overlay.
- **Gates reviewed** (`/autopilot/gates-reviewed`) — a person confirming they have read commands an agent
  wrote. An agent must not be able to clear it.
- **Kill in one tab raises the overlay in another.** Open two, and check.

## B8. Settings

- **Columns**: rename one, reorder them, add one. Renaming moves a folder, so the cards come with it. A
  column holding cards cannot be removed, and renaming and reordering in one save is refused.
- **Models and effort**, per backend, and switching the backend keeps each one's own setting.
- **Context budget**, and the bar that reads it.
- **Agent sandbox**: what it says about containment, *Rebuild the agent boxes*, and — only when the image
  is what is missing — *Build the agent image*. It must **not** offer to build when the daemon is down.
- **The OpenCode server**, on that backend only: *Restart server* (`POST /api/opencode/restart`) and,
  when `VIBEBOARD_OPENCODE_URL` is set, *Take over with a managed server* (`/takeover`). Claude Code
  spawns a process per turn and has no server, so neither button may appear for it.
- **The brokered install** (`POST /api/toolchain/install`) — the one path that runs anything in a box as
  root. It installs into the container the caller is already in, which is thrown away when VibeBoard
  stops, and it must refuse anything that is not a package name.
- **Diagnostics** (`GET`/`PATCH /api/settings`) — the debug-log switch, which is app-level and saves
  itself rather than waiting for Save.
- **Signed-in browsers**: the list, and signing one out (`DELETE /api/signin/devices/:id`).
- **Delete this project** — read the dialog, type the name, then **cancel**. Do not run it here unless
  deleting the throwaway project is the thing you meant to test.

## B9. The gate, sign-in, and the chrome

- **The project gate**: list projects (`GET /api/projects`), open one (`/project/open`), and **scaffold**
  a new one (`/project/scaffold`) in both modes — greenfield gets sample cards, brownfield does not.
  Switching project while auto-pilot runs is refused; reopening the project already open is not.
- **Sign-in**: from a second browser or a private window, request access and approve it from the first
  (`POST /api/signin/approve/:id`), then refuse one (`/refuse/:id`). `POST /signin/clear` signs everything
  out — the way back in when nobody can get in.
- **The top bar**: the connection light, the sandbox light, the tab switcher, the copilot toggle.
- **Themes.** Switch between all three. Every surface, not just the one you are on.
- **Reconnect.** Stop the server with the browser open, start it again, and confirm the tab recovers
  without a reload.

## B10. The browser harness

```bash
npm run visual
```

It has a layout engine, which jsdom does not, so it is the only thing that can see a value appear on a
surface for the first time. A new radius or font size reported here is either a regression or a
deliberate change — decide which, and if it was deliberate re-record with `npm run visual:record` and
commit the baseline with the change that caused it.

**Read the whole output, not the tail.** A truncated read of this harness has already hidden three
failures once.

If a number in the re-recorded baseline moves on surfaces your change does not touch, check whether
`main` re-records the same number before you attribute it to yourself. `examined.*` is recorded rather
than asserted, so it drifts silently and is easy to blame on the wrong commit.

---

## Afterwards

**Prove you changed nothing you did not mean to.**

- Both host credential files byte-identical to the backup taken before the first start.
- The shared mirrors under `~/.cache/vibeboard/creds/` match the host files.
- `git status` in the throwaway project shows only what the run was asked to produce.

**Then clean up, and ask before you do**: the card, the file the run created, anything scaffolded, and
the backup copies. The run records are worth keeping — they are the evidence.

---

## When it finds something

Reproduce it against the real thing before you fix it, and **write the test with the real strings**. The
incident at the top is pinned by a test that spells out `invalid IP` and `<no value>` verbatim, because
those are what a daemon actually printed — a fixture invented from the documentation would have been
wrong in exactly the way the code was.

Then plant the defect back and watch the new test fail. A test written after a bug is fixed is the one
most likely to be passing for the wrong reason.
