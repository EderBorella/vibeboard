# `docs/`

Reasoning that does not fit beside the code it is about.

| page | what it answers |
|---|---|
| [`by-file.md`](by-file.md) | **Start here if you are holding a `file:line`.** An index keyed on source path: given a file, which pages explain it and which numbered rulings its comments cite. |
| [`decisions.md`](decisions.md) | The register. Every `decision NN` / `ruling NN` and every `S`/`C` slice reference cited anywhere in `src/`, `web/src/` or `test/`, restated in one sentence, with where it binds. |
| [`security/containment.md`](security/containment.md) | How agents are confined today: one Docker box per `(project, backend)`, what the read-only bind mounts deny and why, where the writable holes are, and the residual exposures. Read it before trusting any comment that mentions an AppArmor profile — that profile was deleted on 2026-08-09. |
| [`design-system.md`](design-system.md) | **The planned type/space/radius scale and the six primitives**, why the three themes survive it, and the phased sequence — each phase gated by a browser harness, because every UI test today runs in jsdom, which has no layout engine. Read it before touching the stylesheets under `web/src/` (`styles.css` is **41 layer sheets** now, one per component and per organism directory — see `web/src/styles.ts`): it carries the OPENING measurements (457 classes, 278 of them single-use, 27 font sizes) that the plan answers, each with the method that produced it, and **Part Five is the current state — 305 classes, five type steps, ten source gates.** |
| [`smoke-test.md`](smoke-test.md) | **The ten-minute manual pass against a running product**, and what each step proves that no gate can. Say "run a smoke test" and follow it. It exists because a branch passed twelve source gates, 4,620 unit tests and the browser harness, and then failed on its first live dispatch — every unit test drives a fake docker, so nothing in the suite executes the templates a real daemon answers. |
| [`foundation-bootstrap.md`](foundation-bootstrap.md) | What the five `foundation/` documents must decide, and the two machine contracts inside them that otherwise fail silently-looking checks. Seeded into every project by `src/store/project/seed-docs.ts`, so it is a **product document** as well as a repository one — edits to it reach every project. |

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

Adding `decision 99` to a comment means adding a row. So does adding a slice reference.

## There is no comment-ratio target

An earlier plan set one — *"get `src/` below 15%"* — and it is withdrawn. Two reasons, and the second
is the real one.

It was measured with a broken instrument: the script that produced the 24.9% it was reducing *from*
counted trailing `// why` comments after real code as comment lines, and missed `*` continuations
inside block comments. A target expressed against a number nobody can reproduce is not a target.

The corrected census, for the record rather than as a goal — `src/` is **12,448 code lines to 6,760
comment-only lines**, so 35% of its non-blank lines are comments, against 17% in `web/src/` and 13.5%
in `test/`. One line in three. That is high by any general standard and it is not, on its own,
evidence of anything: most of those comments carry the *incident* that produced the code — the red CI
run, the mutant that survived, the fixture too thin to distinguish two outcomes — and a ratio cannot
tell that apart from padding.

So the judgement is per comment, and the questions are the ones a ratio cannot ask: does this say
**why**, or restate the line below it? Would deleting it make the code below look pointless or
deletable? Is it still true? A comment that fails the last question is worse than none, and no
percentage will ever find it.
