# Agent containment, as it works today

Every agent VibeBoard starts — a run, the copilot, a skill — executes inside a Docker container. The
project is mounted into it and is writable; the documents that *govern* what the agent is judged
against are mounted read-only on top; nothing else on the disk is in the container at all.

This page is the destination for reasoning that used to sit in comments describing a mechanism that
no longer exists. **If a comment in `src/` explains a live restriction by naming an AppArmor
profile, it is stale — the rule it describes is usually still true, and the reason it gives is
not.** The true reason is here.

---

## The fact that makes most of the old comments wrong

**Docker replaced the AppArmor profile outright on 2026-08-09** (`bc653e6`, *"delete the AppArmor
profile and its installer"*). It was not kept as a fallback: falling back to it when Docker is
missing would double the containment surface forever *and* hand most users the weaker guarantee.
No Docker, no agents — the board, the explorer and Settings stay usable, and the refusal names the
fix.

**No profile is tracked in this repository.** Verify it:

```
git ls-files | grep -i apparmor      # no output
```

So any comment of the form *"the profile denies …"*, *"every deny in the profile is `wl`"*, or
*"deny the new path"* is describing a file that is not here and is not loaded. Several of those
comments state a rule that **still holds** — it is simply held by a bind mount now. Rewriting them
means keeping the rule and replacing the mechanism, never deleting the paragraph.

The three properties the old profile had, and what each became:

| the profile did | the box does |
|---|---|
| a static, path-glob policy covering every project at once | one container per `(project, backend)`, so the policy is scoped to the project it is about |
| denied writes; **reads were unrestricted everywhere on the machine** | mounts nothing it does not name, so the default is *unreachable* rather than *readable* |
| `allow file rwlkm /**` — `$HOME`, `~/.ssh`, every other project writable | only the project, the box's own state directory, one credential and one socket directory exist inside the box |

That middle row is the important one, and it is why several of the old comments read oddly now: they
argue carefully about *readability* because under the profile everything was readable. Under a
container the equivalent question is *"is it mounted?"*, and the answer is usually no.

---

## Where the boundary is drawn

Everything below is asserted by pure functions in `src/server/boxes/containers.ts`, deliberately, so the
security boundary can be tested without a daemon:

- `PROTECTED_PATHS` / `protectedPaths()` — what is pinned read-only.
- `AGENT_WRITABLE_PATHS` — the one hole punched back through it.
- `boxMounts()` — the whole mount set.
- `createArgs()` / `netRuleArgs()` — the flags and the network rules.

`src/server/boxes/box-manager.ts` owns the docker verbs; `src/server/boxes/box-service.ts` decides what a box is
*for* a given project and backend; `src/server/boxes/sandbox.ts` holds the gate that every agent entry
point calls first.

### The read-only mounts, and what each one denies

Read-only bind mounts sit **on top of** the writable project. Nested mounts carry independent flags,
which is what makes this hold — and is why the reverse arrangement (a read-only parent with a
writable child) famously leaks. Measured: create, overwrite and delete inside are all refused while
the project stays writable and the contents stay readable.

| path (project-relative) | what it denies, and why |
|---|---|
| `.vibeboard/` | Cards and their results, `config.yaml`, skills, `foundation/`, the diary, the suggestions and the auto-pilot state. These are the documents that decide what a run is judged against and how much it may spend. A run that could edit them would be marking its own homework — and it could reset its own attempt count by deleting the records of its failures. |
| `.git/hooks` | Code **the host** runs. An agent that writes `pre-commit` has arranged to execute on your machine, outside the box, the next time you commit. This is the escalation that is easiest to forget and worst to miss. |
| `.git/config` | Reaches the same escalation by another route: `core.hooksPath` repoints hooks at somewhere writable. It is a *file* mount, so it pins an inode — git rewrites the file by rename, and a box goes on reading the old one. That staleness is accepted; mounting all of `.git` read-only would break every commit. |
| the API socket's **directory** | Mounted read-only so an agent cannot `unlink` the live socket and bind an impostor there. The directory is one global path shared by every box, and each box's relay reconnects per connection by design — so the next request from any other run, or from the copilot, would land on the impostor with its bearer token in the header. Measured: `:ro` refuses the unlink and still permits `connect()`, because a read-only superblock rejects writes to files, directories and symlinks, but not to sockets. |

A read-only path is mounted **only if it already exists**. Docker does not skip a bind mount whose
source is missing — it *creates* it, root-owned, on the host — so a project with no `.git` would
otherwise grow a root-owned `.git/hooks` the first time a box started. That filtering is why a box
carries a digest of its own mount set (`SPEC_LABEL`): a box created before a project had a `.git`
has no `.git/hooks` pin, and must be rebuilt rather than adopted once one appears.

### The writable holes, stated as holes

**1. The project itself, at `/work`.** The agent's whole world, and the point of the exercise. It
builds, tests and commits normally.

**2. `.vibeboard/runs/` — nested back inside the read-only mount.** This is the one directory inside
`.vibeboard/` an agent is *required* to write to: it is where a run puts its report.

It is a nested writable mount rather than a return to an enumerated deny-list, and that shape is
deliberate: the default stays **deny**, so anything added to `.vibeboard/` later is refused without
anyone having to remember to name it. The enumerated version is what caused the regression this hole
exists to fix — replacing a named deny-list with one blanket read-only mount took away the only
directory an agent must write to, and `derive-features` created ten cards through the API and came
back *"finished without writing a report"*. The critic could not write its verdict either, so it
could not judge.

The grant is **directory-wide, not per-run**, and that is a known weakening carried over from the
profile era: report files are claimed by run id, so a concurrent run could in principle write another
run's report and decide another card's outcome. With auto-pilot concurrency fixed at 1, the exposure
is a manual run racing an auto-pilot one. Note the seam that limits it: the agent never writes a run
*record* — it writes a report under `runs/`, and `run-store.ts` folds it in. The records under
`boards/<board>/results/` are the server's, and stay read-only.

**3. The box's own state directory, at `/state`.** Per project *and* per backend — see below.

**4. Exactly one backend credential.** A Claude box mounts `~/.claude/.credentials.json` at its own
absolute host path (so the symlink VibeBoard writes into the config home resolves identically inside
and out), writable, because token refresh writes through it. An OpenCode box mounts nothing of the
sort; its credential was copied into its own state directory. **Each box sees one backend's
credential and never the other's** — that is the whole of why `backend` is in the container key.

---

## What is *not* in the box at all

This is the half that has no equivalent under the old profile, where a deny had to be written for
every path worth denying.

- **`~/.vibeboard/token` and `~/.vibeboard/token-devices.json`.** The admin credential and the
  per-device hashes. Not among the mounts, so there is nothing to deny — the separation that used to
  be a plan is now a protection. The `token-` prefix survives because it still reads as *"this is a
  credential"*, not because a glob depends on it.
- **The rest of `$HOME`, `~/.ssh`, and every other project on the disk.** Under the profile all of
  these were writable and every one of them was readable.
- **The docker socket.** Nothing brokers docker into a box; the agent goes *in* the box, so there is
  nothing to broker.

**`VIBEBOARD_TOKEN_FILE` is the exception worth naming.** It relocates the credential files, and the
sandbox probe does not check where they went — it asks whether a box is possible, not where your
secrets are. Under the profile, relocating them put them outside its deny rules and made them
readable by every agent. Under containment the question is different but not empty: **if the new path
is inside a project directory, it is inside a box's mount.** Keep it outside every project root.

---

## The residual exposures, stated rather than implied

A box shares its filesystem with every agent on the same `(project, backend)` — the copilot and every
run alike. That is safe for *authorisation*, because agents differ by their **token** and the API
enforces scope; it is not the same as isolation.

- **The CLI writes its own session transcript into `/state`**, which the copilot and every run in
  that box share. A run's credential dies in minutes; the copilot's lives for a conversation, which
  is why it is ended eagerly on every chat and project change. This is the reason credentials are
  redacted out of anything VibeBoard persists (`src/server/copilot/copilot-authority.ts`,
  `src/server/runs/agent-runner.ts`) — the redaction is what keeps a token out of the chat and run
  transcripts, and it has to survive the fact that the box is shared.
- **Credentials travel on stdin, never in argv.** `/proc/<pid>/cmdline` is world-readable for as long
  as the process lives, so a command-line argument would let any other agent on the machine lift
  another run's token with `ps`. This is also why `execArgs()` passes `-i`: without it `docker exec`
  discards stdin before the container sees a byte, and `claude -p` exits 1 having been told nothing.
- **A Claude box can read the user's Claude credential**, because it must. Mounting one file is a
  real improvement on the profile era, where all of `~/.claude/` was writable by any agent — but it
  is one file, not zero.
- **The network boundary is not exfiltration control.** The box reaches the internet (it has to, to
  reach the model) and is blocked from RFC 1918 and link-local addresses, so it cannot reach the
  unauthenticated services on this machine or the rest of the LAN. Nothing at this layer stops an
  agent sending code somewhere.
- **The rules are IPv4 only.** `ip6tables` is never invoked; Docker ships IPv6 off by default, so
  this is latent rather than live.
- **A container is not a VM.** Genuinely untrusted code wants stronger isolation than this.

### Why the two-level design is safe

An agent turn execs as the host user; a package install execs as root, **from outside, by
VibeBoard** (`installArgs()`, `BoxManager.install`). The image ships no `sudo` at all, so the agent's
lack of root is an **absent** route rather than a blocked one, and `no-new-privileges` means a setuid
binary could not help it either.

What holds the boundary is not the account — it is the set of capabilities the container was granted
at birth. Measured 2026-08-09, as root inside a box with docker's default capability set:
`apt-get install` succeeds; writing `/work/.vibeboard` is refused; `mount -o remount,rw` on it is
refused; flushing the firewall rules is refused. `SYS_ADMIN` and `NET_ADMIN` are not in the default
set, which is precisely why moving off `--cap-drop ALL` costs nothing.

The network rules are installed by a **throwaway container sharing the box's network namespace**, never
by the box itself — so nothing inside it, including the privileged install step and including a
package's own post-install script, can flush them. A box whose rules did not apply is destroyed
rather than served.

---

## Two things that are deliberately *not* confined by the box

- **The auto-pilot service process.** It is not sandboxed, and that is correct: it writes
  `autopilot-state.json` — the counters are its own — it runs no model, and it executes nothing a
  card asked for. What confines it is the **scope table in `src/server/auth/auth.ts`**, not the
  filesystem. (A comment that explains this by saying "the profile denies exactly that to every
  confined process" is naming a dead mechanism for a live rule.)
- **Gate and smoke commands.** They run in the loop's own process, through `/bin/sh`, as the server's
  user. Putting arbitrary command execution behind an HTTP endpoint would be a far larger hole than
  the one it closes. What stands in front of them is that the commands come from `foundation/`, which
  is read-only inside every box, plus the `unreviewedGates` escalation: while a foundation document's
  commands have been changed by anyone other than the admin, the loop refuses to run **any**
  foundation-declared command and says so. Note the honest limit — `npm test` executes whatever the
  run put in `test/`, so the door to host execution is open through the *contents* rather than
  through the string.

---

## The gate, and why it is a probe

One function decides whether any agent may start (`agentRefusal` in `src/server/boxes/sandbox.ts`), it is
called before every dispatch, every chat turn and every auto-pilot start, and it fails closed.

It is asked **before** dispatch and never inferred from a failure, because `docker exec` into a
missing or stopped container exits non-zero exactly as a genuinely failing agent does — the two are
indistinguishable after the fact. This was the same trap the AppArmor version had for a different
reason, and the answer is the same: ask first, and say what is wrong in terms of the thing that fixes
it.

`wrapCommand` **throws** rather than returning an unwrapped command when the sandbox is available but
no box was supplied. Returning `bin` unchanged — the old behaviour for a missing sandbox — would run
the agent on the host with nothing confining it, and every caller would see a perfectly ordinary
command.

An attached OpenCode server (`VIBEBOARD_OPENCODE_URL`) is refused for the same reason it always was:
VibeBoard did not start it, so it is not in a box and its filesystem access cannot be restricted. The
refusal names the two Settings actions that fix it rather than merely saying no.
