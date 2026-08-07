import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adminToken, adminTokenFile, CredentialStore } from '../src/server/credentials.js';
import { tempDir } from './helpers.js';

const ADMIN = 'admin-token-for-tests';

describe('CredentialStore', () => {
  it('mints a credential that verifies, and stops verifying once the run settles', () => {
    const store = new CredentialStore(ADMIN);
    const cred = store.mintRun('work', 'run-1', '/p/A', 'E-001');

    expect(store.verify(cred.token)).toMatchObject({
      scope: 'work',
      run: 'run-1',
      project: '/p/A',
      card: 'E-001',
    });
    store.expireRun('run-1');
    expect(store.verify(cred.token)).toBeNull();
  });

  it('does not verify a token it never minted', () => {
    expect(new CredentialStore(ADMIN).verify('made-up')).toBeNull();
  });

  it('gives two runs different tokens', () => {
    // A shared token makes `card` scoping meaningless — every run could then edit every card,
    // and the per-card check in the auth layer would be checking a value it cannot trust.
    const store = new CredentialStore(ADMIN);
    expect(store.mintRun('work', 'run-a').token).not.toBe(store.mintRun('work', 'run-b').token);
  });

  // Two runs, not one: expiring the only credential in the store and clearing the whole store
  // produce the same observable result, so a single-run fixture would test neither.
  it('expires only the run that settled', () => {
    const store = new CredentialStore(ADMIN);
    const a = store.mintRun('work', 'run-a', '/p/A', 'E-001');
    const b = store.mintRun('checkup', 'run-b', '/p/A', 'E-002');

    store.expireRun('run-a');

    expect(store.verify(a.token)).toBeNull();
    expect(store.verify(b.token)).toMatchObject({ scope: 'checkup', run: 'run-b' });
  });

  // A store built with an empty admin token must not turn every credential-less request into an
  // admin one. The file side of this hazard was guarded; the store side was not.
  it('never treats an empty token as the admin token', () => {
    const store = new CredentialStore('');
    expect(store.verify('')).toBeNull();
    expect(store.verify('anything')).toBeNull();
  });

  it('verifies the admin token as admin, carrying no run or card', () => {
    const cred = new CredentialStore(ADMIN).verify(ADMIN);
    expect(cred).toEqual({ token: ADMIN, scope: 'admin' });
  });

  // The browser's credential is not a run's, so nothing a run settles may take it away.
  it('does not expire the admin token when a run settles', () => {
    const store = new CredentialStore(ADMIN);
    store.mintRun('service', 'run-1');
    store.expireRun('run-1');
    expect(store.verify(ADMIN)?.scope).toBe('admin');
  });
});

// A signed-in browser is a person, so its credential is `admin` exactly like the token file's —
// decision 10's scope table confines RUNS, and there is no lesser authority for a person to hold.
// What is new is `device`, which is how a revoke finds the socket that credential opened.
describe('a signed-in device', () => {
  const authority = (accepts: Record<string, string>) => {
    const touched: string[] = [];
    return {
      touched,
      verify: (token: string) => accepts[token] ?? null,
      touch: async (id: string) => {
        touched.push(id);
      },
    };
  };

  it('verifies as admin and says which device it is', () => {
    const devices = authority({ 'dev_1.secret': 'dev_1' });
    const store = new CredentialStore(ADMIN, devices);

    expect(store.verify('dev_1.secret')).toEqual({ token: 'dev_1.secret', scope: 'admin', device: 'dev_1' });
  });

  it('records that the device was seen', () => {
    const devices = authority({ 'dev_1.secret': 'dev_1' });
    new CredentialStore(ADMIN, devices).verify('dev_1.secret');
    expect(devices.touched).toEqual(['dev_1']);
  });

  it('refuses a token the device authority does not know, and does not touch anything', () => {
    const devices = authority({ 'dev_1.secret': 'dev_1' });
    const store = new CredentialStore(ADMIN, devices);
    expect(store.verify('dev_1.wrong')).toBeNull();
    expect(devices.touched).toEqual([]);
  });

  // The revoke path: the authority stops accepting the token, and the credential store must not have
  // cached anything of its own. A cached device credential is a revoke that takes effect on restart.
  it('stops verifying as soon as the authority stops accepting it', () => {
    const accepts: Record<string, string> = { 'dev_1.secret': 'dev_1' };
    const store = new CredentialStore(ADMIN, { verify: (t) => accepts[t] ?? null, touch: async () => {} });
    expect(store.verify('dev_1.secret')?.device).toBe('dev_1');

    delete accepts['dev_1.secret'];

    expect(store.verify('dev_1.secret')).toBeNull();
  });

  it('is never consulted for the admin token or for a run credential', () => {
    // Order matters for cost, not correctness — but a device authority asked on every run request
    // would be a disk-backed lookup on the hottest path in the server.
    let asked = 0;
    const store = new CredentialStore(ADMIN, {
      verify: () => {
        asked += 1;
        return null;
      },
      touch: async () => {},
    });
    const run = store.mintRun('work', 'run-1');

    expect(store.verify(ADMIN)?.scope).toBe('admin');
    expect(store.verify(run.token)?.scope).toBe('work');

    expect(asked).toBe(0);
  });

  it('still refuses an empty token with a device authority present', () => {
    const store = new CredentialStore('', { verify: () => 'dev_1', touch: async () => {} });
    expect(store.verify('')).toBeNull();
  });
});

// The admin comparison hashes both sides before timing them. Not for the timing alone: comparing raw
// tokens would make timingSafeEqual throw on any length mismatch, and that throw is a length oracle
// for the admin token — reachable by anyone who can send a string and time a 401 against a 500.
describe('the admin comparison', () => {
  it('accepts the exact token and rejects a prefix of it', () => {
    const store = new CredentialStore(ADMIN);
    expect(store.verify(ADMIN)?.scope).toBe('admin');
    expect(store.verify(ADMIN.slice(0, -1))).toBeNull();
  });

  it('does not throw on a token of a different length', () => {
    const store = new CredentialStore(ADMIN);
    expect(() => store.verify('x')).not.toThrow();
    expect(() => store.verify('x'.repeat(5000))).not.toThrow();
  });
});

describe('adminToken', () => {
  const original = process.env.VIBEBOARD_TOKEN_FILE;
  afterEach(() => {
    if (original === undefined) delete process.env.VIBEBOARD_TOKEN_FILE;
    else process.env.VIBEBOARD_TOKEN_FILE = original;
  });

  it('creates the file on first use and returns the same token afterwards', async () => {
    process.env.VIBEBOARD_TOKEN_FILE = join(await tempDir(), 'token');
    const first = await adminToken();
    expect(first).not.toBe('');
    expect((await readFile(adminTokenFile(), 'utf8')).trim()).toBe(first);
    // A token that changed per call would log the browser out on every restart.
    expect(await adminToken()).toBe(first);
  });

  it('creates the file readable only by its owner', async () => {
    // The whole point of keeping it here is that agents cannot read it. Mode 0644 would hand it
    // to any process on the machine, sandbox or not.
    process.env.VIBEBOARD_TOKEN_FILE = join(await tempDir(), 'token');
    await adminToken();
    expect((await stat(adminTokenFile())).mode & 0o777).toBe(0o600);
  });

  it('replaces an empty token file rather than returning an empty token', async () => {
    // An empty token would authenticate every request that sends no Authorization header at all.
    process.env.VIBEBOARD_TOKEN_FILE = join(await tempDir(), 'token');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(adminTokenFile(), '\n', 'utf8');
    expect(await adminToken()).not.toBe('');
  });
});
