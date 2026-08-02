import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Who a request is allowed to be. Widening order, and each scope is a superset of the one before:
// `work` is what an ordinary skill run gets, `checkup` adds the board surgery a health check needs,
// `service` adds dispatching and the diary, and `admin` is the browser. A run is never admin —
// dispatching runs from inside a run escapes the loop's iteration counter, budget and concurrency
// cap in one move.
export type Scope = 'work' | 'checkup' | 'service' | 'admin';

export interface Credential {
  token: string;
  scope: Scope;
  // The run this credential was minted for, and the one card a `work` scope may edit. Both absent
  // for admin: the browser is a person, not a run, and is not confined to one card.
  run?: string;
  card?: string;
}

export function adminTokenFile(): string {
  return process.env.VIBEBOARD_TOKEN_FILE ?? join(homedir(), '.vibeboard', 'token');
}

// Read the browser's token, creating it on first use. Deliberately outside every project tree: the
// sandbox denies agents read access to `~/.vibeboard`, and a token stored inside the project would
// be readable by anything that can read a card — which is every agent, by design.
export async function adminToken(): Promise<string> {
  const file = adminTokenFile();
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    // An empty file is treated as absent. A token of '' would authenticate every request that
    // sends no credential at all.
    if (existing) return existing;
  } catch {
    /* absent — created below */
  }
  const token = randomUUID();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  // writeFile's mode applies only when it creates the file, and the umask can narrow it further.
  // Set it explicitly so an empty file left behind by an earlier version is tightened too.
  await chmod(file, 0o600);
  return token;
}

// Live credentials, in memory only. One store per server, not a module singleton: two apps in one
// test process would otherwise share credentials, and expiring a run in one would silently revoke
// the other's. Nothing survives a restart, which is the behaviour we want — a run cannot outlive
// the process that dispatched it.
export class CredentialStore {
  readonly #byToken = new Map<string, Credential>();

  constructor(private readonly admin: string) {}

  mintRun(scope: Exclude<Scope, 'admin'>, run: string, card?: string): Credential {
    const cred: Credential = { token: randomUUID(), scope, run, card };
    this.#byToken.set(cred.token, cred);
    return cred;
  }

  verify(token: string): Credential | null {
    if (token && token === this.admin) return { token, scope: 'admin' };
    return this.#byToken.get(token) ?? null;
  }

  // Called when a run settles. Scanned rather than indexed by run id: the map only ever holds the
  // handful of credentials belonging to in-flight runs, and a second index is a second place the
  // truth could drift out of step.
  expireRun(run: string): void {
    for (const [token, cred] of this.#byToken) {
      if (cred.run === run) this.#byToken.delete(token);
    }
  }
}
