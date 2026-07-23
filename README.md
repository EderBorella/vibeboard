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
in a browser on your own network and drive a project as two linked kanban boards
— but the "database" is not a database. **Every card is a markdown file in a
folder on disk.** The app is a lens over those files, never their owner.

That one decision is the whole idea:

- Your project stays **plain text and git-friendly** — no lock-in, no export.
- The board is **human-readable** and editable with any text editor.
- The same files can be driven by **AI coding agents** (Claude Code, OpenCode),
  so the board you look at and the files an agent edits are one and the same.

It grew out of a simple frustration: driving projects on a home server meant
living in an SSH terminal. VibeBoard replaces that with a visual cockpit you open
at `localhost:PORT` — see the board, click to run agents, watch them work.

## How it works

```
your-project/
├── product/                 # the "what / why" board
│   ├── backlog/
│   ├── in-progress/  P-001.md
│   └── done/
├── engineering/             # the "how" board
│   ├── todo/         E-010.md   →  links: [P-001]
│   ├── review/
│   └── archive/                 # soft-deleted cards, recoverable
├── .vibeboard/config.yaml   # columns, ordering, settings
└── VIBEBOARD.md             # card conventions (also read by AI agents)
```

- **Column = folder.** Moving a card moves its file. The path is the single
  source of truth for a card's board and column.
- **One card = one `.md` file** with YAML frontmatter (`id`, `title`, `tags`,
  `links`, `order`, …) plus a freeform markdown body.
- **Two linked boards.** One product card ↔ many engineering cards.
- **Live sync.** A filesystem watcher pushes changes to the browser in real time
  — whether *you* moved a card or an *agent* did.

## Features

**Available in the POC (Phase 1)**

- Two kanban boards backed by folders-as-columns
- Create / edit / move / reorder / tag / group / link / archive cards
- Card editor with a friendly form **and** a raw-markdown toggle
- Configurable columns per board
- Open any project folder; scan a root for existing VibeBoard projects
- Live filesystem sync to the browser
- A **built-in AI copilot** (headless Claude Code) that can plan work and create,
  edit, and move cards for you by writing the underlying files

**On the roadmap**

- **Skill buttons** — user-defined per-card actions (Execute, Research, Review…),
  each routed to a chosen model and backend (OpenRouter, direct API, Claude Code,
  OpenCode), with token/cost tracking
- **Embedded terminal** — a full interactive agent session in the browser
- **Control dashboard** — view/edit `CLAUDE.md`, `AGENTS.md`, skills and commands,
  plus usage and cost stats
- **External resources** — attach reference folders, PDFs, and notes to a project

## Design principles

- **Local network only.** No public hosting, no cloud, no multi-tenant. It runs
  on your machine and is reached over your LAN.
- **Files are canonical.** The app never becomes the source of truth; disk is.
- **Project-independent.** Point it at any folder; it scaffolds what it needs.
  Switch projects by switching folders.

## Tech stack

Single **Node.js / TypeScript** process:

- **Fastify** — server + WebSocket channel
- **chokidar** — filesystem watching for live board sync
- **node-pty** — drives headless Claude Code and streams it to the UI
- **React + Vite** — the board UI
- **Vitest** — test-driven throughout

## Project status

VibeBoard is being built in the open, test-first, one subsystem at a time,
starting with the files-as-database core. It is a personal project — expect rapid
change while the POC comes together.

## License

Released under the [MIT License](./LICENSE).

## Acknowledgements

Special thanks to **Adam Awan** for the inspiration behind VibeBoard.
