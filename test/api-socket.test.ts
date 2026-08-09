import { existsSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiSocketPath, listenOnApiSocket, removeApiSocketFile } from '../src/server/api-socket.js';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/credentials.js';
import { ProjectSession } from '../src/server/session.js';
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

  it('removes the socket file on close, and removeApiSocketFile is safe when there is none', async () => {
    const socketPath = await serveOnSocket();
    expect(existsSync(socketPath)).toBe(true);
    await opened.splice(0)[0]?.();
    expect(existsSync(socketPath)).toBe(false);
    expect(() => removeApiSocketFile()).not.toThrow();
  });
});
