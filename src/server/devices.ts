import { randomBytes } from 'node:crypto';
import { readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { adminTokenFile, constantTimeEqual, sha256Hex } from './credentials.js';
import { serialise, writeAtomic } from './write-queue.js';

// One credential per browser that has signed in.
//
// Per-device rather than one shared secret, because two things the user asked for are impossible
// without it: a prompt that says WHICH browser is asking to be let in, and a Revoke that signs out
// the phone without signing out the laptop. A single token can express neither — revoking it revokes
// everyone, which is the "sign everything out" button, not a per-device one.
//
// WHAT IS STORED IS A HASH, NOT THE CREDENTIAL. `~/.vibeboard/token` is the credential itself, so
// anything that can read that file is admin; here the file holds sha256 digests and replaying one
// authenticates nothing. That matters exactly where the AppArmor profile is absent — a Mac, or a
// Linux box that has never run `npm run sandbox:install` — because there the file permissions are the
// only thing between an agent and the board.
//
// sha256 rather than a KDF, deliberately: the secret is 256 bits of CSPRNG output, so there is no
// dictionary to run and nothing to slow down. A KDF here would cost a request's latency and buy
// nothing.
//
// And it must not be read as more than it is: an agent that can `ptrace` the unconfined server reads
// live secrets out of its memory whatever is on disk. This narrows the at-rest surface. It does not
// make the server's memory safe, and nothing in this file could.

export interface DeviceRecord {
  // A name, never a secret. It appears in the device list, in logs, and in the URL of the revoke
  // call, and none of that would be safe if holding it were worth anything.
  id: string;
  // sha256, hex, of the secret half. The secret itself is never written down anywhere.
  hash: string;
  // Taken from the User-Agent so the approval prompt can say what is asking. A LABEL and nothing
  // more: every header a browser sends is reproducible with one curl flag by a process on the same
  // machine, so this can never be authority.
  label: string;
  // The address it first signed in from, shown beside the label for the same reason.
  address: string;
  created: string;
  // Day granularity, so an active browser costs one write a day rather than one per request.
  lastSeen: string;
}

// What the browser is allowed to see. No `hash`: a digest on screen is a digest in a screenshot, and
// it tells the user nothing they can act on.
export interface DeviceView {
  id: string;
  label: string;
  address: string;
  created: string;
  lastSeen: string;
}

// Beside the admin token, so there is ONE path to relocate and one to deny rather than two.
//
// `token-`prefixed on purpose: `deny @{HOME}/.vibeboard/token* rwl` in tools/apparmor/vibeboard-agent
// is the only read-denied rule in the profile, and it matches by that prefix. A file called
// `devices.json` would sit in the same folder, look just as private, and be readable by every agent.
// test/devices.test.ts asserts the match against the profile rather than trusting this paragraph.
export function deviceFile(): string {
  return join(dirname(adminTokenFile()), 'token-devices.json');
}

const ID_PREFIX = 'dev_';
const LABEL_MAX = 60;

// Control characters stripped and the length capped before anything stores this. It comes from a
// request header, and it is rendered in a prompt, printed in the device list, and written to a JSON
// file — a newline in it would let a caller forge extra lines wherever it is displayed as text.
export function deviceLabel(userAgent: string | undefined): string {
  const cleaned = (userAgent ?? '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Unknown browser';
  return cleaned.length > LABEL_MAX ? cleaned.slice(0, LABEL_MAX) : cleaned;
}

interface StoredFile {
  devices: DeviceRecord[];
}

function parse(content: string): DeviceRecord[] | 'unreadable' {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return 'unreadable';
  }
  const devices = (data as StoredFile | null)?.devices;
  if (!Array.isArray(devices)) return 'unreadable';
  // Every field checked, and a file with one bad record is rejected whole. Fail closed: a record
  // that survived with `hash: undefined` would be a device that authenticates nothing OR — worse,
  // depending on how the comparison were written — everything.
  for (const d of devices) {
    const ok =
      typeof d?.id === 'string' &&
      typeof d?.hash === 'string' &&
      d.hash.length === 64 &&
      typeof d?.label === 'string' &&
      typeof d?.address === 'string' &&
      typeof d?.created === 'string' &&
      typeof d?.lastSeen === 'string';
    if (!ok) return 'unreadable';
  }
  return devices as DeviceRecord[];
}

export interface DeviceStoreOptions {
  file?: string;
  now?: () => Date;
}

export class DeviceStore {
  readonly #byId = new Map<string, DeviceRecord>();
  readonly #file: string;
  readonly #now: () => Date;
  // Set when the file on disk could not be read as a device store, naming where it was moved. The
  // caller logs it: this class has no logger, and a corrupt credential file that nobody mentions is
  // a silent return to "anyone may claim", which is the one transition that must never be quiet.
  #problem: string | undefined;

  private constructor(file: string, now: () => Date) {
    this.#file = file;
    this.#now = now;
  }

  static async load(options: DeviceStoreOptions = {}): Promise<DeviceStore> {
    const file = options.file ?? deviceFile();
    const store = new DeviceStore(file, options.now ?? (() => new Date()));
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      return store; // absent, and absent is the ordinary state of a fresh install
    }
    const parsed = parse(content);
    if (parsed === 'unreadable') {
      // Moved aside rather than deleted, and rather than left in place. Left in place, every restart
      // would re-derive an empty store while a file that looks like the real one sits there; deleted,
      // the evidence of what happened is gone.
      const aside = `${file}.corrupt.${store.#now().toISOString().replace(/[:.]/g, '-')}`;
      await rename(file, aside).catch(() => rm(file, { force: true }).catch(() => {}));
      store.#problem = `${file} did not parse as a device store and was moved to ${aside}`;
      return store;
    }
    for (const d of parsed) store.#byId.set(d.id, d);
    return store;
  }

  get problem(): string | undefined {
    return this.#problem;
  }

  // What re-opens the silent claim. `empty` is the whole authority behind first-visit sign-in, so it
  // is deliberately the plainest possible question: has any browser ever signed in here?
  get empty(): boolean {
    return this.#byId.size === 0;
  }

  get size(): number {
    return this.#byId.size;
  }

  list(): DeviceView[] {
    return [...this.#byId.values()]
      .map(({ id, label, address, created, lastSeen }) => ({ id, label, address, created, lastSeen }))
      .sort((a, b) => a.created.localeCompare(b.created));
  }

  // Mints the credential and hands back the only copy that will ever exist. `${id}.${secret}` —
  // base64url for the secret half so it survives a WebSocket query parameter, which is the one place
  // the browser cannot send a header.
  async add(label: string, address: string): Promise<{ id: string; token: string }> {
    const at = this.#now().toISOString();
    let id = `${ID_PREFIX}${randomBytes(5).toString('hex')}`;
    while (this.#byId.has(id)) id = `${ID_PREFIX}${randomBytes(5).toString('hex')}`;
    const secret = randomBytes(32).toString('base64url');
    this.#byId.set(id, {
      id,
      hash: sha256Hex(secret),
      label: deviceLabel(label),
      address,
      created: at,
      lastSeen: at.slice(0, 10),
    });
    await this.#save();
    return { id, token: `${id}.${secret}` };
  }

  // O(1) by id, then one constant-time compare — no scan, so how long this takes says nothing about
  // how many devices exist. The id half is a lookup key and leaks nothing by being compared normally;
  // only the secret half is timed, through the shared compare in credentials.ts.
  verify(token: string): string | null {
    const split = token.indexOf('.');
    if (split <= 0) return null;
    const record = this.#byId.get(token.slice(0, split));
    if (!record) return null;
    return constantTimeEqual(record.hash, sha256Hex(token.slice(split + 1))) ? record.id : null;
  }

  // Never rejects, so a caller can `void store.touch(id)` on a hot path without an unhandled
  // rejection taking the process down for a field nobody reads urgently. Returns immediately when
  // the day has not changed, which is what keeps this from being a write per request.
  async touch(id: string): Promise<void> {
    const record = this.#byId.get(id);
    if (!record) return;
    const today = this.#now().toISOString().slice(0, 10);
    if (record.lastSeen === today) return;
    record.lastSeen = today;
    await this.#save().catch(() => {});
  }

  async revoke(id: string): Promise<boolean> {
    if (!this.#byId.delete(id)) return false;
    await this.#save();
    return true;
  }

  // Signs everything out, and by emptying the store it also re-opens the silent first claim — which
  // is what makes this the answer to "how do I regenerate", with no restart and no command.
  async clear(): Promise<void> {
    this.#byId.clear();
    await this.#save();
  }

  #save(): Promise<void> {
    const content = `${JSON.stringify({ devices: [...this.#byId.values()] }, null, 2)}\n`;
    return serialise(`devices:${this.#file}`, () => writeAtomic(this.#file, content, 0o600));
  }
}
