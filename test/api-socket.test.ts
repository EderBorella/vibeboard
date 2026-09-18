import { existsSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer, connect as netConnect } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { apiSocketPath, listenOnApiSocket, removeApiSocketFile } from '../src/server/boxes/api-socket.js';
import { tempDir } from './helpers.js';

// The socket is the ONLY way an agent in a container reaches this server, so these assert the two
// things that make it a transport rather than a hopeful one: it serves the same API the TCP listener
// serves, and it never binds over a server that is already live.

const opened: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of opened.splice(0)) await close();
  delete process.env.VIBEBOARD_API_SOCKET_DIR;
});

async function serveOnSocket(inDir?: string): Promise<string> {
  const dir = inDir ?? (await tempDir());
  process.env.VIBEBOARD_API_SOCKET_DIR = dir;
  const app = buildApp(new ProjectSession(), {
    credentials: new CredentialStore('test-admin'),
    logger: false,
  });
  await app.ready();
  const socket = await listenOnApiSocket(app);
  opened.push(async () => {
    await socket.close();
    await app.close();
  });
  return socket.path;
}

// Is anything actually listening there? `existsSync` cannot tell a live socket from a stale file, which
// is the same distinction `inUse` exists for in the module under test.
function connectable(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = netConnect(path);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => {
      probe.destroy();
      resolve(false);
    });
  });
}

// A raw request over the unix socket — the same thing the in-box relay does on the agent's behalf.
function overSocket(
  socketPath: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the API socket', () => {
  it('serves the same API as the TCP listener, and enforces the same auth', async () => {
    const socketPath = await serveOnSocket();

    const anonymous = await overSocket(socketPath, '/api/state');
    expect(anonymous.status).toBe(401);

    const authorised = await overSocket(socketPath, '/api/state', {
      authorization: 'Bearer test-admin',
    });
    expect(authorised.status).toBe(200);
    // Not just a 200: the body has to be the real payload, or a stub route would pass this.
    expect(JSON.parse(authorised.body)).toHaveProperty('open');
  });

  it('is owner-only, so no other user on the machine can reach the API through it', async () => {
    const socketPath = await serveOnSocket();
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
  });

  it('takes over a socket file left behind by a killed server', async () => {
    const dir = await tempDir();
    // A stale file, with nothing behind it — what a SIGKILL leaves. It must be the SAME directory the
    // server then binds in, or this asserts nothing: an earlier version of this test made a second temp
    // dir inside the helper and passed with the take-over deleted.
    writeFileSync(join(dir, 'api.sock'), '');

    const socketPath = await serveOnSocket(dir);
    expect(socketPath).toBe(join(dir, 'api.sock'));
    const res = await overSocket(socketPath, '/api/state');
    expect(res.status).toBe(401);
  });

  it('REFUSES to bind over a server that is still live, rather than stealing its address', async () => {
    const dir = await tempDir();
    process.env.VIBEBOARD_API_SOCKET_DIR = dir;
    const path = apiSocketPath();
    // Something already listening there — a second VibeBoard, started by mistake.
    const squatter = createServer();
    await new Promise<void>((resolve) => squatter.listen(path, resolve));

    const app = buildApp(new ProjectSession(), {
      credentials: new CredentialStore('test-admin'),
      logger: false,
    });
    await app.ready();
    await expect(listenOnApiSocket(app)).rejects.toThrow(/already serving/);
    await app.close();
    await new Promise<void>((resolve) => squatter.close(() => resolve()));
  });

  // THE SECOND INSTANCE MUST NOT REMOVE THE FIRST ONE'S SOCKET, and this is the whole of the fault: the
  // shutdown path unlinked `apiSocketPath()` unconditionally, including in a process that had been REFUSED
  // the bind seconds earlier. Recorded 2026-08-31 while serving two builds side by side.
  //
  // The second reported fault is the same cause wearing a later timestamp. Once the file is gone the live
  // server still holds its bound-but-unlinked socket, so the next start sees no file, probes nothing, and
  // binds a fresh one at that path — and every agent box, which mounts the DIRECTORY, then reaches whichever
  // server bound last, while the first serves pages perfectly and nothing of its own can reach it.
  //
  // A FRESH MODULE INSTANCE IS THE SECOND PROCESS. Ownership is per-process state, so two servers built in
  // ONE process share it and the second inherits the first's claim — which is not the production shape and
  // made the first version of this test fail against a correct fix. `vi.resetModules()` gives the second
  // instance the empty module state a second process actually starts with.
  it('does not remove a socket this process never bound', async () => {
    const dir = await tempDir();
    process.env.VIBEBOARD_API_SOCKET_DIR = dir;
    const path = join(dir, 'api.sock');

    // The first VibeBoard, in its own process — here, anything holding that address.
    const first = createServer();
    await new Promise<void>((resolve) => first.listen(path, resolve));

    vi.resetModules();
    const second = await import('../src/server/boxes/api-socket.js');
    const app = buildApp(new ProjectSession(), {
      credentials: new CredentialStore('test-admin'),
      logger: false,
    });
    await app.ready();
    await expect(second.listenOnApiSocket(app)).rejects.toThrow(/already serving/);
    // ...and it shuts down, running the same cleanup every signal handler runs.
    second.removeApiSocketFile();
    await app.close();

    expect(existsSync(path)).toBe(true);
    // Still answering, not merely still present: `existsSync` alone would pass over a fresh file bound by
    // somebody else, which is the failure this is really about.
    expect(await connectable(path)).toBe(true);
    await new Promise<void>((resolve) => first.close(() => resolve()));
  });

  it('removes the socket file on close, and removeApiSocketFile is safe when there is none', async () => {
    const socketPath = await serveOnSocket();
    expect(existsSync(socketPath)).toBe(true);
    await opened.splice(0)[0]?.();
    expect(existsSync(socketPath)).toBe(false);
    expect(() => removeApiSocketFile()).not.toThrow();
  });
});
