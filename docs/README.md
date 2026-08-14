# `docs/`

Reasoning that does not fit beside the code it is about.

| page | what it answers |
|---|---|
| [`by-file.md`](by-file.md) | **Start here if you are holding a `file:line`.** An index keyed on source path: given a file, which pages explain it and which numbered rulings its comments cite. |
| [`decisions.md`](decisions.md) | The register. Every `decision NN` / `ruling NN` and every `S`/`C` slice reference cited anywhere in `src/`, `web/src/` or `test/`, restated in one sentence, with where it binds. |
| [`security/containment.md`](security/containment.md) | How agents are confined today: one Docker box per `(project, backend)`, what the read-only bind mounts deny and why, where the writable holes are, and the residual exposures. Read it before trusting any comment that mentions an AppArmor profile — that profile was deleted on 2026-08-09. |
| [`foundation-bootstrap.md`](foundation-bootstrap.md) | What the five `foundation/` documents must decide, and the two machine contracts inside them that otherwise fail silently-looking checks. Seeded into every project by `src/core/seed-docs.ts`, so it is a **product document** as well as a repository one — edits to it reach every project. |

---

## Where a reason belongs

**A reason lives beside the code it constrains, in a comment, unless it is longer than the code, or
it binds more than one file, or it is a fact about the world rather than about this module — and then
it lives here, with the comment reduced to one line naming the page.** A comment explaining *why a
guard exists* is the only thing standing between that guard and somebody deleting it later, so
relocating reasoning must never mean losing it: what moves here keeps every argument it had, and what
stays behind keeps enough to stop the guard looking pointless. Comments explain **why**, never what
the code already says; a page here explains why across files. And nothing in this folder may point at
anything outside the repository — `docs/superpowers/` and `notes/` are gitignored, so a reference to
either is a dangling one in every clone, which is exactly the defect `decisions.md` exists to remove.

## The gate

`npm run check:citations` scans `src/`, `web/src/` and `test/` for both citation notations and fails
if any identifier has no row in `decisions.md`. It runs the source through a line-flattening pass
first, because citations wrap (`// … (decision` / `// 45)`) and a grep misses those.

Adding `decision 68` to a comment means adding a row. So does adding a slice reference.
