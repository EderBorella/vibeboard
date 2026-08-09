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
  execArgs,
  inspectState,
  parsePublishedPort,
  protectedPaths,
} from './containers.js';

const run = promisify(execFile);

// Talking to docker. One function, injectable, because everything above it is then testable without a
// daemon — and because the tests must not depend on a machine that happens to have docker.
export const spawnDocker: DockerRun = async (args, opts): Promise<DockerResult> => {
  try {
    const { stdout, stderr } = await run('docker', args, { timeout: opts?.timeoutMs ?? 30_000 });
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

  constructor(opts: { docker?: DockerRun; user?: string } = {}) {
    this.#docker = opts.docker ?? spawnDocker;
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
    const state = await inspectState(this.#docker, name);

    if (state === 'absent') {
      const args = createArgs({
        name,
        image: opts.image ?? DEFAULT_IMAGE,
        projectRoot: opts.projectRoot,
        backend: opts.backend,
        mounts: boxMounts(opts.paths),
        env: opts.env ?? {},
        user: this.#user,
        publish: opts.publishPort ? { containerPort: opts.publishPort } : undefined,
        command: opts.command,
      });
      const created = await this.#docker(args, { timeoutMs: 120_000 });
      if (created.code !== 0) {
        throw new Error(`could not start the agent box: ${firstLine(created.stderr)}`);
      }
    } else if (state === 'stopped') {
      const started = await this.#docker(['start', name]);
      if (started.code !== 0) {
        throw new Error(`could not restart the agent box: ${firstLine(started.stderr)}`);
      }
    }

    return {
      name,
      hostPort: opts.publishPort ? await this.#publishedPort(name, opts.publishPort) : undefined,
    };
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
    return { bin: 'docker', args: execArgs(name, bin, args, env) };
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
