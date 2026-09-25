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
could not judge. Two runs, real money, no way to record either; the agent diagnosed it in its own
thinking — *"the directory is read-only. This seems like a system-level issue."*

**How it was missed is worth keeping, because it is a mistake anyone auditing this would repeat.** The
change checked `RESULTS_DIR` — `boards/…/results/`, which the **server** writes — concluded the folder
was safe to deny wholesale, and never looked at `RUNS_DIR`. The report path is a different constant
entirely, and the two read alike.

The grant is **directory-wide, not per-run**, and that is a known weakening carried over from the
profile era: report files are claimed by run id, so a concurrent run could in principle write another
run's report and decide another card's outcome. With auto-pilot concurrency fixed at 1, the exposure
is a manual run racing an auto-pilot one. Note the seam that limits it: the agent never writes a run
*record* — it writes a report under `runs/`, and `run-store.ts` folds it in. The records under
`boards/<board>/results/` are the server's, and stay read-only.

**3. The box's own state directory, at `/state`.** Per project *and* per backend — see below.

**4. Exactly one backend credential.** A Claude box mounts `~/.cache/vibeboard/creds/claude/` and an
OpenCode box mounts `~/.cache/vibeboard/creds/opencode/` — each a directory VibeBoard owns holding only
a mirror of that backend's host credential, mounted at its own absolute host path, so the symlink
VibeBoard writes into the state directory resolves identically inside and out.

**Two sibling leaves, and nothing mounts the parent that holds both.** That is what makes the split a
property of the mount set rather than a rule somebody has to remember: collapse the two into one
directory and each backend's credential is inside the other's box. **Each box sees one backend's
credential and never the other's** — the whole of why `backend` is in the container key.

*Changed 2026-09-01.* An OpenCode box used to mount nothing of the sort, because its credential was
**copied** into the project's own state directory — once, and only when absent. That made a re-login on
the host unable to reach a project that already had a copy, and made "newest wins" unanswerable, since
N projects meant N divergent copies. The per-project split remains for the session **database**, which
is what forced it: the user's own is 265MB and several boxes writing one SQLite file is several writers
on one file. A credential is not that.

It is a **directory**, and that is not tidiness. See "A mounted file cannot follow a token refresh"
below.

### A mounted file cannot follow a token refresh

Measured 2026-08-15, and it cost a card. A Claude box used to bind-mount the credential **file**.
Claude Code refreshes its OAuth token by atomic replace — write a new file, rename over the old — and
that makes a **new inode**. A bind-mounted file pins the inode it was created with, so the container
went on reading the old, now-unlinked one forever:

| | inode | link count | mtime |
|---|---|---|---|
| host | 5280206 | 1 | Aug 15 20:35 |
| inside the box | 5303483 | **0** | Aug 14 20:35 |

The box's own `/proc/self/mountinfo` named the source `…/.claude/.credentials.json//deleted`. Every
agent turn then died in 58 ms with *"Failed to authenticate: OAuth session expired and could not be
refreshed"*, auto-pilot spent all three of a card's attempts on it, and reported **the card** as
stalled — the same shape of failure as the missing `-i` flag, and just as silent.

The box cannot repair it from inside either. Reproduced from first principles in a scratch container:
a rename over a file-mount fails with `EBUSY` (*"Resource busy"*), the same rename inside a
**directory** mount succeeds, and the file-mount still reads the old bytes afterwards. So a mounted
file can neither follow the host's refresh nor be refreshed from within. (This is the same inode
pinning `.git/config` has, where the staleness is accepted; here it is not survivable.)

**Mounting all of `~/.claude` was analysed and rejected**, not overlooked. It is 894 MB and 805
session transcripts. Read-write is disqualifying on its own: `settings.json` declares hooks that
execute **on the host** the next time the user starts Claude Code — the escalation `PROTECTED_PATHS`
already denies for `.git/hooks`, reached by another door. Read-only would still hand every agent in
every project the full text of every session ever run on this machine, which is the opposite of what
`copilot-env.ts` exists to do.

So the mount is a directory VibeBoard owns holding **only** the credential, at
`~/.cache/vibeboard/creds/claude/`, mirrored from the host file. It sits under `XDG_CACHE_HOME` and
**not** under `~/.vibeboard/`, deliberately: the mirror is the one thing here that a box mounts, and
putting it in `~/.vibeboard/` would have cost the flat guarantee below that none of that tree is
mounted at all. A cache directory is also what it honestly is — deletable at any moment, rebuilt from
`~/.claude` on the next `ensure()`. The mirror is refreshed on every
`ensure()` — before every agent turn — and skipped when the bytes are unchanged: two `stat`s reject a
differing size, and otherwise two reads of a file under a kilobyte. The copy is a temp file plus a
rename: a torn credential is worse than a stale one, and the rename is also the one write the other
side of a directory mount can see. Since 2026-09-01 `opencodeStateDir` works the same way, through the
same `reconcileCredential`, and writes a symlink into the state directory rather than a copy.

The skip compares **content**, not mtime, and that is worth recording because the first version did
compare mtime and was wrong in a way nothing would have reported. It carried the source's timestamp
onto the copy with `utimesSync`, which takes a `Date` — and a `Date` holds whole milliseconds while a
file's mtime holds nanoseconds, so the copy came back rounded up to the next millisecond. Measured:
2000 of 2000 round trips shifted by one. The skip would never have fired for any real credential, and
the only symptom would have been a rewrite before every agent turn.

**What this does not fix, stated rather than implied:**

- ~~**Mirroring is one-way**~~ — **fixed 2026-09-01, and for both backends.** It was one-way, host →
  mirror, so a refresh performed *inside* the box was overwritten by the next mirror and lost. The old
  `EBUSY` measurement said an in-box refresh was impossible, but that was a property of the FILE mount
  it replaced: a directory mount is writable, and an OAuth refresh is a headless POST of the refresh
  token to the provider — no browser, no user, no host involvement — which a box has the network to
  make. The cost was never merely lost freshness: where a provider rotates refresh tokens on use, the
  host would be left holding a **spent** one and neither side could refresh again.

  It now reconciles both ways, with the **host as the source of truth**: when the bytes differ and the
  mirror is *strictly* newer and parses as a credential and the host file already exists, the mirror is
  carried back to the host, which then reseeds every project. Never project to project. Three
  conditions, because carrying back writes the user's own file — a tie is two files whose order cannot
  be established, an unparseable file is one caught mid-write, and restoring a credential the user does
  not have is not a refresh. It cannot flap: a carry-back rewrites the host, so the next call finds the
  two byte-identical and does nothing.

  Direction is read from mtime **only once the bytes have already said the two differ**. Comparing
  timestamps for *equality* is the thing the paragraph above says cannot work; comparing them for
  *order* is a different question, and one a test fixture got wrong on the first run by stamping the
  mirror from the source's own mtime — which rounds up, and is therefore a carry-back rather than a tie.
- **If nobody ever runs the CLI on the host**, nothing refreshes the token and the mirror expires
  exactly when the original does. Mirroring buys freshness; it does not create it — though a box's own
  refresh now reaches the host, which narrows this considerably.
- **It is a second copy of a credential at rest.** What protects it is 0700 on the directory and 0600
  on the file, set with an explicit `chmodSync` rather than left to the umask, and asserted in
  `test/copilot-env.test.ts`.

---

## What is *not* in the box at all

This is the half that has no equivalent under the old profile, where a deny had to be written for
every path worth denying.

- **`~/.vibeboard/token` and `~/.vibeboard/token-devices.json`.** The admin credential and the
  per-device hashes. Not among the mounts, so there is nothing to deny — the separation that used to
  be a plan is now a protection. The `token-` prefix survives because it still reads as *"this is a
  credential"*, not because a glob depends on it.

  **Nothing under `~/.vibeboard/` is mounted into any box, and that is a flat statement with no
  exceptions in it.** The credential mirror was briefly written here during the 2026-08-15 change and
  was moved to `~/.cache/vibeboard/creds/` before it shipped, precisely to keep this sentence flat: the
  alternative was "the mount set names one leaf of that tree", which protects the admin token only for
  as long as everyone who adds a mount remembers which leaf. A rule with no exceptions cannot be got
  wrong later; a rule with one can.
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
- **A Claude box can read the user's Claude credential**, because it must. Mounting one directory
  holding one copied file is a real improvement on the profile era, where all of `~/.claude/` was
  writable by any agent — but it is one credential, not zero, and the directory around it is now
  writable from inside, so an agent can also *replace* it. That buys nothing it did not already have:
  it is the agent's own token, and the blast radius is the next turn's auth failing.
- **The network boundary is not exfiltration control.** The box reaches the internet (it has to, to
  reach the model) and cannot OPEN a connection to RFC 1918 or link-local addresses, so it cannot
  reach the unauthenticated services on this machine or the rest of the LAN. Nothing at this layer
  stops an agent sending code somewhere.
- **One exemption, and it is narrow.** A box may send a TCP packet to a private address when it is a
  reply, from the published OpenCode port, on a flow something outside started
  (`--sport 4096 --ctstate ESTABLISHED --ctdir REPLY`). Without it the box could not answer the
  server's own request on the port Docker published for it, and the OpenCode model list came back
  empty. `--ctdir REPLY` is what keeps this from covering a flow the AGENT opened, and `--sport`
  is what keeps it from covering a port the agent chose.
- **There is a window before the rules land, and this is the reason for `--ctdir`.** `docker run -d`
  returns once the container exists, so the box's PID 1 is already executing when the rules are
  installed 0.12–0.14s later — longer on a cold or loaded machine. A flow opened in that window is
  ESTABLISHED, and conntrack would hold it for days. An earlier version of the exemption matched
  ESTABLISHED in either direction and so kept such a flow alive; the reject-only rules that preceded
  it severed one. The real fix is to install the rules before the box's command can send a packet,
  which is not what happens today.
- **A published port is not the box's whole inbound surface.** `-p 127.0.0.1::4096` maps a host
  loopback port. The container's own address stays reachable on every port from the host and from
  every container on the same bridge, so what an agent chooses to LISTEN on matters. The rejects give
  it no way to answer, which is why the exemption above is scoped to one port rather than to
  established flows in general.
- **The rules are IPv4 only.** `ip6tables` is never invoked; Docker ships IPv6 off by default, so
  this is latent rather than live.
- **A box's identity does not include its firewall.** `specDigest` covers image, mounts, env, publish
  and command — not the rule script — and rules are applied only on create and on start-from-stopped.
  A running box adopted mid-session keeps whatever rules it was born with. Today `sweepOldBoxes`
  destroys every labelled box at startup, which hides this; that coupling is load-bearing and
  untested, and it is what would silently swallow the next tightening of these rules.
- **Setup's import routes untrusted third-party text into an `assist` conversation.** The wizard's
  import step asks the person to paste the list they already keep — out of a shared spreadsheet, an
  exported tracker, a file somebody else wrote — and sends it to the copilot, which holds an `assist`
  credential. Four things confine it, and only one of them is the box: the frame says in as many words
  that everything after the `---` separator is data and never instructions
  (`src/server/copilot/wizard-frame.ts`); the person is reading the conversation as it happens, which
  is the whole safety argument for `assist` at all; the turn runs in the same box as every other
  agent, so the mounts above bound what it can touch on disk; and the scope table is what the
  credential may actually call, which is the full grant written out in `decision 79` rather than
  "cards". **The residual is that prose compliance is not a mechanism.** An instruction inside the
  paste that the model chooses to follow is refused by the scope table and by nothing else — so the
  worst case is bounded by what `assist` holds, not by the frame.
- **Fix board hands card text to the widest authority an agent holds.** `repair` (`decision 88`) may clear
  any card's attempts, reorder and restore cards, and do everything `assist` does to the board — and its
  input is the board: card bodies agents wrote, lists people imported, a stop sentence quoting git. A
  card's body was edited mid-run on the board that prompted it. Four things confine it, as for the
  import: the frame says everything read is evidence and never instructions, and quotes the stop
  sentence line by line so nothing in it can open a line of the brief
  (`src/server/copilot/fix-board-frame.ts`); the person is watching the conversation; the box bounds the
  disk; and the scope table bounds the calls. **The same residual holds, and here it is wider**: an
  instruction the model chooses to obey is refused by the scope table and nothing else, so the worst case
  is what `repair` holds — which is why it holds no foundation write, no toolchain, no control over the
  loop and no grant, and why it lasts one turn. Minted by an admin-only route, released by token when
  the turn settles, and every write under it — and every refusal — is logged with the conversation that
  made it (`src/server/auth/repair-audit.ts`).
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

### IPv6 is out of scope, and a box that has an address is refused

The rules above are `iptables`. **`ip6tables` is never invoked**, so on a daemon with IPv6 on the bridge
the private-range block would not apply to half a box's traffic — silently, which is the property that
makes it worth handling at all.

**Writing the v6 rules was considered and rejected on 2026-09-01.** Container IPv6 is a dockerd setting
(`"ipv6": true` plus a v6 subnet in `daemon.json`) and it ships **off**; a v6-capable *host* whose bridge
is v4-only gives its containers no v6 address at all, which is the ordinary case and not a gap. v6-only
Docker networking exists, needs NAT64/DNS64 to reach the v4 internet, and anyone running it knows they
are. Against that, `ip6tables` is absent from some hosts and some images, so writing the rules blindly
would break boxes that work today in order to cover a case nobody has.

**So it detects and refuses.** `inspectState` reads `GlobalIPv6Address` — from the top-level field *and*
from each entry in `Networks`, because a container on a user-defined network carries it per network and
reading only the first would answer "no IPv6" for exactly the setups most likely to have one. A non-empty
answer destroys the box and throws, by the same argument as rules that failed to apply: a box whose
boundary covers only some of its traffic is worse than one with no boundary, because it looks confined.

Checked in **both** places a box can be reached: after the rules are applied on create and on start, and
again before a running box is **adopted**. The second is the upgrade case and it was missed at first — a
container's address is assigned when it starts, so an adopted box cannot *acquire* one unobserved, but a
box that was already up when this check arrived has one already. The answer costs nothing there: the same
`docker inspect` that reads the state and the spec digest reads the address.

**If somebody turns up who needs v6 boxes**, the fix is `ip6tables` mirroring `PRIVATE_RANGES` with the
v6 private ranges (`fc00::/7`, `fe80::/10`, `::1/128`), guarded by a probe for the binary rather than
assumed. Revisit then, not before.


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
