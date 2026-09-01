import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { apiSocketDir } from './api-socket.js';
import { BoxManager, boxPathsFor, type ProbeResult } from './box-manager.js';
import type { BoxBackend, BoxPaths } from './containers.js';
import {
  AGENT_WRITABLE_PATHS,
  boxEnvFor,
  DEFAULT_IMAGE,
  SOCKET_DIR,
  STATE_DIR,
  WORK_DIR,
} from './containers.js';
import {
  claudeStateDir,
  mirrorClaudeCredential,
  mirrorOpencodeCredential,
  opencodeStateDir,
} from './copilot-env.js';

// What a box is FOR a given project and backend: which directories it gets, which credential, and
// which environment the CLI inside it needs. The manager below it knows docker and nothing about
// VibeBoard; this knows VibeBoard and delegates every docker verb.
//
// Split that way because the mount set is the security boundary and the environment is the thing most
// likely to be wrong in a way tests can catch — both are pure functions of (project, backend) here,
// and neither needs a daemon to assert.

// The mount set for a project and backend. The credential is the whole of S2: a Claude box gets
// VibeBoard's mirror of the Claude credential, at its own absolute host path (so the symlink in the
// config dir resolves inside), and an OpenCode box gets nothing of the sort — its credential was
// copied into its own state dir.
export function boxPathsForBackend(
  projectRoot: string,
  backend: BoxBackend,
  exists: (path: string) => boolean = existsSync,
): BoxPaths {
  // THE BACKEND'S OWN state directory, never the project's shared root. The root holds both
  // backends' state, and mounting it gave a Claude box a readable copy of OpenCode's `auth.json` —
  // the one thing S2 exists to prevent. Found in review 2026-08-09.
  const extra: Omit<BoxPaths, 'projectRoot' | 'readOnly'> = {
    // Created here, because a bind mount whose source is missing is created BY DOCKER, root-owned — and
    // this one is missing on every project that has not run an agent yet, which is exactly the projects
    // that are about to.
    writable: [...AGENT_WRITABLE_PATHS].map((rel) => {
      mkdirSync(join(projectRoot, rel), { recursive: true });
      return rel;
    }),
    stateDir: backend === 'claude-code' ? claudeStateDir(projectRoot) : opencodeStateDir(projectRoot),
    socketDir: apiSocketDir(),
  };
  // Refreshed HERE, not only when a box is created, because this runs on every `ensure()` and `ensure()`
  // runs before every agent turn. That cadence is the fix: the host's token is refreshed by the user's
  // own CLI at times VibeBoard never hears about, and a mirror updated only at box creation would go
  // stale exactly as the old file mount did. It is two `stat`s when nothing has changed.
  //
  // BOTH BACKENDS, as of 2026-09-01. OpenCode used to get a per-project copy made once and never again,
  // which is the same staleness through a different door — see `mirrorOpencodeCredential`.
  const credential = backend === 'claude-code' ? mirrorClaudeCredential() : mirrorOpencodeCredential();
  if (credential) {
    // THE DIRECTORY, never the file, and this is the whole fix. A bind-mounted file pins an inode; a
    // token refresh is an atomic replace, which makes a new one; so the box read a deleted inode forever
    // and every turn failed as an expired session. A directory mount follows the rename. The measurement
    // is on `mirrorClaudeCredential`.
    //
    // Mounted at its own path, not at a tidy one: the symlink VibeBoard writes into the state dir is
    // absolute, so the path has to mean the same thing on both sides of the boundary.
    //
    // S2 STILL HOLDS, by the mechanism it always did: each backend's mirror is its own LEAF of
    // `credentialHome()`, so a Claude box mounts `<creds>/claude` and an OpenCode box `<creds>/opencode`,
    // and nothing mounts the parent. One directory for both would have put each backend's credential
    // inside the other's box, which is the single thing S2 exists to prevent.
    const dir = dirname(credential);
    extra.credential = { source: dir, target: dir };
  }
  return boxPathsFor(projectRoot, extra, exists);
}

interface EnsuredBox {
  name: string;
  hostPort?: number;
}

// The OpenCode server's port INSIDE its box. It lives here rather than beside the server that binds it
// because the box's shape is decided here, for every caller — and the two disagreeing was the bug.
export const OPENCODE_CONTAINER_PORT = 4096;

// WHAT A BOX IS CREATED AS, derived from the backend and from nothing else.
//
// This used to be the caller's to pass, and the callers disagreed. `opencode-server.ts` asked for a box
// publishing this port whose main process is `opencode serve`; `agent-runner.ts`, `copilot.ts` and
// `toolchain-routes.ts` asked for the same box — same project, same backend, same NAME — with no port
// and `sleep infinity`. Adoption is by name AND spec, so each one's `ensure` found the other's box,
// saw a different digest, `docker rm -f`'d it and rebuilt. Not once: for ever, alternating.
//
// Measured on a live project on 2026-08-16: the server came up on 127.0.0.1:32775, a run dispatched 25
// seconds later, and a container of the same name was created 209ms after that with `sleep infinity`
// and no ports. VibeBoard still held the old URL, so three attempts died in 449ms each with
// `fetch failed`, and auto-pilot told the user their README was too thin to derive features from.
// Claude never showed it, because there every caller wants this same plain shape.
//
// So the shape is a pure function of the backend, and there is no parameter to disagree through.
function boxShape(backend: BoxBackend): { publishPort?: number; command: string[] } {
  if (backend === 'opencode') {
    return {
      publishPort: OPENCODE_CONTAINER_PORT,
      command: [
        'opencode',
        'serve',
        '--port',
        String(OPENCODE_CONTAINER_PORT),
        // 0.0.0.0 INSIDE the box, not 127.0.0.1: the container's loopback is its own, so a server bound
        // there is unreachable from the host. What keeps it off the network is the published port,
        // which docker binds to the host's 127.0.0.1 and nothing else.
        '--hostname',
        '0.0.0.0',
      ],
    };
  }
  // `sleep infinity` otherwise: a box with no agent in it still has to stay alive, because agents
  // arrive by `docker exec` and a container whose main process has exited cannot be exec'd into.
  return { command: ['sleep', 'infinity'] };
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

  async probe(): Promise<ProbeResult> {
    return this.#manager.probe(this.#image);
  }

  // Called before every agent turn, not only at project creation. Creation is when a box is normally
  // born, but a box can be removed by a `docker system prune`, by an image rebuild, or by the user —
  // and a project whose box vanished must keep working rather than becoming permanently broken. The
  // manager adopts a running box, so the common case is one `docker inspect`.
  //
  // THE SHAPE IS NOT A PARAMETER. It is `boxShape(backend)` above, so that two callers cannot ask for
  // the same box in two different ways — which they did, and which evicted each other's container.
  async ensure(projectRoot: string, backend: BoxBackend): Promise<EnsuredBox> {
    const shape = boxShape(backend);
    // `boxPathsForBackend` creates the state directory as a side effect, which is deliberate: docker
    // would otherwise create a missing bind source itself, root-owned, on the host.
    return this.#manager.ensure({
      projectRoot,
      backend,
      paths: boxPathsForBackend(projectRoot, backend),
      env: boxEnvFor(backend),
      image: this.#image,
      ...(shape.publishPort ? { publishPort: shape.publishPort } : {}),
      command: shape.command,
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
