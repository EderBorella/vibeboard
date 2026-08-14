import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CONFIG_DIR, RUNS_DIR } from '../core/layout.js';

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

export type BoxBackend = 'claude-code' | 'opencode';

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
// This was a regression, and an instructive one. The AppArmor profile containment replaced denied the
// `.vibeboard` directory entry and then each governed path BY NAME — boards, config.yaml, skills,
// foundation, project-runs, the diary, the state file — with a comment on the first line reading
// "`runs/` stays writable, which the suite pins". Replacing that enumerated list with one blanket
// read-only mount took away the only directory an agent is REQUIRED to write to.
//
// What it looked like: `derive-features` did its work, created ten cards through the API, and came back
// `attention` — "finished without writing a report". The critic could not write its verdict either, so
// it could not judge. Two runs, real money, no way to record either. The agent diagnosed it in its own
// thinking: "the directory is read-only. This seems like a system-level issue."
//
// How it was missed: the plan checked `RESULTS_DIR` — `boards/…/results/`, which the SERVER writes —
// concluded the folder was safe to deny wholesale, and never looked at `RUNS_DIR`, the report path and a
// different constant entirely.
//
// A writable mount nested inside the read-only one, rather than a return to an enumerated deny list.
// That keeps the default at DENY: anything added to `.vibeboard/` later is refused without anyone having
// to remember to name it, which is the failure mode the enumerated version carried. Measured: the report
// lands, and boards, foundation and the `.vibeboard` root itself all still refuse.
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
export function netRuleArgs(box: string, image: string): string[] {
  // `&&`, never `;`. A `;`-joined script exits with the status of the LAST command alone, so three
  // failed rules and one that worked was indistinguishable from success — and this gate's whole
  // promise is that a box whose rules did not apply is destroyed rather than served.
  const script = PRIVATE_RANGES.map((cidr) => `iptables -A OUTPUT -d ${cidr} -j REJECT`).join(' && ');
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
export function specDigest(spec: Omit<CreateArgs, 'name' | 'projectRoot' | 'backend' | 'user'>): string {
  const shape = {
    image: spec.image,
    mounts: spec.mounts.map((m) => `${m.source}:${m.target}${m.readOnly ? ':ro' : ''}`),
    env: Object.entries(spec.env).sort(),
    publish: spec.publish?.containerPort ?? null,
    command: spec.command ?? null,
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

type BoxState = 'running' | 'stopped' | 'absent';

interface BoxInspection {
  state: BoxState;
  // The spec digest the box was created with, or '' for one made before this label existed.
  spec: string;
}

// State AND spec in one call. Two calls would be two round trips and, worse, a window in which the
// answers disagree.
export async function inspectState(docker: DockerRun, name: string): Promise<BoxInspection> {
  const res = await docker([
    'inspect',
    '-f',
    `{{.State.Running}} {{index .Config.Labels "${SPEC_LABEL}"}}`,
    name,
  ]);
  if (res.code !== 0) return { state: 'absent', spec: '' };
  const [running = '', spec = ''] = res.stdout.trim().split(/\s+/);
  return {
    state: running === 'true' ? 'running' : 'stopped',
    // docker prints `<no value>` for a label that is not set.
    spec: spec === '<no value>' ? '' : spec,
  };
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
