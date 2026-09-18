import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { BoxKind } from '../../core/box-kinds.js';
import { CONFIG_DIR, RUNS_DIR } from '../../core/layout.js';

// The agent box: one container per (project, backend), and the only place an agent runs.
//
// WHY A MANAGER AND NOT JUST `wrapCommand`. Swapping `aa-exec` for `docker exec` covers Claude Code,
// which is spawned per turn. It does not cover OpenCode, which is a long-lived `opencode serve` INSIDE
// the box that VibeBoard then talks to over HTTP — that is lifecycle plus port discovery, and there is
// nothing for a command wrapper to return. So the wrapper stays, and it asks this for its exec prefix.
//
// WHY (project, backend) AND NOT PER AGENT. Authorisation is the credential layer's job: a run agent
// and the copilot differ because their TOKENS differ, not because their filesystems do. Every agent in
// a project therefore wants the same mounts, and one box can serve them all. The backend is in the key
// for one reason only — credential isolation. OpenCode must never have the Claude credential mounted,
// so the two cannot share a container even though their file rights are identical.

// A LIST rather than only a union, because two callers have to enumerate them: a project delete removes
// one box per backend, and nothing derived from a type exists at run time to iterate. Declared `as const`
// so the type is still derived from the list and the two cannot drift.
export const BOX_BACKENDS = ['claude-code', 'opencode'] as const;
export type BoxBackend = (typeof BOX_BACKENDS)[number];

// Labels rather than a pid file. A container outlives the process that made it — that is the point of
// one, and it is also a new failure mode — so after a restart we have to find boxes we no longer hold
// a handle to. `docker ps --filter label=` is that query, and it survives anything, including SIGKILL.
export const BOX_LABEL = 'io.vibeboard.box';
export const PROJECT_LABEL = 'io.vibeboard.project';
export const BACKEND_LABEL = 'io.vibeboard.backend';
// A digest of everything about a box that cannot be changed after it is created. Adoption is by NAME,
// so without this a box built for one purpose is silently reused for another: the OpenCode server's
// box was created as `sleep infinity` with no published port by any turn that ran first, then adopted
// by the code that needed `opencode serve` on a published port — which discarded both and failed with
// "docker published no port for it", permanently, because the rejected promise is cached.
//
// It also closes a real hole. The read-only set is filtered to the paths that EXIST when the box is
// made, because docker creates a missing bind source root-owned. A project with no `.git` yet gets a
// box with no `.git/hooks` pin — and if the agent then runs `git init`, that directory is writable
// and a `pre-commit` hook it writes runs on the HOST at the user's next commit. Recomputing the
// digest each time means the box is rebuilt as soon as the set changes.
const SPEC_LABEL = 'io.vibeboard.spec';

export const DEFAULT_IMAGE = process.env.VIBEBOARD_AGENT_IMAGE ?? 'vibeboard-agent:latest';

// The shared base every kind stands on. Presets are LAYERS on it, never separate images — three
// projects on three kinds must not mean three times 3.5GB. decision 75.
export const BASE_IMAGE = 'vibeboard-agent:base';

// Which image a project's kind selects. `web` and no kind at all get the default image — the web
// layer keeps the `:latest` tag precisely so every project that predates kinds behaves exactly as it
// always did, with no digest change and no box churn. Only a kind that positively needs less gets less.
//
// `VIBEBOARD_AGENT_IMAGE` REDIRECTS THE WEB IMAGE AND NOTHING ELSE, which is why the base is a literal
// here and not a second variable. The override exists so a machine can point the ordinary box at an
// image of its own; the base is what `Dockerfile.agent` says `FROM`, so a kind that selects it is
// selecting a name the build produces rather than a name anybody chose.
export function imageForKind(kind: BoxKind | undefined, webImage: string = DEFAULT_IMAGE): string {
  if (kind === undefined || kind === 'web') return webImage;
  return BASE_IMAGE;
}

// The docker executable. Resolved per call rather than captured, and overridable, for ONE reason:
// the suite needs to exercise the real wrapping. `aa-exec` was transparent — it ran the host command
// it was given, so a test could put a shim on the other side of it and watch the real code path.
// `docker exec` is not: the shim does not exist inside a container. So tests point this at a stand-in
// that strips the exec prefix and runs the rest, which keeps the argv under assertion instead of
// putting a bypass inside `wrapCommand` for a gate to be bypassed through.
export function dockerBin(): string {
  return process.env.VIBEBOARD_DOCKER_BIN ?? 'docker';
}

// Where the project is mounted. Fixed, not derived from the host path: the host path is not
// necessarily representable in the container, and a constant is what lets the same image serve every
// project. It is also why per-project agent state is needed — see `copilot-env.ts`.
export const WORK_DIR = '/work';
export const SOCKET_DIR = '/run/vibeboard';
// Where the CLI's own state lives inside the box. A constant, because the host path is a digest of
// the project path and no CLI should ever be shown that.
export const STATE_DIR = '/state';

// The environment a backend's CLI needs to find its state INSIDE the box. Pure, and exported for its
// own test, because a wrong value here does not fail — it silently uses another project's sessions.
//
// Both backends need this for unrelated reasons, which is the main argument for believing it. Claude
// names its session directory after the working directory, and in a box that is always `/work`, so
// without a per-project config home every project on the machine collides in one bucket. OpenCode
// keeps sessions in a SQLite database in its data home, and sharing the user's own would put several
// containers and the user on one 265MB file as concurrent writers.
export function boxEnvFor(backend: BoxBackend): Record<string, string> {
  // /state is the backend's OWN directory, never the project's shared state root. Mounting the root
  // put OpenCode's `auth.json` inside a Claude box — see the note on `claudeStateDir`.
  if (backend === 'claude-code') return { CLAUDE_CONFIG_DIR: STATE_DIR };
  return {
    XDG_DATA_HOME: `${STATE_DIR}/data`,
    XDG_CONFIG_HOME: `${STATE_DIR}/config`,
  };
}

// A deterministic name, so a box is found again after a restart without consulting any state we wrote.
// Hashed because a project path contains `/` and may be long, and truncated because the readable half
// is the label, not the name — 12 hex characters of sha256 is far past collision risk for the number of
// projects one person opens.
export function boxName(projectRoot: string, backend: BoxBackend): string {
  const digest = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
  return `vibeboard-${digest}-${backend}`;
}

interface MountSpec {
  source: string;
  target: string;
  readOnly?: boolean;
}

export interface BoxPaths {
  projectRoot: string;
  // Per-project agent state: Claude keys sessions by working directory and the working directory is
  // always /work, so one shared config home would collide every project's sessions into one bucket.
  stateDir: string;
  // The directory holding the API socket. THE DIRECTORY, never the socket file: bind-mounting the file
  // pins an inode, and a server restart then leaves this box connecting to a deleted one forever.
  socketDir?: string;
  // The backend's own credential, and only that backend's.
  credential?: MountSpec;
  // Project-relative paths to pin read-only inside the writable project. Passed in rather than derived
  // here because only the caller can stat them, and a bind mount whose source does not exist is worse
  // than useless: docker CREATES it, as a root-owned directory, on the host.
  readOnly?: string[];
  // Project-relative paths to keep WRITABLE inside a read-only one — the report directory. The caller
  // must have created these, for the same root-owned reason as above.
  writable?: string[];
}

// Everything inside a project an agent must not write, and why each one is here.
//
// `.vibeboard` is the obvious half: cards, config, skills, foundation, the auto-pilot state — the
// documents that govern what a run is judged against.
//
// The git pair is the half that is easy to forget and worse to miss. `.git/hooks` is code THE HOST
// runs: an agent that writes `pre-commit` has arranged to execute on your machine the next time you
// commit, entirely outside the box. `.git/config` reaches the same end by other means — `core.hooksPath`
// repoints hooks somewhere writable. The old AppArmor profile denied both, and a container that only
// covered `.vibeboard` would have quietly handed them back.
const PROTECTED_PATHS = [CONFIG_DIR, '.git/hooks', '.git/config'] as const;

// The ONE place inside `.vibeboard/` an agent must be able to write: where its report goes.
//
// A writable mount NESTED inside the read-only one, never a return to an enumerated deny list. That is
// what keeps the default at DENY: anything added to `.vibeboard/` later is refused without anyone having
// to remember to name it. `RUNS_DIR` and not `RESULTS_DIR` — the report is the agent's, and the run
// records under `boards/…/results/` are the server's and stay read-only.
//
// The regression that this hole exists to close, and how the audit that caused it missed this path, are
// in docs/security/containment.md.
export const AGENT_WRITABLE_PATHS = [RUNS_DIR] as const;

// Which of the protected paths actually exist. `exists` is injected so this is testable without a
// filesystem, and so the caller decides what "exists" means.
export function protectedPaths(projectRoot: string, exists: (path: string) => boolean): string[] {
  return PROTECTED_PATHS.filter((rel) => exists(join(projectRoot, rel)));
}

// Pure, and exported for its own test: this is the security boundary, and a boundary computed inside a
// method that also shells out to docker is a boundary nothing can assert on cheaply.
export function boxMounts(paths: BoxPaths): MountSpec[] {
  const mounts: MountSpec[] = [
    { source: paths.projectRoot, target: WORK_DIR },
    { source: paths.stateDir, target: STATE_DIR },
  ];
  // Read-only ON TOP of the writable project. Nested mounts carry independent flags, which is what
  // makes this hold — and is why the reverse (a read-only parent with a writable child) famously
  // leaks. Measured: create, overwrite and delete inside are all refused, while the project stays
  // writable and the contents stay readable.
  //
  // `.git/config` is a FILE, so this pins its inode: git rewrites it by rename, and a box would go on
  // reading the old one. That is a staleness cost on a file agents may not write anyway, and it buys
  // the deny — whereas mounting all of `.git` read-only would break every commit.
  for (const rel of paths.readOnly ?? [CONFIG_DIR]) {
    mounts.push({ source: join(paths.projectRoot, rel), target: `${WORK_DIR}/${rel}`, readOnly: true });
  }
  // READ-ONLY, and this is load-bearing. The directory is a single global path shared by every box
  // on the machine, and the box runs as the uid that owns it — so a writable mount lets an agent
  // `unlink` the live socket and bind its own there. Every other box's relay reconnects per
  // connection by design, so the next request from another run (a different card, a different
  // project, or the copilot) lands on the impostor with its bearer token in the header.
  //
  // Measured: `:ro` refuses the unlink and still permits `connect()` — a read-only superblock rejects
  // writes to files, directories and symlinks, not sockets.
  // AFTER the read-only ones, and nested inside them. Docker orders bind mounts by destination depth so
  // the parent is mounted first either way, but stating it here keeps the intent readable: the deny is
  // the default and this is the single hole punched in it.
  for (const rel of paths.writable ?? []) {
    mounts.push({ source: join(paths.projectRoot, rel), target: `${WORK_DIR}/${rel}` });
  }
  if (paths.socketDir) mounts.push({ source: paths.socketDir, target: SOCKET_DIR, readOnly: true });
  if (paths.credential) mounts.push(paths.credential);
  return mounts;
}

interface CreateArgs {
  name: string;
  image: string;
  projectRoot: string;
  backend: BoxBackend;
  mounts: MountSpec[];
  env: Record<string, string>;
  user: string;
  publish?: { containerPort: number };
  command?: string[];
}

// WHY THE CAPABILITY SET IS DOCKER'S DEFAULT AND NOT `--cap-drop ALL`.
//
// The box has two levels: agent turns exec as the host user, and package installs exec as root —
// brokered by VibeBoard, never reachable by the agent, because the image ships no `sudo` at all. With
// every capability dropped, the privileged half cannot install anything either, and the box becomes a
// cage the agent cannot work in. Docker's default set is what makes the install half work.
//
// Measured 2026-08-09, root inside a box with this exact set: `apt-get install` succeeds; writing
// `/work/.vibeboard` is refused; `mount -o remount,rw` on it is refused ("permission denied");
// touching the firewall rules is refused. The read-only boundary is held by the capabilities the
// container was never granted — SYS_ADMIN and NET_ADMIN are not in the default set — and not by the
// user id, which is why loosening the user id costs nothing.
//
// The agent's own turns gain NOTHING from this: capabilities attach to root or to file capabilities,
// and a non-root process with `no-new-privileges` can acquire neither.

// Blocked outbound. Not exfiltration control — nothing at this layer is — but it keeps an agent away
// from the unauthenticated services on the machine that hosts it and from the rest of the LAN.
export const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'] as const;

// The rules are installed by a THROWAWAY CONTAINER sharing the box's network namespace, never by the
// box itself. That is the whole point: the box is created without NET_ADMIN, so nothing inside it —
// including the privileged install step, including a package's own post-install script — can flush
// what this puts there. Measured: from inside, as root, `iptables -F` answers "Permission denied".
//
// The alternative was for the box to set its own rules at startup and then drop privileges. It fails
// for a subtle reason worth recording: `docker exec` takes its capabilities from the CONTAINER's spec,
// not from PID 1, so dropping them in an entrypoint does not constrain any later exec at all.
// ONE REPLY PATH, AND ONLY ONE. A box must be able to answer the question the SERVER asks it on its
// published port, and must be able to do nothing else toward a private address.
//
// The bug this closes: the rejects below carry no state match, so they refused the second half of a
// conversation the host had started. Docker's bridge gateway is inside `172.16.0.0/12`, so the box's
// ANSWER on its published port was rejected on the way out and the port hung. It cost the OpenCode
// backend's whole model list — `listBackendModels` reads `/config/providers` over that port, the fetch
// aborts after 8s (`copilot/models.ts`), and `cached()` folds the failure into an empty array, so the
// PICKER showed nothing. The server log did say why; only the UI was silent.
//
// WHY THIS RULE IS NARROW, and the first version of it was not. A bare
// `--ctstate ESTABLISHED,RELATED -j ACCEPT` was wrong in three ways, all three measured by a review
// rather than reasoned about:
//
//  1. IT GRANDFATHERED FLOWS OPENED BEFORE THE RULES LANDED. `docker run -d` returns once the container
//     exists, so PID 1 is already running when `#applyNetworkRules` fires 0.12–0.14s later. A flow
//     opened in that window is ESTABLISHED, and a bare accept keeps it alive — conntrack's TCP timeout
//     is five days, refreshed by traffic. The reject-only rules SEVERED such a flow, which is the
//     property that version silently traded away while claiming it had not. `--ctdir REPLY` restores
//     it: an agent-initiated flow's outbound packets are the ORIGINAL direction, so they never match.
//  2. IT LICENSED EVERY PORT THE AGENT CHOSE TO LISTEN ON. `-p 127.0.0.1::4096` governs the host
//     loopback mapping, not the container's own address — which every container on the bridge, and the
//     host, can reach on ANY port. Reproduced: an unpublished listener on `0.0.0.0:8099` was
//     unreachable under reject-only rules and answered a bridge peer under the bare accept. `--sport`
//     confines the exemption to the one port VibeBoard published.
//  3. `RELATED` BOUGHT NOTHING AND COST A CATEGORY. Only ESTABLISHED is needed for a reply. `RELATED`
//     additionally matches conntrack helper expectations, so an outbound connection to a hostile public
//     server whose payload makes a helper expect a PRIVATE address would match — which is exactly the
//     "conjured from inside" this rule is supposed to make impossible. No helper modules are loaded on
//     this machine; that is not a property of the code.
//
// What remains true, and now narrowly: a box cannot OPEN a connection to a private address, and the one
// thing it may send there is a TCP reply, from the published port, on a flow something outside started.
const OPENCODE_PORT = 4096;
const REPLY_ONLY = [
  'iptables -A OUTPUT -p tcp',
  `--sport ${OPENCODE_PORT}`,
  '-m conntrack --ctstate ESTABLISHED --ctdir REPLY',
  '-j ACCEPT',
].join(' ');

export function netRuleArgs(box: string, image: string): string[] {
  // `&&`, never `;`. A `;`-joined script exits with the status of the LAST command alone, so three
  // failed rules and one that worked was indistinguishable from success — and this gate's whole
  // promise is that a box whose rules did not apply is destroyed rather than served.
  //
  // FIRST, and the order is the behaviour: iptables takes the first matching rule in a chain, so an
  // accept placed after the rejects would never be reached for exactly the addresses that need it.
  const script = [
    REPLY_ONLY,
    ...PRIVATE_RANGES.map((cidr) => `iptables -A OUTPUT -d ${cidr} -j REJECT`),
  ].join(' && ');
  return [
    'run',
    '--rm',
    `--network=container:${box}`,
    '--cap-add',
    'NET_ADMIN',
    '--user',
    '0:0',
    '--entrypoint',
    '/bin/sh',
    image,
    '-c',
    script,
  ];
}

// What must match for a running box to be reusable. Deliberately NOT the whole argv: the labels
// carry the project path and backend, which are already in the name, and including the digest in its
// own input would be circular.
export function specDigest(
  spec: Omit<CreateArgs, 'name' | 'projectRoot' | 'backend' | 'user'> & { packages?: string[] },
): string {
  const shape = {
    image: spec.image,
    mounts: spec.mounts.map((m) => `${m.source}:${m.target}${m.readOnly ? ':ro' : ''}`),
    env: Object.entries(spec.env).sort(),
    publish: spec.publish?.containerPort ?? null,
    command: spec.command ?? null,
    // IN THE DIGEST, because replay only runs at creation: a digest that ignored the list would leave
    // a live box silently missing (or keeping) a package for ever — the "looks confined" class of
    // defect, applied to the toolchain. Sorted, so a reordered config is not a rebuild. Adding this
    // key changes every existing digest once, deliberately: the same one-shot rebuild a shape bump
    // does, and the mechanism the comment below already documents. decision 75.
    packages: [...(spec.packages ?? [])].sort(),
    // THE SHAPE OF THE CONTAINER ITSELF, and it is in the digest so that a box created before it changed
    // is REPLACED rather than adopted. `--init` is not a per-spec choice — every box gets it — so without
    // a marker here the digest would be identical and every existing box on every machine would keep the
    // old pid 1 for ever. Adoption silently keeping the old shape is the exact failure the header of
    // docs/smoke-test.md records, arrived at from the other side.
    //
    // Bump this when the container's FLAGS change in a way an existing box must not keep.
    shape: 'init-1',
  };
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
}

// Also pure, also exported for its own test. Every flag here is load-bearing and several are the kind
// that fail silently when wrong, so the argv is asserted rather than trusted.
export function createArgs(spec: CreateArgs): string[] {
  const args = [
    'run',
    '-d',
    '--name',
    spec.name,
    '--label',
    `${BOX_LABEL}=1`,
    '--label',
    `${PROJECT_LABEL}=${spec.projectRoot}`,
    '--label',
    `${BACKEND_LABEL}=${spec.backend}`,
    '--label',
    `${SPEC_LABEL}=${specDigest(spec)}`,
    // The host user, so everything the agent creates in the bind mount is owned by the person who owns
    // the project rather than by root.
    '--user',
    spec.user,
    // No new privileges: a setuid binary cannot gain anything, so an agent turn has no escalation
    // route even if one were installed. This is what makes the two-level design safe — see below.
    '--security-opt',
    'no-new-privileges',
    '-w',
    WORK_DIR,
    // A REAL PID 1, so orphaned processes are reaped. The box's command is `sleep infinity` — the right
    // shape, because a box must outlive any one `docker exec` — but `sleep` never calls `wait()`, so
    // nothing reaps an orphan. Measured: a Playwright run that hit `runTimeoutMs` left 22 `chrome-headless`
    // entries in the pid table two minutes later, every one of them state `Z`, reparented to pid 1. The
    // browsers had died exactly as they should; what survived was the unreaped entry, for the life of a box
    // that is long-lived by design.
    //
    // `--init` is docker's own tini. It costs one process and no configuration, and it also forwards
    // signals to the command — which `sleep infinity` as pid 1 does not.
    '--init',
  ];
  for (const m of spec.mounts) {
    args.push('-v', `${m.source}:${m.target}${m.readOnly ? ':ro' : ''}`);
  }
  for (const [k, v] of Object.entries(spec.env)) {
    args.push('-e', `${k}=${v}`);
  }
  // Published on loopback only. The port exists so VibeBoard can reach `opencode serve` inside the box;
  // exposing it on every interface would put an agent server that auto-approves every tool call on the
  // network. The host port is left to docker and read back with `docker port`.
  if (spec.publish) args.push('-p', `127.0.0.1::${spec.publish.containerPort}`);
  args.push(spec.image);
  if (spec.command) args.push(...spec.command);
  return args;
}

export interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type DockerRun = (args: string[], opts?: { timeoutMs?: number }) => Promise<DockerResult>;

export type BoxState = 'running' | 'stopped' | 'absent';

interface BoxInspection {
  state: BoxState;
  // The spec digest the box was created with, or '' for one made before this label existed.
  spec: string;
}

// State and spec in one call: two calls would be two round trips and, worse, a window in which the
// answers disagree. The IPv6 address is deliberately NOT among them — see `globalIPv6` below for the
// production failure that taught that.
//
// A PIPE, NOT WHITESPACE. Docker prints `<no value>` for a label that is not set — WITH A SPACE IN IT —
// so splitting on whitespace put `<no` in the spec field. The two-field version had the same fault and
// got away with it: a mangled spec reads as "not the digest we wanted", which rebuilds, so the
// `=== '<no value>'` line below could never once have matched. Neither value can contain a pipe.
const FIELDS = `{{.State.Running}}|{{index .Config.Labels "${SPEC_LABEL}"}}`;

export async function inspectState(docker: DockerRun, name: string): Promise<BoxInspection> {
  const res = await docker(['inspect', '-f', FIELDS, name]);
  if (res.code !== 0) return { state: 'absent', spec: '' };
  const [running = '', spec = ''] = res.stdout.trim().split('|');
  return {
    state: running.trim() === 'true' ? 'running' : 'stopped',
    // docker prints `<no value>` for a label that is not set.
    spec: spec.trim() === '<no value>' ? '' : spec.trim(),
  };
}

// A GLOBAL IPv6 ADDRESS, IF DOCKER GAVE THE BOX ONE — and a SEPARATE call, which is the whole lesson of
// this function. It was folded into `inspectState` above to save a round trip and to avoid a second
// `inspect` shape the test doubles would answer wrongly. Both were true and both were worth less than
// this: an OPTIONAL field must never be able to make a live box read as absent.
//
// WHAT ACTUALLY HAPPENED, on Docker 29 with the first version of the template. `.NetworkSettings` is
// rendered from a map that has no `GlobalIPv6Address` key at all, so `{{.NetworkSettings.GlobalIPv6Address}}`
// is not an empty string — it is a TEMPLATE ERROR, and `docker inspect` exits 1. `inspectState` reads a
// non-zero exit as "no such container", so `ensure` went on to create a box that already existed and
// every single agent run died on `Conflict. The container name is already in use`. Nothing in the suite
// could see it: every unit test uses a fake docker, and the one integration test that uses a real
// daemon only ever CREATES boxes, so it never reaches the adoption path where this bites.
//
// AND THE SECOND HALF WAS WRONG TOO, in the opposite direction. `{{range .NetworkSettings.Networks}}{{.GlobalIPv6Address}}{{end}}`
// exits 0 and prints **`invalid IP`** for a container with no v6 — Go rendering an empty `net.IP` — which
// the caller would have taken for an address and used to refuse every box on the machine. Ranging with an
// explicit `$v` and reading it with `index` prints the empty string it really is.
//
// SO THE ANSWER IS VALIDATED RATHER THAN TRUSTED: only a token containing a colon is an address. That
// rejects `<no value>`, `invalid IP`, and anything else a future version decides to print.
const IPV6 =
  '{{index .NetworkSettings "GlobalIPv6Address"}} ' +
  '{{range $k, $v := .NetworkSettings.Networks}}{{index $v "GlobalIPv6Address"}} {{end}}';

export async function globalIPv6(docker: DockerRun, name: string): Promise<string> {
  // `--format` and not `-f`, so this call is distinguishable from the one above by its argv alone —
  // every test double in the suite keys on the first argument or the first two.
  const res = await docker(['inspect', '--format', IPV6, name]);
  // A FAILURE HERE IS NOT AN ANSWER. Unlike `inspectState`, nothing about this call's exit code says
  // anything about whether the container exists, and treating it as though it did is the defect above.
  if (res.code !== 0) return '';
  return (
    res.stdout
      .trim()
      .split(/\s+/)
      .find((t) => t.includes(':')) ?? ''
  );
}

// IS THIS BOX'S VIEW OF THE PROJECT STILL THE PROJECT? One exec that does nothing, in the working
// directory every agent turn will use.
//
// A bind mount pins the inode it resolved at container start. Replace the project directory on the host
// — delete and re-clone, restore from a backup, `mv` a new tree into place — and the container goes on
// holding the deleted one. Every exec into it then dies before the agent binary runs:
//
//     OCI runtime exec failed: ... current working directory is outside of container mount namespace
//
// Measured 2026-08-14: `derive-features` burned all three attempts in under four seconds and auto-pilot
// reported the CARD as the problem, saying a README nothing had opened might be too thin.
//
// `true` rather than a shell builtin or a stat: the failure happens in `docker exec` itself, setting the
// working directory, before the command is looked at. What runs is irrelevant — what matters is that
// something is asked to run in `/work`.
export function workdirProbeArgs(name: string): string[] {
  return ['exec', '-w', WORK_DIR, name, 'true'];
}

// The exec prefix for a box: what `wrapCommand` returns once containment is a container.
export function execArgs(
  name: string,
  bin: string,
  args: string[],
  env: Record<string, string> = {},
): string[] {
  // `-i` IS LOAD-BEARING, and its absence is silent. `docker exec` without it does not forward stdin
  // at all — it is discarded before the container sees a byte.
  //
  // Everything the agent is asked to do arrives on stdin. That is deliberate and cannot change: the
  // prompt carries the run's credential, and a command line is world-readable through
  // /proc/<pid>/cmdline for as long as the process lives, so passing it as an argument would let any
  // other agent on the machine lift another run's token with `ps`.
  //
  // Without this flag `claude -p` starts, finds nothing on stdin, and exits 1 with "Input must be
  // provided either through stdin or as a prompt argument when using --print". Observed on a real
  // project: three attempts burned in six seconds and the card left needing a person.
  const out = ['exec', '-i', '-w', WORK_DIR];
  for (const [k, v] of Object.entries(env)) out.push('-e', `${k}=${v}`);
  out.push(name, bin, ...args);
  return out;
}

// THE PRIVILEGED HALF. Installing a system package needs root; an agent must never have it. So the
// escalation lives out here, in VibeBoard, and the agent reaches it the way it reaches everything else
// it cannot do for itself — by asking. Same principle as S1: a separate process holding a capability
// the agent does not have.
//
// The image ships no `sudo`, so this is not a blocked route for the agent. It is an absent one.
export const INSTALL_HELPER = '/opt/vibeboard/vb-install';

// A helper script with `"$@"`, NOT a shell string. Package names arrive from an agent, and an agent
// reads whatever is in the repository it was pointed at — so a name is untrusted input. Passing argv
// means `;` and `$(…)` in a name are a name, never a command.
export function installArgs(name: string, packages: string[]): string[] {
  return ['exec', '-u', '0:0', name, INSTALL_HELPER, ...packages];
}

// WHERE TO GO AND FIX IT. One string, beside the validator it is about, because three refusals over this
// one list end the same way — two parse failures in `box-service.ts` and apt's own, which arrives from a
// different layer entirely — and a person who has seen the clause once should recognise it on the third.
export const FIX_PACKAGES = ' — fix box.packages in .vibeboard/config.yaml';

// Belt as well as braces. Debian package names are lowercase alphanumerics with `+`, `-` and `.`;
// anything else is refused before it reaches docker rather than being escaped.
export function isPackageName(name: string): boolean {
  return /^[a-z0-9][a-z0-9+.-]{0,62}$/.test(name);
}

// The host port docker chose for a published container port. Parsed rather than assumed, because
// `-p 127.0.0.1::N` deliberately lets docker pick — a fixed host port would collide the moment two
// projects were open at once.
export function parsePublishedPort(output: string): number | undefined {
  // `127.0.0.1:32768` — and on some versions several lines, one per protocol.
  for (const line of output.split('\n')) {
    const m = line.trim().match(/:(\d+)$/);
    if (m) return Number(m[1]);
  }
  return undefined;
}
