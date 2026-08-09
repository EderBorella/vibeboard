import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CONFIG_DIR } from '../core/layout.js';

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

export const DEFAULT_IMAGE = process.env.VIBEBOARD_AGENT_IMAGE ?? 'vibeboard-agent:latest';

// Where the project is mounted. Fixed, not derived from the host path: the host path is not
// necessarily representable in the container, and a constant is what lets the same image serve every
// project. It is also why per-project agent state is needed — see `copilot-env.ts`.
export const WORK_DIR = '/work';
export const SOCKET_DIR = '/run/vibeboard';

// A deterministic name, so a box is found again after a restart without consulting any state we wrote.
// Hashed because a project path contains `/` and may be long, and truncated because the readable half
// is the label, not the name — 12 hex characters of sha256 is far past collision risk for the number of
// projects one person opens.
export function boxName(projectRoot: string, backend: BoxBackend): string {
  const digest = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
  return `vibeboard-${digest}-${backend}`;
}

export interface MountSpec {
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
}

// Pure, and exported for its own test: this is the security boundary, and a boundary computed inside a
// method that also shells out to docker is a boundary nothing can assert on cheaply.
export function boxMounts(paths: BoxPaths): MountSpec[] {
  const mounts: MountSpec[] = [
    { source: paths.projectRoot, target: WORK_DIR },
    // Read-only ON TOP of the writable project. Nested mounts carry independent flags, which is what
    // makes this hold — and is why the reverse (a read-only parent with a writable child) famously
    // leaks. Measured: create, overwrite and delete inside are all refused, while the project stays
    // writable and the contents stay readable.
    { source: join(paths.projectRoot, CONFIG_DIR), target: `${WORK_DIR}/${CONFIG_DIR}`, readOnly: true },
    { source: paths.stateDir, target: '/state' },
  ];
  if (paths.socketDir) mounts.push({ source: paths.socketDir, target: SOCKET_DIR });
  if (paths.credential) mounts.push(paths.credential);
  return mounts;
}

export interface CreateArgs {
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
    // The host user, so everything the agent creates in the bind mount is owned by the person who owns
    // the project rather than by root.
    '--user',
    spec.user,
    // No new privileges, and no capabilities. Nothing an agent runs needs either, and dropping them
    // costs nothing.
    '--security-opt',
    'no-new-privileges',
    '--cap-drop',
    'ALL',
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

export type BoxState = 'running' | 'stopped' | 'absent';

export async function inspectState(docker: DockerRun, name: string): Promise<BoxState> {
  const res = await docker(['inspect', '-f', '{{.State.Running}}', name]);
  if (res.code !== 0) return 'absent';
  return res.stdout.trim() === 'true' ? 'running' : 'stopped';
}

// The exec prefix for a box: what `wrapCommand` returns once containment is a container.
export function execArgs(
  name: string,
  bin: string,
  args: string[],
  env: Record<string, string> = {},
): string[] {
  const out = ['exec', '-w', WORK_DIR];
  for (const [k, v] of Object.entries(env)) out.push('-e', `${k}=${v}`);
  out.push(name, bin, ...args);
  return out;
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
