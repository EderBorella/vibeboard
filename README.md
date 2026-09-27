<h1 align="center">VibeBoard</h1>

<p align="center">
  <strong>A local-first cockpit for running projects with AI — where your kanban board is just markdown files in folders.</strong>
</p>

<p align="center">
  <em>Status: 🚧 in active development · POC</em>
</p>

---

> ### 🙏 Inspiration
> This project was inspired by **Adam Awan** — thank you for the spark that set it in motion.

---

## What is VibeBoard?

VibeBoard is a self-hosted **cockpit for markdown-backed projects**. You open it
in a browser on your own machine and drive a project as three linked kanban
boards — but the "database" is not a database. **Every card is a markdown file in
a folder on disk.** The app is a lens over those files, never their owner.

That one decision is the whole idea:

- Your project stays **plain text and git-friendly** — no lock-in, no export.
- The board is **human-readable** and editable with any text editor.
- The same files can be driven by **AI coding agents** (Claude Code, OpenCode),
  so the board you look at and the files an agent edits are one and the same.

It grew out of a simple frustration: driving projects from a terminal meant
living in SSH. VibeBoard replaces that with a visual cockpit you open at
`localhost:4610` — see the board, talk to a copilot, watch it work.

## How it works

```
your-project/
├── CLAUDE.md                     # pointer: Claude Code finds this by name, at the root
├── AGENTS.md                     # pointer: OpenCode finds this by name, at the root
└── .vibeboard/                   # everything else VibeBoard owns, in one folder
    ├── boards/
    │   ├── features/             # the "capabilities / roadmap" board
    │   │   ├── backlog/
    │   │   ├── todo/         F-001.md
    │   │   └── done/
    │   ├── product/              # the "what / why" board
    │   │   ├── backlog/
    │   │   ├── in-progress/  P-001.md   →  links: [F-001, E-010]
    │   │   └── done/
    │   └── engineering/          # the "how" board
    │       ├── todo/         E-010.md
    │       ├── review/
    │       ├── archive/          # soft-deleted cards, recoverable
    │       └── results/          # one file per skill run, per card — not a column
    ├── skills/                   # <slug>/SKILL.md — the skill rail beside a card
    ├── docs/                     # project docs, editable from Project Control
    ├── resources/                # reference files you attach to a run
    ├── PROJECT-LOG.md            # the project log — append-only, one line per event
    ├── VIBEBOARD.md              # card conventions (also read by AI agents)
    ├── INSTRUCTIONS.md           # your own standing instructions for the copilot
    ├── config.yaml               # columns, ordering, settings
    ├── resources.yaml            # the links registry
    ├── chat/                     # copilot transcripts (git-ignore these)
    └── runs/                     # run transcripts and staged agent reports
```

Only the two pointer files sit at the root, and not by choice: each CLI
auto-discovers its own by name in the working directory, so neither can live
inside the folder. Everything else is one folder deep, which keeps an adopted
repository's own root untouched.

- **Column = folder.** Moving a card moves its file. The path is the single
  source of truth for a card's board and column.
- **One card = one `.md` file** with YAML frontmatter (`id`, `title`, `tags`,
  `links`, `order`, …) plus a freeform markdown body.
- **Three linked boards.** Links are symmetric and any pairing is allowed —
  feature ↔ product ↔ engineering, or within a board.
- **Live sync.** A filesystem watcher pushes changes to the browser in real time
  — whether *you* moved a card or an *agent* did.

## Getting started

### Prerequisites

- **Docker** — VibeBoard runs every agent inside a container, and that is what confines it. Any
  distribution works, and so does macOS; there is no per-distribution setup and nothing to `sudo`.
  The board, the explorer and the settings work anywhere Node does; **dispatching a run or a chat
  turn refuses** without Docker, and says so. Native Windows is not supported for agents —
  Windows compatibility is planned as a feature of its own once auto-pilot lands.
- **Node.js >= 20**
- **At least one AI CLI**, installed and already authenticated:
  - [Claude Code](https://claude.com/claude-code) (`claude`), and/or
  - [OpenCode](https://opencode.ai) (`opencode`)

  VibeBoard drives whichever you pick as a subprocess and reuses its existing
  login — it never asks for or stores API keys. Choose a model that supports
  **tool use**, or the copilot cannot read or write your files.

### Install and run

```bash
npm install
npm run build
npm start            # → http://localhost:4610
```

### Development

```bash
npm run dev          # server with reload (tsx watch)
npm run web:dev      # Vite dev server with hot reload, proxying the API
npm test             # vitest — the suite is the spec
```

## Configuration

All configuration is via environment variables — see [`.env.example`](./.env.example)
for the annotated list. Copy it to `.env` and VibeBoard loads it automatically on
startup; anything already exported in your shell takes precedence.

| Variable | Default | What it does |
|---|---|---|
| `VIBEBOARD_PORT` | `4610` | Port for the web UI + API |
| `VIBEBOARD_HOST` | `127.0.0.1` | Interface to bind. `0.0.0.0` exposes it to your LAN |
| `VIBEBOARD_ROOT` | parent of cwd | Folder scanned for existing projects |
| `VIBEBOARD_LOG_LEVEL` | `info` | Server log level. `silent` turns logging off |
| `VIBEBOARD_LOG_DIR` | `logs/` in the install | Where the log files go. Empty writes to stdout instead |
| `VIBEBOARD_LOG_KEEP` | `14` | Daily log files to keep; older ones are pruned at startup |
| `VIBEBOARD_CLAUDE_BIN` | `claude` | Claude Code executable |
| `VIBEBOARD_OPENCODE_BIN` | `opencode` | OpenCode executable |
| `VIBEBOARD_OPENCODE_PORT` | `0` (OS-assigned) | Port for the spawned `opencode serve` |
| `VIBEBOARD_OPENCODE_URL` | *(unset)* | Attach to your own `opencode serve` instead of spawning one |
| `VIBEBOARD_COPILOT_TIMEOUT_MS` | `180000` | Per-turn copilot timeout |
| `VIBEBOARD_RUN_TIMEOUT_MS` | `1800000` | How long a skill run may take before it is stopped |
| `VIBEBOARD_COPILOT_HOME` | `~/.vibeboard/copilot` | Clean config home used to isolate the copilot |
| `VIBEBOARD_COPILOT_ISOLATE` | isolation on | Set `0` to let the copilot load your personal CLI config |

Per-project settings (board columns, chat retention, copilot backend and model,
and `maxConcurrentRuns`) live in that project's `.vibeboard/config.yaml`.

The server writes one JSON-lines log file per day to `logs/` inside its own
folder — every request, and any error a route throws, with its stack. It is
gitignored, pruned to the last two weeks, and the path is printed at startup;
`tail -f` it, or pipe it through `jq` when something misbehaves.

### The agent sandbox

Agents build your project; they must not be able to rewrite the things that govern them. Every agent
runs inside a container — not because a prompt asks it to stay put, but because it has nowhere else
to go.

**You do not have to build that container yourself.** `npm start` checks for the image and builds it if
it is missing, streaming the build into the terminal it was started from — a few minutes the first time,
nothing at all after that. Settings offers the same build for the case where the image goes missing while
the server is up. `npm run box:build` still exists and does the same thing, by hand.

The Claude Code and OpenCode inside it are pinned to the versions installed on your machine, read at
build time, because the box and the host resume sessions from the same files. When yours move on, the
start says so and Settings offers **Rebuild the agent image**; agents keep running on the old one until
you do. A box that is already running keeps the image it started from, so rebuild the agent boxes
afterwards — or restart VibeBoard, which replaces them.

**Docker is required.** Without it, the board, the file explorer and Settings all work and no agent will
start; the refusal says exactly that. There is deliberately no fallback: maintaining a second, weaker
containment path would mean most people quietly ran the weaker one.

One box per project and backend, created with the project and thrown away when VibeBoard stops. Your
project is mounted writable, so an agent can build, test and commit normally. Mounted **read-only**
on top of it: `.vibeboard/` — cards and run records, `config.yaml`, skills, `foundation/`, the
instructions injected into every turn, the log, suggestions, chat transcripts — plus `.git/hooks` and
`.git/config`, which are how an agent would otherwise arrange to run code on *your* machine at your
next commit. It changes the board by calling the API, with a per-run credential scoped to the one card
it was given.

Not mounted at all, and so not merely denied: everything else on your disk, including VibeBoard's own
credential in `~/.vibeboard`.

An agent can install what a job needs. Language packages (pip, npm, cargo, go) it installs itself,
unprivileged; system packages it asks VibeBoard for, which installs them into the box as root. The
image ships no `sudo`, so the agent never holds root itself — and anything installed goes with the box,
which is what keeps a box disposable.

Outbound, the box reaches the internet — it has to, to reach the model — but **not** the private
network: not your LAN, and not the other services running on your machine, which typically ask for no
password. Those rules are applied from outside the box and cannot be removed from within it. This is
not exfiltration control, and nothing at this layer is.

The mounts are in `src/server/boxes/containers.ts`, and they are short enough to read.

### ⚠️ Security

**The copilot VibeBoard spawns auto-approves its own tool calls** — it can read
and write anywhere in the open project, which is why it runs inside the sandbox
described above. The API requires a credential, and agents get narrower, per-run
ones. It still binds to `127.0.0.1` (this machine only) by default: an agent can
reach loopback too, so the sandbox and the credential are what separate them,
not the network.

**Signing in.** Open the board and it signs itself in — no token to copy, and
nothing printed in the terminal. The first page load claims a credential for
that browser, which is safe exactly once: before any browser is signed in, no
agent can exist, because starting one needs a credential nobody holds yet.
Every later browser has to be allowed from one that is already in — it shows a
prompt naming what is asking and the address it came from. Sign-in is refused
while agents are running.

The credential is held as an `HttpOnly` cookie, so the page itself cannot read
it and it never appears in a URL, in the log, or on your screen. Settings ›
Signed-in browsers lists them and signs one out. **Sign every browser out** is
how you replace a credential you think somebody else has seen: it forgets them
all, and the next page load signs itself in again. Locked out of every device?
`kill -USR2 <pid>` does the same from the terminal.

Setting `VIBEBOARD_HOST=0.0.0.0` makes the board reachable from other devices.
On a shared network, be aware that "the first page load" then means whoever
reaches the port first after a fresh install — in practice you, seconds after
starting the server, but it is a real window. And *anyone allowed in* can drive
an agent with filesystem write access using your CLI credentials. Only do it on
a network you trust, and never expose it to the public internet.

## Features

**Working today**

- Three kanban boards backed by folders-as-columns
- Create / edit / move / reorder / tag / group / link / archive cards
- **Utility dock** at the bottom of the work area: cards open as tabs there rather
  than in a modal, so the boards and the copilot stay usable, and a card's links
  are clickable — following one opens it as another tab. Collapsible, and built to
  host other tools (a terminal) as further panes
- **Click any field to edit it**, in place, committing on its own — no form, no
  Save button. `Raw` in the dock swaps the card for its file, frontmatter and all
- **Skill rail** beside an open card, driven by `.vibeboard/skills/*/SKILL.md` files
  you can add or edit. A skill declares the boards and columns it belongs to, so
  the rail shows only what fits the card in front of you, and a file that fails
  validation is reported with the reason rather than silently ignored. Author one
  as **fields** in Project Control — name, description, and boards and columns
  ticked from the live config, so an invalid scope cannot be typed — with `Raw`
  always one click away, because the file is still the truth. A skill ticked
  **for auto-pilot only** is left off the rail: the lifecycle's and setup's are,
  until you untick one to run it by hand
- **Run a skill as an agent**: pick connector, model, effort and mode (all
  pre-filled from your defaults), add a prompt and attach project files, and the
  agent works the card. It reports back through a file contract, so a run either
  **succeeds** — report on the card, with links to any cards it created — or
  **needs you**, with options to choose from. Choosing one dispatches again
  carrying the previous report, so the work iterates until you close the card.
  A run that succeeds **moves its card to the next column** unless its skill says
  otherwise, so the board shows the work happened. A run you start by hand is
  yours: auto-pilot neither counts it against a card's attempts nor reads it
- **Execution dashboard**: every run in the project across In progress, Requires
  attention and Done, with a badge when something is waiting on you. Stop a run
  from there, or open the card it belongs to. Runs past
  `maxConcurrentRuns` (default 3) queue rather than being refused
- **Tag filter** across all three boards at once: click a tag on a card or a chip
  in the bar, and each further tag narrows the boards to cards carrying all of them
- Symmetric card links across any pair of boards
- Configurable columns per board
- Open any project folder, or scan a root for existing VibeBoard projects
- Live filesystem sync to the browser over WebSocket
- **AI copilot** with two interchangeable backends — Claude Code and OpenCode —
  switchable from the chat, each with its own modes and reasoning effort
- **Capability-aware model picker**: search and filter by tool use, vision,
  free tier or provider, with context window and per-million pricing shown
- **Managed chat history**: transcripts persist per project, survive reloads,
  and are browsable in a switcher with configurable retention
- **What each run cost**, recorded on the run itself: money, wall time, model
  round-trips, context and output tokens, and how many files it changed — for runs
  that failed as well as ones that worked, since those spent tokens too. Shown in
  full on the report, and as a single figure on the card and the Execution dashboard
- **Totals across runs**, per card and per project, summed from the records on
  disk. Usage that no backend reported is shown as unreported rather than as zero:
  on a subscription plan the figure is API-equivalent, not what you were billed.
  A card also shows how many attempts each skill has used against its cap
- **Stopping, in three levels**: a soft stop that only stops dispatching, an
  emergency stop that kills every agent in the project and halts it, and a restart
  that brings it back. A halted project starts nothing — not even from the chat —
  and says so in an overlay that carries the reason, the time and the way back
- **Fix board**, beside the emergency stop: hands a board auto-pilot cannot move to the copilot, in a
  conversation of its own that you watch. For that one answer it may clear cards' spent attempts,
  reorder and restore cards as well as edit, move and link them — never start auto-pilot, change
  settings or touch the foundation documents — and it ends with a short report of what it changed.
  Every change it makes is logged with the conversation that made it
- **Project Log tab**: the narrative of what happened to the project, one line per
  event, oldest at the bottom. Append-only and written through an endpoint rather
  than edited — so the record cannot be quietly rewritten — with a box for adding
  your own entry for anything you did by hand
- **Project Control tab**: view and edit the documents that steer the models —
  `.vibeboard/INSTRUCTIONS.md`, skills, project docs, and a resources registry
- Config isolation, so your personal `CLAUDE.md`, plugins and hooks do not leak
  into the project's copilot
- Themes (Cyberpunk, Classic Dark)

**On the roadmap**

- **Embedded terminal** — a full interactive agent session in the browser
- **Plugin management** in the Project Control tab
- **External resources** — attach reference *folders* and PDFs to a project.
  Markdown notes and a link registry are already in Project Control; what is
  missing is anything that is not a single markdown file

## Design principles

- **Local-first.** No cloud, no multi-tenant, no telemetry. It runs on your
  machine, and is reachable over your LAN only if you opt in.
- **Files are canonical.** The app never becomes the source of truth; disk is.
- **Project-independent.** Point it at any folder; it scaffolds what it needs.
  Switch projects by switching folders.
- **Bring your own agent.** VibeBoard drives CLIs you already have and trust,
  and stores no credentials of its own.

## Tech stack

A single **Node.js / TypeScript** process:

- **Fastify** (+ `@fastify/websocket`, `@fastify/static`) — API, live channel, UI hosting
- **chokidar** — filesystem watching for live board sync
- **gray-matter** + **yaml** — card frontmatter and project config
- **React 19 + Vite** — the board UI
- **Vitest** — test-driven throughout

The copilots are driven directly: Claude Code as a spawned process streaming
`stream-json`, and OpenCode over HTTP against a persistent `opencode serve`.

## Project status

VibeBoard is being built in the open, test-first, one subsystem at a time,
starting with the files-as-database core. It is a personal project — expect rapid
change while the POC comes together.

## License

Released under the [MIT License](./LICENSE).

## Acknowledgements

Special thanks to **Adam Awan** for the inspiration behind VibeBoard.
