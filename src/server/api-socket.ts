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

export interface ApiSocket {
  path: string;
  close: () => Promise<void>;
}

// Synchronous, for the signal handlers: they end with `process.exit`, which does not wait for a promise,
// so an async close would leave the file behind on every ordinary Ctrl-C. A stale socket is not fatal —
// the next start probes it and unlinks it — but leaving one is how "it works on a fresh boot" happens.
export function removeApiSocketFile(): void {
  try {
    unlinkSync(apiSocketPath());
  } catch {
    /* never created, or already gone */
  }
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

  return {
    path,
    // No explicit unlink here: node's `net.Server` removes a unix socket path it bound when it closes.
    // Verified by planting the deletion — no test could tell the difference, which is the definition of
    // redundant code rather than of an untested path. `removeApiSocketFile` exists for the OTHER ending,
    // where `process.exit` runs before any close callback can.
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
