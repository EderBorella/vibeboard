# VibeBoard — working instructions

This file is the project's own brief. It replaces the shared launch-root setup: sessions now start
**inside** `/data/projects/vibeboard`, so what used to be "go and read the project's docs" is here.

@.claude/CODE-QUALITY.md

---

## What this is

A local-first cockpit for markdown-backed project boards. **Files are the database.** A card is one
`.md` file with YAML frontmatter; the column it is in **is** the folder it sits in. There is no
database and no ORM. A filesystem watcher pushes changes to the browser, so a card an agent moves
and a card you drag are the same event.

One Node process: Fastify 5 + `@fastify/websocket` + chokidar + gray-matter, React 19 / Vite front
end, served at `localhost:4610`. Agents run in a Docker box per `(project, backend)`.

The full product description is [`README.md`](README.md). Read it before changing anything
user-facing; it is the only place the security model is stated end to end.

## Resources

| what | where |
|---|---|
| Reasoning that does not fit beside its code | [`docs/README.md`](docs/README.md) — start there, it routes |
| **Index by source path** — holding a `file:line`, want the why | [`docs/by-file.md`](docs/by-file.md) |
| The citation register — every `decision NN` / `ruling NN` / slice ref | [`docs/decisions.md`](docs/decisions.md) |
| The design system, all five parts, phase records included | [`docs/design-system.md`](docs/design-system.md) |
| How agents are confined today | [`docs/security/containment.md`](docs/security/containment.md) |
| What the five seeded `foundation/` docs must decide | [`docs/foundation-bootstrap.md`](docs/foundation-bootstrap.md) |
| **The only list of outstanding work** | `notes/todo.md` — gitignored, local-only |
| Superpowers plans / specs / reviews / research | `docs/superpowers/**` — gitignored, local-only |

`docs/superpowers/` and `notes/` are **gitignored**. Nothing committed may cite either: it would be
a dangling pointer in every clone, which is the exact defect `docs/decisions.md` exists to remove.
That rule has already cost a migration — thirteen committed comments cited a working document by
path, and Part Five of `design-system.md` exists because of it.

## Commands

Never `npx <tool>`. Use the project's own script or `./node_modules/.bin/<tool>`.

| command | what it does |
|---|---|
| `npm test` | vitest, the whole suite |
| `npm run check` | four typechecks **and the ten source gates** — the real gate |
| `npm run lint` | biome, `--error-on-warnings` |
| `npm run build` | tsc + web typecheck + vite build |
| `npm run visual` | the Playwright browser harness — the only thing with a layout engine |
| `npm run storybook` | the design workbench, port 6006 |
| `npm run mutate` | stryker; minutes, deliberately not in the pre-commit hook |
| `npm run dev` / `npm run web:dev` | server with reload / Vite with HMR |
| `npm run box:build` | builds the agent container; once per machine |

`.githooks/pre-commit` runs format, all three typechecks, lint and the full suite **against the
index, not the working tree** — read its header before you are tempted to `--no-verify`. Both halves
of getting that wrong were reproduced against it before it was written.

## The layers, and why each boundary is load-bearing

1. **`src/core/` is pure.** No Fastify, no HTTP, no `node:*` in the decision-making modules. Purity
   is proved by resolving the import graph from `core/tick.ts` and looking for a `node:` import
   anywhere it reaches — **not** by grepping the directory, which proves nothing: a pure-looking
   module can reach `node:fs` in three hops, and that is how it used to. One value edge upward
   remains (`find.ts` → `store/cards/board.js`), and it is why the purity gate is still unarmed.
2. **The auto-pilot loop is a separate process.** `src/service/` reaches the board over HTTP via
   `board-client.ts`. It must not import server internals or touch the filesystem for board state.
3. **The scope table in `src/server/auth/auth.ts` is the only answer to "who may call this."** A
   route absent from it is admin-only. That default is a security property — never restructure it
   into a shape where a new route can silently become reachable.
4. **The on-disk project format is frozen.** Card files, `.vibeboard/` layout, `config.yaml`.
   Existing projects must keep working.
5. **The HTTP API is frozen.** The web client and the loop both depend on it.
6. **Deterministic beats model-driven, everywhere.** The lifecycle machine's premise is that
   anything a machine can decide, a machine decides. Never replace a deterministic check with a
   prompt.

Feature grouping happens *within* a layer, never across one. "Organised per feature" must not
dissolve core/server/service, which carries the security and testability guarantee.

TypeScript is ESM: **imports always carry the `.js` extension**, including for `.ts` sources.

## The front end is atomic, and the direction is gated

`design/ → atoms/ → molecules/ → organisms/ → templates/ → pages/`. A layer may read downward and
never up; `npm run check:layers` blocks that at zero.

- **The cascade is declared once**, in [`web/src/styles.ts`](web/src/styles.ts) — 41 layer sheets,
  order load-bearing. The app, the Storybook preview and `test/css-box.tsx` all read that one list.
  A second copy would drift silently, and a workbench showing a cascade the app does not have is
  worse than one showing nothing.
- **No surface reinvents a primitive.** Raw controls outside the atom layer are a gate failure.
- **Class budget is a ratchet at 230, zero slack.** The stated target of 146 is the number to
  revisit, not the tree: the 30 remaining single-declaration classes are hover/`:disabled` inks,
  parent-selector anchors and genuine one-offs, and reaching 76 needs a *design ruling* that a
  surface may not have a hover ink of its own — not another merge.
- **Every value is on a scale**: five type steps, seven space steps, four radii, two box heights
  (`--ctl-h` 28px for what you operate, `--mark-h` 16px for what you read), four `--z-*` layers.
- **Two known gaps, stated so nobody re-discovers them as findings:** no **source** gate under
  `tools/` reads a `width`, and the drift baseline records only font sizes, radii and the two height
  sets — so it cannot see a gap or a padding at all.
  Corrected 2026-08-31: this file first said no gate reads a width at all, which is wrong and was
  copied from `docs/design-system.md`'s closing note. `visual/checks/board.spec.ts` sweeps
  `WIDTHS = [900, 1200, 1440]` and asserts `documentOverflow` on both axes at each — so the browser
  harness does measure widths. What it does not do is read authored `width` declarations out of the
  stylesheets, which is what the source gates do for every other value.

Read Part Five of `docs/design-system.md` before touching a stylesheet.

## Citations are a gate

`npm run check:citations` scans `src/`, `web/src/` and `test/` for `decision NN` / `ruling NN` and
`S`/`C` slice references, and **fails if any identifier has no row in `docs/decisions.md`**. It
flattens lines first, because citations wrap and a grep misses those.

**Adding a citation to a comment means adding a row.** So does adding a slice reference.

## Comments

Terse, and they explain **why** — never what the code already says. A reason lives beside the code
it constrains unless it is longer than the code, or it binds more than one file, or it is a fact
about the world rather than about this module; then it lives in `docs/`, with the comment reduced to
one line naming the page. Relocating a reason must never lose it: a comment explaining why a guard
exists is the only thing standing between that guard and somebody deleting it later.

**There is no comment-ratio target.** One was set, measured with a broken instrument, and withdrawn.
The judgement is per comment: does this say why, or restate the line below it? Would deleting it make
the code below look deletable? **Is it still true?** A comment that fails the last question is worse
than none.

## Content rules for anything committed

- No host paths, no personal names, no machine-specific detail in committed code, comments or git
  artifacts.
- Commit messages describe **what changed and why**, in the repository's own voice — the log is
  prose, not a changelog stub. Read `git log` before writing one.
- No pointer, in any committed file, to `notes/` or `docs/superpowers/`.

---

# How to work here

## Plan before code

1. **Orient** — read the files, the schemas, the existing patterns.
2. **Verify** — cross-reference the docs above; a claim about behaviour comes with a `file:line`.
3. **Plan** — what changes, what tests, what gates.
4. **Confirm** — wait for approval before editing.

Step 4 may be skipped for typo and formatting fixes; steps 1–3 may not. For anything touching the
layer boundaries, the lifecycle machine, auth, or the stylesheets, step 4 is mandatory.

A third round of refinement means something was missed in step 1. Go back rather than iterate.

## Locate by symbol, never by line number

**The most important execution rule in this repository, and it is here because a written plan got it
wrong**: line numbers rot between writing a plan and executing it. Every reference in a plan names a
**file and a symbol**. Before editing, `grep` for the symbol and confirm it is what the plan
describes. **If what you find does not match, stop and report it rather than editing the nearest
plausible thing.** A plan that disagrees with the code is a plan that has aged, and the code wins.

## Branching, committing, pushing

- **Never edit a file while on `main`.** Check `git branch --show-current` first and say the branch
  name out loud before the first edit.
- Branch names follow what is already in the log: `feat/…`, `refactor/…`, `chore/…`, and phase work
  on short-lived `pN/<group>` branches merged into the feature branch.
- Stage deliberately, read `git diff --staged` before committing, and never commit secrets, debug
  code or unrelated changes.
- **Nothing reaches `origin` without being asked for.** Local commits are fine to prepare; a push, a
  PR, or a merge waits for an explicit go-ahead.
- Once a PR is open the branch is frozen: fix things in new commits, never rebase, amend or
  force-push.

## Never defer

If it was asked for, work out **how**. Deferring is not the call to make. Map the full scope — if it
is bigger than the prompt implied, say so and offer phases; the owner picks. A genuine blocker
("X cannot be done because Y does not exist") is information and should be stated plainly. "Out of
scope" and "too complex" are not.

## Scope of action = scope of request

Do exactly what was asked. If something else looks worth doing, ask — never assume the answer is
yes. Before creating any file that was not named in the request, check that it actually was.

## One topic at a time

One question per message. Do not end a message with a list of open threads. Answer what was asked
and stop. Anything ruled on is closed — state a consequence in a line or two if there is one, then
do what was said; do not hand the decision back with "or would you rather…". Match the size of the
answer to the size of the question.

## Subagents

Project agents live in `.claude/agents/`: `planner`, `builder`, `design-phase`, `code-review`,
`harness`. They are stateless — **pass the context in the prompt**: the branch, the relevant
sections of this file, the paths, the diff or files at issue. Do not make them ask.

Superpowers skills (`brainstorming`, `writing-plans`, `test-driven-development`,
`systematic-debugging`, `verification-before-completion`, …) load from the installed plugin and are
available here. They are **not** copied into this repository on purpose: a fork would go stale
against the plugin. What is project-specific about that workflow is written down instead — the
plan/spec/review layout under `docs/superpowers/`, Rule 0 above, and the phase-record convention in
`docs/design-system.md`, where every phase reports **what a planted defect proved**, not a green
tick.

## Earn the green tick, then distrust it

The house rule, and this repository is where most of `.claude/CODE-QUALITY.md`'s incidents came from.
A gate that has never failed on purpose is not known to work. The Phase 8 post-mortem lists six
defects, **not one of which a passing gate caught** — including 4,501 unit tests passing over a
literal `<trigger>` element, and a `PARSE_FLOOR` that failed a run for *succeeding*.

Before claiming any gate holds: plant the defect it should catch, watch it fail, restore it, and
report what it said.
