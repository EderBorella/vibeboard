import { readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boxMounts } from '../src/server/containers.js';
import { adminTokenFile } from '../src/server/credentials.js';
import { DeviceStore, deviceFile, deviceLabel } from '../src/server/devices.js';
import { tempDir } from './helpers.js';

// One credential per browser, so the approval prompt can name which one is asking and a Revoke can
// sign out the phone without signing out the laptop. Neither is expressible with a single token.

let file = '';
let day = '2026-08-07';
const clock = (): Date => new Date(`${day}T09:00:00.000Z`);

beforeEach(async () => {
  file = join(await tempDir(), 'token-devices.json');
  day = '2026-08-07';
});

const open = (): Promise<DeviceStore> => DeviceStore.load({ file, now: clock });

describe('an empty store', () => {
  it('reads a missing file as empty, with nothing to report', async () => {
    // The ordinary state of a fresh install, and the whole authority behind the silent first claim:
    // if this ever read as non-empty, nobody could sign in without an approval nobody could give.
    const store = await open();
    expect(store.empty).toBe(true);
    expect(store.problem).toBeUndefined();
    expect(store.list()).toEqual([]);
  });

  it('verifies nothing', async () => {
    const store = await open();
    expect(store.verify('dev_abcdef0123.whatever')).toBeNull();
  });
});

describe('adding a device', () => {
  it('hands back a credential that verifies, exactly once and only itself', async () => {
    const store = await open();
    const first = await store.add('Firefox on the laptop', '192.168.0.16');
    const second = await store.add('Safari on the phone', '192.168.0.31');

    expect(store.verify(first.token)).toBe(first.id);
    expect(store.verify(second.token)).toBe(second.id);
    expect(first.token).not.toBe(second.token);
    expect(store.empty).toBe(false);
    expect(store.size).toBe(2);
  });

  it('refuses a wrong secret, an unknown id, and a token that is not a token', async () => {
    const store = await open();
    const { id, token } = await store.add('Firefox', '127.0.0.1');
    const secret = token.slice(token.indexOf('.') + 1);

    expect(store.verify(`${id}.wrong`)).toBeNull();
    expect(store.verify(`dev_0000000000.${secret}`)).toBeNull();
    expect(store.verify(secret)).toBeNull(); // no id half at all
    expect(store.verify(`.${secret}`)).toBeNull(); // empty id half
    expect(store.verify('')).toBeNull();
  });

  it('shows the label and address it was given, and never the hash', async () => {
    const store = await open();
    await store.add('Firefox on the laptop', '192.168.0.16');
    expect(store.list()).toEqual([
      {
        id: expect.stringMatching(/^dev_[0-9a-f]{10}$/),
        label: 'Firefox on the laptop',
        address: '192.168.0.16',
        created: '2026-08-07T09:00:00.000Z',
        lastSeen: '2026-08-07',
      },
    ]);
    // Restated as its own assertion because `toEqual` above would still pass if a `hash` key were
    // added to the view and the fixture updated with it.
    expect(Object.keys(store.list()[0])).not.toContain('hash');
  });
});

describe('what reaches the disk', () => {
  // The difference between this file and ~/.vibeboard/token: that one IS the credential, so reading
  // it is admin. Replaying anything out of this one authenticates nothing — which is what protects a
  // machine with no AppArmor profile, where file permissions are the only barrier left.
  it('writes a hash and not the secret', async () => {
    const store = await open();
    const { token } = await store.add('Firefox', '127.0.0.1');
    const secret = token.slice(token.indexOf('.') + 1);

    const content = await readFile(file, 'utf8');

    expect(content).not.toContain(secret);
    expect(content).not.toContain(token);
    expect(JSON.parse(content).devices[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes it 0600', async () => {
    const store = await open();
    await store.add('Firefox', '127.0.0.1');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('is read back by the next server, so a device survives a restart', async () => {
    const store = await open();
    const { id, token } = await store.add('Firefox', '127.0.0.1');

    const reopened = await open();

    expect(reopened.verify(token)).toBe(id);
    expect(reopened.empty).toBe(false);
  });
});

describe('revoking', () => {
  it('signs that device out and leaves the others alone', async () => {
    const store = await open();
    const gone = await store.add('Phone', '192.168.0.31');
    const kept = await store.add('Laptop', '192.168.0.16');

    expect(await store.revoke(gone.id)).toBe(true);

    expect(store.verify(gone.token)).toBeNull();
    expect(store.verify(kept.token)).toBe(kept.id);
    expect((await open()).verify(gone.token)).toBeNull(); // and it stayed revoked on disk
  });

  it('answers false for a device it does not have', async () => {
    const store = await open();
    expect(await store.revoke('dev_0000000000')).toBe(false);
  });

  // "Sign everything out" and the SIGUSR2 break-glass are the same call, and emptying the store is
  // what re-opens the silent claim — which is how the user regenerates without a restart or a command.
  it('clearing signs everyone out and re-opens the first-visit claim', async () => {
    const store = await open();
    const a = await store.add('Phone', '192.168.0.31');
    const b = await store.add('Laptop', '192.168.0.16');

    await store.clear();

    expect(store.empty).toBe(true);
    expect(store.verify(a.token)).toBeNull();
    expect(store.verify(b.token)).toBeNull();
    expect((await open()).empty).toBe(true);
  });
});

describe('last seen', () => {
  it('records the day, not the moment', async () => {
    const store = await open();
    const { id } = await store.add('Firefox', '127.0.0.1');
    day = '2026-08-09';

    await store.touch(id);

    expect(store.list()[0].lastSeen).toBe('2026-08-09');
  });

  // Proved by deleting the file: a store that wrote on every touch would recreate it. An active
  // browser makes a request a second, and none of them should cost a disk write for a field whose
  // resolution is a day.
  it('does not write again on the same day', async () => {
    const store = await open();
    const { id } = await store.add('Firefox', '127.0.0.1');
    await store.touch(id); // same day as `add`
    const { rm } = await import('node:fs/promises');
    await rm(file);

    await store.touch(id);

    await expect(stat(file)).rejects.toThrow();
  });

  it('ignores a device that is not there', async () => {
    const store = await open();
    await expect(store.touch('dev_0000000000')).resolves.toBeUndefined();
  });
});

describe('a file that does not parse', () => {
  // FAIL CLOSED, and then say so. An empty store is what re-opens unauthenticated sign-in, so
  // arriving there by accident is the one transition that must never be silent — hence `problem`,
  // which app.ts logs. Falling through to "verify everything" instead would be the whole model gone.
  it('yields an empty store, moves the file aside, and reports where', async () => {
    await writeFile(file, 'this is not json', 'utf8');

    const store = await open();

    expect(store.empty).toBe(true);
    expect(store.problem).toContain('did not parse');
    expect(store.problem).toContain('.corrupt.');
    await expect(stat(file)).rejects.toThrow(); // moved, not left looking authoritative
    const aside = store.problem?.split(' moved to ')[1] ?? '';
    expect(await readFile(aside, 'utf8')).toBe('this is not json'); // evidence kept
  });

  it('rejects the whole file when one record is malformed', async () => {
    // Not "skip the bad one": a record kept with a missing or short hash is a device whose comparison
    // has undefined behaviour, and which of "authenticates nothing" or "authenticates everything" it
    // lands on depends on how the compare happens to be written.
    await writeFile(file, JSON.stringify({ devices: [{ id: 'dev_1', hash: 'short' }] }), 'utf8');
    const store = await open();
    expect(store.empty).toBe(true);
    expect(store.problem).toBeDefined();
  });

  it.each([
    ['no devices key', '{"other":[]}'],
    ['devices not an array', '{"devices":{}}'],
    ['null', 'null'],
    ['empty file', ''],
  ])('treats %s as unreadable rather than as an empty store', async (_name, content) => {
    await writeFile(file, content, 'utf8');
    const store = await open();
    expect(store.problem).toBeDefined();
  });

  it('an EMPTY device list is a valid store, not a corrupt one', async () => {
    // The shape `clear()` writes. If this reported a problem, every sign-everything-out would look
    // like corruption in the log from then on.
    await writeFile(file, JSON.stringify({ devices: [] }), 'utf8');
    const store = await open();
    expect(store.empty).toBe(true);
    expect(store.problem).toBeUndefined();
  });
});

describe('the label', () => {
  it.each([
    ['a plain User-Agent', 'Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (X11; Linux x86_64)'],
    ['nothing at all', undefined, 'Unknown browser'],
    ['an empty header', '', 'Unknown browser'],
    ['only whitespace', '   ', 'Unknown browser'],
  ])('renders %s as %s', (_name, input, expected) => {
    expect(deviceLabel(input as string | undefined)).toBe(expected);
  });

  it('strips control characters, which are what would forge a line where this is displayed', () => {
    expect(deviceLabel('Firefox\n\rAllow: yes\u0000')).toBe('Firefox Allow: yes');
    expect(deviceLabel('Firefox\u007fx')).toBe('Firefox x');
  });

  it('caps the length, because this is rendered in a prompt', () => {
    expect(deviceLabel('x'.repeat(200))).toHaveLength(60);
  });
});

describe('where the file lives', () => {
  const saved = process.env.VIBEBOARD_TOKEN_FILE;

  afterEach(() => {
    if (saved === undefined) delete process.env.VIBEBOARD_TOKEN_FILE;
    else process.env.VIBEBOARD_TOKEN_FILE = saved;
  });

  it('sits beside the admin token, so there is one path to relocate rather than two', () => {
    process.env.VIBEBOARD_TOKEN_FILE = '/somewhere/else/mytoken';
    expect(deviceFile()).toBe('/somewhere/else/token-devices.json');
  });

  // WHERE THE CREDENTIALS LIVE, AND WHY AN AGENT CANNOT REACH THEM.
  //
  // This used to be asserted against an AppArmor deny rule, because the file sat in a directory every
  // agent could otherwise read. Containment made the guarantee stronger and simpler: the box mounts
  // the project, a state directory, the API socket directory and at most one backend credential —
  // and nothing else on the disk exists inside it. So the claim is no longer "a rule denies this
  // path" but "this path is not in the container at all", which is what this checks.
  //
  // Derived from the real mount set rather than a literal, so adding a mount that happens to expose
  // `~/.vibeboard` fails here rather than silently handing every agent the admin credential.
  it('is not inside ANY of an agent box’s mounts — not denied, absent', () => {
    delete process.env.VIBEBOARD_TOKEN_FILE;
    const mounts = boxMounts({
      projectRoot: '/data/projects/demo',
      stateDir: join(homedir(), '.vibeboard', 'copilot', 'projects', 'abc'),
      socketDir: join(homedir(), '.vibeboard', 'run'),
      credential: { source: join(homedir(), '.claude', '.credentials.json'), target: '/x' },
      readOnly: ['.vibeboard'],
    });

    const inside = (path: string): boolean =>
      mounts.some((m) => path === m.source || path.startsWith(`${m.source}/`));

    expect(inside(adminTokenFile())).toBe(false);
    expect(inside(deviceFile())).toBe(false);
    // The negative case, or `inside` could be answering false to everything.
    expect(inside('/data/projects/demo/src/index.ts')).toBe(true);
  });
});
