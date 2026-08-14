# Bootstrapping a project's foundation documents

**Point the copilot at this file** once the project's README says something real. It describes the
five documents auto-pilot refuses to start without, what each one has to decide, and the two exact
machine contracts that will otherwise fail silently-looking checks.

Everything here is derived from the code that reads these files — `src/store/project/foundation.ts`,
`src/store/project/readme.ts` and the readiness composer in `src/server/routes/autopilot.ts`. If a rule below
disagrees with those, they win and this file is stale.

---

## Read this first: the copilot needs authorising

The copilot cannot touch `.vibeboard/foundation/` by writing files — its container mounts that folder
read-only, and that is deliberate: these documents hold the gates a run is judged against. It writes
them through an endpoint instead, and only once **you** have granted it.

1. Press **Authorise** in the copilot panel. That mints a credential for the current conversation and
   tells the copilot the exact endpoints it opens. It is revoked when the chat or the project changes.
2. Ask it to work through this document. It writes each file with
   `PUT /api/control/foundation/:name`.
3. **If it changes `CODE-QUALITY.md` or `TESTING.md`, auto-pilot will not start or dispatch** until
   you have read the commands and pressed **I have read the gate commands** in the auto-pilot panel.
   That is not bureaucracy — see the shell warning below.

Without authorising, it can read everything and change nothing. If it claims to have written a file
while unauthorised, it has not: check **Project Control → Foundation**, where a document that was
never written is listed and empty.

## The precondition: the README must clear its own gate

Auto-pilot derives the entire feature list from the README, so it is the input to everything below and
is checked mechanically before any of it:

- A file at the **project root** named `README`, `README.md`, `README.markdown` or `README.txt`
  (case-insensitive; an extensionless `README` counts).
- **At least 200 characters ignoring all whitespace.** A title and a badge do not clear this.

The check is deliberately mechanical — it catches a stub, not a bad description. If the README clears
200 characters but does not actually say what is being built, every document below inherits the
vagueness, so read it critically before deriving anything from it.

**Never write the foundation documents from the repository's code alone.** They are decisions about
what the project *will* be, taken from the README. Reading the existing source to discover the stack
is right; inventing a stack the README does not imply is not.

---

## The five documents

All five live in `.vibeboard/foundation/`. **An empty file counts as missing** — the check trims the
content and treats whitespace as absent, so saving an untouched editor buys nothing.

| File | What it has to decide |
|---|---|
| `STACK.md` | languages, frameworks, libraries, **pinned versions** |
| `CODE-QUALITY.md` | the gates: lint, types, tests — commands that must pass. **Machine-read.** |
| `TESTING.md` | test strategy, and what a smoke test means here. **Machine-read.** |
| `UX.md` | flows, interaction principles |
| `DESIGN.md` | visual language, tokens, components |

Write real prose in each. These are the documents every run is bound by, so a placeholder is worse
than an absence: absence blocks and says so, a placeholder passes the check and misleads every agent
that reads it.

---

## Contract 1 — `CODE-QUALITY.md` frontmatter

The gates are read from **YAML frontmatter**, not from a fenced block in the prose. At least one gate,
and every gate needs a non-empty `name` and `command`.

```markdown
---
gates:
  - name: lint
    command: npm run lint
  - name: types
    command: npm run typecheck
  - name: tests
    command: npm test
---

# Code quality

Prose for the human below the frontmatter: what each gate is for, what it will not catch, and the
conventions a reviewer applies that no command can check.
```

How this fails, and what you get told:

| What you wrote | The blocker |
|---|---|
| no file | `foundation/CODE-QUALITY.md does not exist, so there are no gates to run.` |
| frontmatter with a YAML error | `…has frontmatter that will not parse, so its gates cannot be read.` |
| no `gates:` key, or an empty list | `…declares no gates, and a card cannot pass a gate set that is empty.` |
| a gate with no `name` | `foundation/CODE-QUALITY.md: a gate has no name.` |
| a gate with no `command` | `…the gate "<name>" has no command.` |

"Unparseable" and "declares nothing" are reported as different problems on purpose — one bad quote
should not be reported as a decision nobody made.

### The gate commands are executed through a shell

Every command here is run as `/bin/sh -c "<command>"`, **unsandboxed, as the server's own user, with
the server's environment**. Writing this file therefore promotes an agent from "runs sandboxed code"
to "chooses code that runs outside the sandbox".

That is why the write is allowed but the **execution waits**: the moment an agent changes this file
or `TESTING.md`, auto-pilot refuses to start *and* refuses to dispatch until you have read the
commands and said so. Read them properly — this is the one gate in the system that exists because
something might be unsafe rather than incomplete.

So: use only commands the project already has — read `package.json` scripts, the `Makefile`, the CI workflow — and
never invent one that installs something, writes outside the repo, or reaches the network. If a gate
you would want does not exist yet, say so in the prose and leave it out of the frontmatter rather than
declaring a command that will fail on every card.

Each gate must be **runnable from the project root and non-interactive**. Watch mode is the usual
mistake: `npm test` that watches never exits, and the runner kills the whole process group at ten
minutes and records a failure. Pin it — `npm test -- --run`, `vitest run`, `pytest -q`.

---

## Contract 2 — `TESTING.md` frontmatter

Exactly one key, a non-empty string:

```markdown
---
smoke: npm run smoke
---

# Testing

What the layers are, what is worth mocking, and — the part this document exists for — what "it
works end to end" means for this project, so the one command above is a real answer to it.
```

| What you wrote | The blocker |
|---|---|
| no file | `foundation/TESTING.md does not exist, so there is no smoke test to close a feature.` |
| frontmatter with a YAML error | `…has frontmatter that will not parse, so its smoke command cannot be read.` |
| no `smoke:`, or an empty one | ``foundation/TESTING.md declares no `smoke:` command.`` |

The smoke command is the **one command that proves the thing works end to end** — it is what closes a
feature, not what checks a file. It is not the unit test suite again; if `gates` already runs the
tests, the smoke command should exercise the assembled product. If the project genuinely has nothing
end-to-end yet, that is a card to write, not a command to fake.

---

## When you are done

Open the auto-pilot strip's **Details**, or `GET /api/autopilot/readiness`. It lists every blocker in
the order a person would fix them, so the finish line is literally "this list is empty".

Two things readiness checks that are **not** foundation documents, so do not go looking for them here:

- **The routing table** — `autopilot.routes` in `.vibeboard/config.yaml`, shown in Settings. A route
  naming a skill the project does not have is a phase that silently never runs, so readiness reports
  it. Editing `config.yaml` is also denied to agents.
- **The setup feature** — the card subtree that establishes the stack and tooling. While it is
  unfinished, nothing outside it is eligible. That is a board concern, not a document.

---

## For the copilot: what to produce

Work in this order and stop at the first thing you cannot answer honestly.

1. **Read the README.** If it is thinner than ~200 non-whitespace characters, say so and stop —
   nothing below can be derived, and guessing produces five documents that describe a project nobody
   asked for.
2. **Read what the repository already tells you**: package manifests and their lockfiles for pinned
   versions, scripts for candidate gate commands, existing tests for the strategy, any existing
   config for conventions. Cite what you found rather than asserting it.
3. **Produce all five documents**, complete — frontmatter included for the two machine-read ones. No placeholders, no "TODO", no "fill in your framework here": if you
   do not know something, say so in prose in the document and name it as an open decision.
4. **List, separately, the open decisions** the README did not settle — a UX flow that has to be
   chosen, a library not yet picked, a smoke command that cannot exist yet. These are the things the
   person needs to rule on, and burying them inside the documents as confident-sounding prose is the
   failure mode to avoid.
5. **Write them** with `PUT /api/control/foundation/:name` if you have been authorised — the endpoint
   list in your credential section will say so. If you have not, say plainly that you have written
   nothing and that the person needs to press **Authorise** first.
