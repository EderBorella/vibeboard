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
