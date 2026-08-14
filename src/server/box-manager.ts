import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import {
  BOX_LABEL,
  type BoxBackend,
  type BoxPaths,
  boxMounts,
  boxName,
  createArgs,
  DEFAULT_IMAGE,
  type DockerResult,
  type DockerRun,
  dockerBin,
  execArgs,
  inspectState,
  installArgs,
  isPackageName,
  netRuleArgs,
  parsePublishedPort,
  protectedPaths,
  specDigest,
} from './containers.js';

const run = promisify(execFile);

// Talking to docker. One function, injectable, because everything above it is then testable without a
// daemon — and because the tests must not depend on a machine that happens to have docker.
const spawnDocker: DockerRun = async (args, opts): Promise<DockerResult> => {
  try {
    const { stdout, stderr } = await run(dockerBin(), args, { timeout: opts?.timeoutMs ?? 30_000 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) };
  }
};

// The mounts for a project, with the protected paths filtered to the ones that actually exist. A bind
// mount whose source is missing is not ignored by docker — it CREATES it, root-owned, on the host, so a
// project with no `.git` would grow a root-owned `.git/hooks` the first time a box started.
export function boxPathsFor(
  projectRoot: string,
  extra: Omit<BoxPaths, 'projectRoot' | 'readOnly'>,
  exists: (path: string) => boolean = existsSync,
): BoxPaths {
  return { projectRoot, readOnly: protectedPaths(projectRoot, exists), ...extra };
}

// Why a box was thrown away and remade — the digest it had, and the one it needed.
export type RebuildNotice = (name: string, was: string, now: string) => void;

export interface BoxHandle {
  name: string;
  // Only for a box that publishes one — OpenCode's, whose server VibeBoard reaches over HTTP.
  hostPort?: number;
}

export interface EnsureOptions {
  projectRoot: string;
  backend: BoxBackend;
  paths: BoxPaths;
  env?: Record<string, string>;
  publishPort?: number;
  command?: string[];
  image?: string;
}

export class BoxManager {
  #docker: DockerRun;
  #user: string;

  // Told, not logged directly: rebuilding somebody's box is worth a line in the server log, and this
  // module has no logger and should not grow one.
  #onRebuild: RebuildNotice | undefined;

  constructor(opts: { docker?: DockerRun; user?: string; onRebuild?: RebuildNotice } = {}) {
    this.#docker = opts.docker ?? spawnDocker;
    this.#onRebuild = opts.onRebuild;
    // Resolved once. `process.getuid` is undefined on Windows, where none of this runs anyway.
    this.#user = opts.user ?? `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  }

  // Is a box even possible here? Separate from `ensure` so the answer can be given before a dispatch is
  // attempted rather than as the failure of one — a box that cannot start surfaces as a non-zero exit
  // of the agent's own command, which is indistinguishable from the agent failing.
  async probe(image = DEFAULT_IMAGE): Promise<{ ok: true } | { ok: false; reason: string }> {
    const info = await this.#docker(['version', '-f', '{{.Server.Version}}']);
    if (info.code !== 0) {
      return { ok: false, reason: `Docker is not available — ${firstLine(info.stderr) || 'no daemon'}` };
    }
    const img = await this.#docker(['image', 'inspect', '-f', '{{.Id}}', image]);
    if (img.code !== 0) {
      return { ok: false, reason: `the agent image ${image} is not built — run \`npm run box:build\`` };
    }
    return { ok: true };
  }

  // Create the box, or adopt the one already there.
  //
  // ADOPT RATHER THAN RECREATE. A container outlives VibeBoard by design, so after a restart there may
  // be a healthy box with an agent's session state in it. Killing it would throw away in-flight work
  // because the SERVER restarted, which is not the user's doing and not a good trade. A stopped box is
  // started rather than rebuilt for the same reason.
  async ensure(opts: EnsureOptions): Promise<BoxHandle> {
    const name = boxName(opts.projectRoot, opts.backend);
    const spec = {
      image: opts.image ?? DEFAULT_IMAGE,
      mounts: boxMounts(opts.paths),
      env: opts.env ?? {},
      publish: opts.publishPort ? { containerPort: opts.publishPort } : undefined,
      command: opts.command,
    };
    const wanted = specDigest(spec);
    const found = await inspectState(this.#docker, name);
    let state = found.state;

    // ADOPTION IS BY NAME **AND SPEC**. A box's mounts, published ports and command are fixed when it
    // is created, so a box built for one purpose cannot serve another — and adopting one anyway is
    // silent, which is the worst property a containment decision can have. Two real failures came
    // from adopting on the name alone: an OpenCode server box adopted from a `sleep infinity` box
    // that any earlier turn had created, so it never published a port; and a box created before the
    // project had a `.git`, which therefore had no `.git/hooks` pin and never gained one.
    if (state !== 'absent' && found.spec !== wanted) {
      this.#onRebuild?.(name, found.spec, wanted);
      await this.#docker(['rm', '-f', name], { timeoutMs: 60_000 });
      state = 'absent';
    }

    if (state === 'absent') {
      const args = createArgs({
        name,
        projectRoot: opts.projectRoot,
        backend: opts.backend,
        user: this.#user,
        ...spec,
      });
      const created = await this.#docker(args, { timeoutMs: 120_000 });
      if (created.code !== 0) {
        throw new Error(`could not start the agent box: ${firstLine(created.stderr)}`);
      }
      await this.#applyNetworkRules(name, opts.image ?? DEFAULT_IMAGE);
    } else if (state === 'stopped') {
      const started = await this.#docker(['start', name]);
      if (started.code !== 0) {
        throw new Error(`could not restart the agent box: ${firstLine(started.stderr)}`);
      }
      // Again on restart, NOT only on creation. A container's network namespace is rebuilt when it
      // starts, so rules installed into the old one are gone — a stopped-and-started box would come
      // back with the private network open and nothing would say so.
      await this.#applyNetworkRules(name, opts.image ?? DEFAULT_IMAGE);
    }

    return {
      name,
      hostPort: opts.publishPort ? await this.#publishedPort(name, opts.publishPort) : undefined,
    };
  }

  // FAILS THE BOX, deliberately. A box whose outbound rules did not apply is a box that can reach
  // every unauthenticated service on the machine and the rest of the LAN — which is precisely the
  // thing this is here to prevent. Carrying on with a warning would mean the protection is present
  // when it happens to work and absent, silently, when it does not.
  async #applyNetworkRules(name: string, image: string): Promise<void> {
    const res = await this.#docker(netRuleArgs(name, image), { timeoutMs: 60_000 });
    if (res.code !== 0) {
      await this.#docker(['rm', '-f', name], { timeoutMs: 60_000 });
      throw new Error(`could not confine the agent box's network: ${firstLine(res.stderr)}`);
    }
  }

  // The privileged half, and the only place in VibeBoard that runs anything in a box as root.
  async install(name: string, packages: string[]): Promise<DockerResult> {
    const bad = packages.filter((p) => !isPackageName(p));
    if (bad.length > 0 || packages.length === 0) {
      return {
        code: 2,
        stdout: '',
        stderr: packages.length === 0 ? 'no packages given' : `not a package name: ${bad.join(', ')}`,
      };
    }
    // Long, because apt over a slow link is slow and a half-installed package is worse than a wait.
    return this.#docker(installArgs(name, packages), { timeoutMs: 600_000 });
  }

  async #publishedPort(name: string, containerPort: number): Promise<number | undefined> {
    const res = await this.#docker(['port', name, String(containerPort)]);
    return res.code === 0 ? parsePublishedPort(res.stdout) : undefined;
  }

  // Run something in the box. Returns argv rather than executing, so the existing spawn sites keep
  // their own process handling — their timeouts, their process-group kills, their stream plumbing.
  exec(
    name: string,
    bin: string,
    args: string[],
    env: Record<string, string> = {},
  ): { bin: string; args: string[] } {
    return { bin: dockerBin(), args: execArgs(name, bin, args, env) };
  }

  async stop(projectRoot: string, backend: BoxBackend): Promise<void> {
    await this.#docker(['rm', '-f', boxName(projectRoot, backend)], { timeoutMs: 60_000 });
  }

  // Every box this VibeBoard knows how to make, found by label rather than by anything we wrote down.
  // Used on shutdown and to reap boxes belonging to a project that is no longer open.
  async list(): Promise<string[]> {
    const res = await this.#docker([
      'ps',
      '-aq',
      '--filter',
      `label=${BOX_LABEL}=1`,
      '--format',
      '{{.Names}}',
    ]);
    if (res.code !== 0) return [];
    return res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async stopAll(): Promise<number> {
    const names = await this.list();
    for (const name of names) await this.#docker(['rm', '-f', name], { timeoutMs: 60_000 });
    return names.length;
  }
}

// Docker's errors are multi-line and the first line is the one a person needs; the rest is a usage dump.
function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ''
  );
}
