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
├── features/                # the "capabilities / roadmap" board
│   ├── backlog/
│   ├── todo/         F-001.md
│   └── done/
├── product/                 # the "what / why" board
│   ├── backlog/
│   ├── in-progress/  P-001.md   →  links: [F-001, E-010]
│   └── done/
├── engineering/             # the "how" board
│   ├── todo/         E-010.md
│   ├── review/
│   └── archive/                 # soft-deleted cards, recoverable
├── .vibeboard/
│   ├── config.yaml           # columns, ordering, settings
│   └── chat/                 # copilot transcripts (git-ignore these)
├── VIBEBOARD.md             # card conventions (also read by AI agents)
└── INSTRUCTIONS.md          # your own standing instructions for the copilot
```

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
| `VIBEBOARD_CLAUDE_BIN` | `claude` | Claude Code executable |
| `VIBEBOARD_OPENCODE_BIN` | `opencode` | OpenCode executable |
| `VIBEBOARD_OPENCODE_PORT` | `0` (OS-assigned) | Port for the spawned `opencode serve` |
| `VIBEBOARD_OPENCODE_URL` | *(unset)* | Attach to your own `opencode serve` instead of spawning one |
| `VIBEBOARD_COPILOT_TIMEOUT_MS` | `180000` | Per-turn copilot timeout |
| `VIBEBOARD_COPILOT_HOME` | `~/.vibeboard/copilot` | Clean config home used to isolate the copilot |
| `VIBEBOARD_COPILOT_ISOLATE` | isolation on | Set `0` to let the copilot load your personal CLI config |

Per-project settings (board columns, chat retention, copilot backend and model)
live in that project's `.vibeboard/config.yaml` and are editable in the UI.

### ⚠️ Security

**VibeBoard has no authentication, and the copilot it spawns auto-approves tool
calls** — it can read and write any file in the open project. It therefore binds
to `127.0.0.1` (this machine only) by default.

Setting `VIBEBOARD_HOST=0.0.0.0` makes the board reachable from other devices,
and *anyone who can reach that port* can drive an agent with filesystem write
access using your CLI credentials. Only do it on a network you trust, and never
expose it to the public internet.

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
- **Skill rail** beside an open card, driven by `.claude/skills/*/SKILL.md` files
  you can add or edit. A skill declares the boards and columns it belongs to, so
  the rail shows only what fits the card in front of you, and a file that fails
  validation is reported with the reason rather than silently ignored. Dispatch
  arrives with the run engine
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
- **Project Control tab**: view and edit the documents that steer the models —
  `INSTRUCTIONS.md`, skills, project docs, and a resources registry
- Config isolation, so your personal `CLAUDE.md`, plugins and hooks do not leak
  into the project's copilot
- Themes (Cyberpunk, Classic Dark)

**On the roadmap**

- **Skill dispatch** — run a card's skill as an agent: pick backend, model and
  effort, add a prompt and attachments, and get a report back that either
  succeeds or asks you a question. The rail and the skill files are in place;
  the run engine, the reports and the Execution dashboard are next
- **Embedded terminal** — a full interactive agent session in the browser
- **Plugin management** in the Project Control tab
- **External resources** — attach reference folders, PDFs, and notes to a project

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
