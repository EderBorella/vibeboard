import { existsSync } from 'node:fs';
import { apiSocketDir } from './api-socket.js';
import { BoxManager, boxPathsFor } from './box-manager.js';
import type { BoxBackend, BoxPaths } from './containers.js';
import { boxEnvFor, DEFAULT_IMAGE, SOCKET_DIR, STATE_DIR, WORK_DIR } from './containers.js';
import {
  claudeCredentialFile,
  claudeStateDir,
  opencodeConfigHome,
  opencodeStateDir,
  projectStateDir,
} from './copilot-env.js';

// What a box is FOR a given project and backend: which directories it gets, which credential, and
// which environment the CLI inside it needs. The manager below it knows docker and nothing about
// VibeBoard; this knows VibeBoard and delegates every docker verb.
//
// Split that way because the mount set is the security boundary and the environment is the thing most
// likely to be wrong in a way tests can catch — both are pure functions of (project, backend) here,
// and neither needs a daemon to assert.

// The mount set for a project and backend. The credential is the whole of S2: a Claude box gets the
// Claude credential at its own absolute host path (so the symlink in the config dir resolves inside),
// and an OpenCode box gets nothing of the sort — its credential was copied into its own state dir.
export function boxPathsForBackend(
  projectRoot: string,
  backend: BoxBackend,
  exists: (path: string) => boolean = existsSync,
): BoxPaths {
  const extra: Omit<BoxPaths, 'projectRoot' | 'readOnly'> = {
    stateDir: projectStateDir(projectRoot),
    socketDir: apiSocketDir(),
  };
  if (backend === 'claude-code') {
    const credential = claudeCredentialFile();
    if (exists(credential)) {
      // Mounted at its own path, not at a tidy one: the symlink VibeBoard writes into the config dir
      // is absolute, so the path has to mean the same thing on both sides of the boundary.
      extra.credential = { source: credential, target: credential };
    }
  }
  return boxPathsFor(projectRoot, extra, exists);
}

export interface EnsuredBox {
  name: string;
  hostPort?: number;
}

export class BoxService {
  #manager: BoxManager;
  #image: string;

  constructor(opts: { manager?: BoxManager; image?: string } = {}) {
    this.#manager = opts.manager ?? new BoxManager();
    this.#image = opts.image ?? DEFAULT_IMAGE;
  }

  get manager(): BoxManager {
    return this.#manager;
  }

  async probe(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.#manager.probe(this.#image);
  }

  // Called before every agent turn, not only at project creation. Creation is when a box is normally
  // born, but a box can be removed by a `docker system prune`, by an image rebuild, or by the user —
  // and a project whose box vanished must keep working rather than becoming permanently broken. The
  // manager adopts a running box, so the common case is one `docker inspect`.
  async ensure(
    projectRoot: string,
    backend: BoxBackend,
    publishPort?: number,
    command?: string[],
  ): Promise<EnsuredBox> {
    // Created eagerly, because docker would otherwise create the missing sources itself, root-owned.
    if (backend === 'claude-code') claudeStateDir(projectRoot);
    else {
      opencodeStateDir(projectRoot);
      opencodeConfigHome(projectRoot);
    }
    return this.#manager.ensure({
      projectRoot,
      backend,
      paths: boxPathsForBackend(projectRoot, backend),
      env: boxEnvFor(backend),
      image: this.#image,
      ...(publishPort ? { publishPort } : {}),
      // `sleep infinity` by default: a box with no agent in it still has to stay alive, because
      // agents arrive by `docker exec` and a container whose main process has exited cannot be
      // exec'd into. OpenCode's box overrides it — there, the server IS the main process.
      command: command ?? ['sleep', 'infinity'],
    });
  }

  exec(name: string, bin: string, args: string[], env: Record<string, string> = {}) {
    return this.#manager.exec(name, bin, args, env);
  }

  async install(name: string, packages: string[]) {
    return this.#manager.install(name, packages);
  }

  async stop(projectRoot: string, backend: BoxBackend): Promise<void> {
    await this.#manager.stop(projectRoot, backend);
  }

  // Every box, whoever made it. Used at startup — where the ones left by a crashed VibeBoard are the
  // point — and at shutdown.
  async stopAll(): Promise<number> {
    return this.#manager.stopAll();
  }
}

export { boxEnvFor, SOCKET_DIR, STATE_DIR, WORK_DIR };
