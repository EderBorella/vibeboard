# The security model

What an agent can and cannot reach, and who may drive one. This is the end-to-end statement the
README used to carry; [`containment.md`](containment.md) holds the reasoning behind each mechanism.

## The agent sandbox

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

## Credentials and the network

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
