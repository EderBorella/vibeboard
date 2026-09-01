# The smoke test

**Run this before pushing anything that touches boxes, credentials, the run lifecycle or the explorer.**
It takes about ten minutes and it exercises the one thing no gate in this repository can: the product,
running, against a real Docker daemon and a real model.

Say *"run a smoke test"* and this is the sequence.

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

That is the shape to expect here. This test does not look for logic errors; the unit suite is better at
those. It looks for **the assumptions the fakes encode** — what a real daemon prints, what a real model
writes, what a real filesystem already holds.

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

---

## 1. Build and start

```bash
npm run build && npm start
```

**What the banner must say.** It reports the port, the reopened project, the log file, the API socket,
and — the line that matters — `agents run in containers (<image>)`. If it says agents are DISABLED, stop
and read the reason; that is a finding, not a nuisance.

**What silence proves.** If the agent image is already built, the start prints nothing about it. That is
the idempotent path working. If the image is missing it builds it here, streaming into the terminal,
which takes minutes on a first run — also correct, and the reason this build lives in the start script
rather than in a command somebody has to know about.

## 2. The API answers, and the refusals refuse

Read-only first: `GET /` (200), `GET /api/state` (the project is open), `GET /api/sandbox` (`ok: true`).

Then **`POST /api/boxes/build`** with an empty body. With the image present it must answer
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
`src/server/auth/auth.ts`, and absence means admin-only. If that ever answers anything but `401`, stop.

## 3. The explorer marks what is not the user's content

`GET /api/explorer/list?path=` on the project root. Then the same for `.vibeboard`.

| path | expected `sensitive.kind` |
|---|---|
| `.git` | `git-internal` |
| `.vibeboard` | `board-state` |
| `.vibeboard/runs` | `run-scratch` |
| `.gitignore` | **absent** |
| `README.md` | **absent** |

`.gitignore` is the one that matters. It is an ordinary file people edit constantly and it begins with
`.git`, so a prefix match instead of a path-segment match flags it — and a warning on ordinary content
is a dialog people learn to click through, which then costs you the deletion dialogs too.

## 4. A card, and a real run against it

**Write a new card as a file**, the way an agent would, into a column folder under
`<PROJECT>/.vibeboard/boards/<board>/<column>/`. Pick an id above the highest one already present. Keep
the task trivial and self-contained — writing one small file at the project root is ideal, because the
result is checkable by looking at it.

Confirm `GET /api/state` shows it within a second or two: that is the filesystem watcher, and it is the
premise the whole product rests on.

Then dispatch:

```
POST /api/runs   {"board":"…","card":"…","skill":"implement"}
```

**While it runs, check the box.** `docker ps --filter label=io.vibeboard.box=1` must show one container
for the project. And check the per-project OpenCode state directory: if it held a legacy `auth.json`
**file**, it must now be a **symlink** into `~/.cache/vibeboard/creds/opencode/`. Count `*.superseded`
files — one appears only where a legacy copy was neither adopted nor identical to the host, which is
worth knowing about but is not a failure.

**When it settles, the record must say:**

- `status: success`, `outcome: success`
- `fault` **absent** — an `unreadable-report` here means the report identity check rejected what the
  agent wrote, which is a finding
- `filesChanged` non-zero
- and the file the card asked for is on disk, with exactly the contents it asked for

A `failed` with `could not start the agent box` in the report is the incident at the top of this page.

## 5. The copilot

The copilot is driven over the websocket, not over HTTP, so `curl` cannot reach it. Connect to
`ws://localhost:4610/ws` with the admin token in an `Authorization` header and send:

```json
{ "type": "copilot:send", "text": "Reply with exactly the word PONG and nothing else." }
```

**Watch three things, not one:**

1. A `copilot:state` frame with `running: true` arriving **before** the answer. This has been broken
   before — the state was computed before the send, so the UI never learned a turn had started and the
   thinking indicator showed nothing at all.
2. `copilot:event` frames carrying the text.
3. `running: false` afterwards.

An `error` event is a finding; read its `text`, which is a sentence from `core/copilot-errors.ts` and
not a raw provider payload.

## 6. The browser harness

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

- Both host credential files byte-identical to the backup taken in step 0.
- The shared mirrors under `~/.cache/vibeboard/creds/` match the host files.
- `git status` in the throwaway project shows only what the run was asked to produce.

**Then clean up, and ask before you do**: the card, the file the run created, and the backup copies. The
run records are worth keeping — they are the evidence.

---

## When it finds something

Reproduce it against the real thing before you fix it, and **write the test with the real strings**. The
incident above is pinned by a test that spells out `invalid IP` and `<no value>` verbatim, because those
are what a daemon actually printed — a fixture invented from the documentation would have been wrong in
exactly the way the code was.

Then plant the defect back and watch the new test fail. A test written after a bug is fixed is the one
most likely to be passing for the wrong reason.
