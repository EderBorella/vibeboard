import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

// The API, reachable from inside an agent box — over a unix socket, not the network.
//
// WHY NOT THE NETWORK. An agent in a container cannot reach the host's `127.0.0.1`, and reaching the
// host any other way costs the user a root command: measured on Ubuntu 24.04, `ufw` drops the docker
// bridge, so `host.docker.internal` resolves and then times out. Fixing that needs a firewall rule
// that is Ubuntu-only, pointless on machines with no active firewall, and different again on macOS.
// A bind-mounted socket needs none of it and behaves identically on every OS.
//
// It also keeps `apiBase()` honest. That returns `http://127.0.0.1:<port>` and is what we TELL agents
// to call; inside a box that address is the container's own loopback. With a relay in the box mapping
// that port onto this socket, the address we advertise becomes true again rather than needing a
// second, container-aware spelling of it.
//
// THE DIRECTORY IS WHAT GETS MOUNTED, NEVER THE FILE. Bind-mounting the socket file pins an inode:
// measured, a server restart that recreates the socket leaves every live box holding a mount of the
// deleted one, failing `ECONNREFUSED` forever — which looks exactly like the server being down and
// would be diagnosed as anything but a mount. Mounting the directory makes recreation visible inside.
// The port this server listens on, and so the one the relay in every box must listen on too: agents are
// told `apiBase()`, and inside a box only the relay makes that address answer. One reader, because the
// relay's port was once left to its own default of 4610 while agents were told the configured one.
export function serverPort(): number {
  return Number(process.env.VIBEBOARD_PORT ?? 4610);
}

export function apiBase(): string {
  return `http://127.0.0.1:${serverPort()}`;
}

export function apiSocketDir(): string {
  return process.env.VIBEBOARD_API_SOCKET_DIR ?? join(homedir(), '.vibeboard', 'run');
}

export function apiSocketPath(): string {
  return join(apiSocketDir(), 'api.sock');
}

// Is something already serving on that path? A socket file left by a killed process is indistinguishable
// from a live one by `existsSync` alone, and binding over a live one would silently steal its address.
// So we ask the only authority: try to connect.
function inUse(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(path);
    const settle = (answer: boolean): void => {
      probe.destroy();
      resolve(answer);
    };
    probe.once('connect', () => settle(true));
    // ECONNREFUSED is the stale case: the file is there, nothing is behind it. ENOENT is the clean case.
    probe.once('error', () => settle(false));
  });
}

// THE PATH THIS PROCESS ACTUALLY BOUND, and `undefined` in a process that never got one.
//
// It exists because the cleanup below is destructive and used to aim at a computed path rather than at a
// possession. A second VibeBoard is REFUSED the bind and carries on running — deliberately, see the caller
// in `main.ts` — and then removed the first one's live socket on its way out. Measured 2026-08-31 while
// serving two builds side by side.
//
// The second symptom reported at the time is the same cause seen later: once the file is gone the live
// server still holds its bound-but-unlinked socket, so the NEXT start finds no file, has nothing to probe,
// and binds a fresh one at that path. Boxes mount the directory, so every agent then reaches whichever
// server bound last, while the first serves pages perfectly and nothing of its own can reach it. One
// possession check removes both.
let bound: string | undefined;

interface ApiSocket {
  path: string;
  close: () => Promise<void>;
}

// Synchronous, for the signal handlers: they end with `process.exit`, which does not wait for a promise,
// so an async close would leave the file behind on every ordinary Ctrl-C. A stale socket is not fatal —
// the next start probes it and unlinks it — but leaving one is how "it works on a fresh boot" happens.
export function removeApiSocketFile(): void {
  // Ours or nothing. `apiSocketPath()` would answer for a process that never bound it — and that process
  // is exactly the one that must not touch it.
  if (bound === undefined) return;
  try {
    unlinkSync(bound);
  } catch {
    /* already gone */
  }
  bound = undefined;
}

// A SECOND http server sharing Fastify's own request handler, rather than a relay process or a second
// app. `app.routing` is the same function the TCP listener dispatches through, so both surfaces are the
// same API by construction — there is no second wiring to drift, and no route can exist on one and not
// the other.
export async function listenOnApiSocket(app: FastifyInstance): Promise<ApiSocket> {
  const dir = apiSocketDir();
  const path = apiSocketPath();
  mkdirSync(dir, { recursive: true });

  if (existsSync(path)) {
    if (await inUse(path)) {
      throw new Error(`another VibeBoard is already serving on ${path}`);
    }
    unlinkSync(path);
  }

  const server: Server = createServer((req, res) => {
    app.routing(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  // 0600: the box runs as the same uid, so nothing wider is needed, and anything wider would hand the
  // API to every other user on the machine — the socket carries no authentication of its own, the
  // credential in the request does.
  chmodSync(path, 0o600);
  // Recorded only now, after the bind has succeeded: everything above this line can throw, and a process
  // that failed here owns nothing.
  bound = path;

  return {
    path,
    // No explicit unlink here: node's `net.Server` removes a unix socket path it bound when it closes.
    // Verified by planting the deletion — no test could tell the difference, which is the definition of
    // redundant code rather than of an untested path. `removeApiSocketFile` exists for the OTHER ending,
    // where `process.exit` runs before any close callback can.
    // Cleared as well as closed, so a signal arriving afterwards does not unlink a path that some other
    // server may have bound in between.
    //
    // NO TEST CONSTRAINS THIS LINE, and that is recorded rather than left for the next reader to rediscover:
    // deleting it leaves the suite green. In ONE process it is genuinely equivalent — after `close()` the
    // file is already gone, so a later `removeApiSocketFile` unlinks nothing whichever way `bound` reads.
    // What it protects against needs a SECOND process to bind that path between our close and our signal,
    // which is the same shape as the fault this module was fixed for and the same reason that one is
    // verified by a fresh module instance rather than by two servers in one process. Keep it: the cost is a
    // comparison, and the case it covers is the one that has already happened here once.
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          if (bound === path) bound = undefined;
          resolve();
        }),
      ),
  };
}
