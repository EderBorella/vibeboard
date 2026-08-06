import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BoardName } from '../core/types.js';

// Who a request is allowed to be. Widening order, and each scope is a superset of the one before:
// `work` is what an ordinary skill run gets, `checkup` adds the board surgery a health check needs,
// `service` adds dispatching and the diary, and `admin` is the browser. A run is never admin —
// dispatching runs from inside a run escapes the loop's iteration counter, budget and concurrency
// cap in one move.
export type Scope = 'work' | 'checkup' | 'service' | 'admin';

export interface Credential {
  token: string;
  scope: Scope;
  // The run this credential was minted for, the project it was minted against, and the one card a
  // `work` scope may edit. All absent for admin: the browser is a person, not a run, and is
  // confined to neither a card nor whichever project happens to be open.
  //
  // `project` is not decoration. Card ids are unique within a project, not across them, and every
  // project has an E-001 — so a credential checked on the id alone still matched after the user
  // opened a different project under a live run, and edited the wrong project's card.
  run?: string;
  project?: string;
  card?: string;
  // WHAT DISPATCHED THIS RUN: the board its card is on, and the skill it was given. Carried here so the
  // endpoints can enforce where a run may create a card without going and reading its run record — the
  // credential is already the place the server states what it knows about a caller, and stamping from it is
  // how `POST /api/runs` and the suggestion store already work.
  //
  // Absent for admin (a person is not a run) and for the service credential, which belongs to no card.
  board?: BoardName;
  skill?: string;
}

export function adminTokenFile(): string {
  return process.env.VIBEBOARD_TOKEN_FILE ?? join(homedir(), '.vibeboard', 'token');
}

// Read the browser's token, creating it on first use. Deliberately outside every project tree,
// because a token stored inside the project is readable by anything that can read a card — which is
// every agent, by design.
//
// Being outside is necessary, not sufficient: what denies an agent read access is the AppArmor
// profile (`tools/apparmor/vibeboard-agent`), and only where it is installed. Without it — a Mac,
// or a Linux box that has not run `npm run sandbox:install` — the separation this file describes is
// a plan rather than a protection, which is why auto-pilot refuses to start there.
//
// VIBEBOARD_TOKEN_FILE moves the token somewhere the profile has never heard of, and nothing
// detects that: `probeSandbox` still answers "ok". If you relocate it, deny the new path too.
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

  mintRun(
    scope: Exclude<Scope, 'admin'>,
    run: string,
    project?: string,
    card?: string,
    // An object rather than two more positionals: five was already the limit of what reads at a call site,
    // and only the dispatcher has these to give.
    dispatched?: { board: BoardName; skill: string },
  ): Credential {
    const cred: Credential = { token: randomUUID(), scope, run, project, card, ...dispatched };
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

  // Everything held by one scope. Exists for the auto-pilot service, whose credential belongs to no run
  // record and therefore never settled — so nothing revoked it, and it stayed valid for the life of the
  // server across a soft stop, a restart, and (because authority is compared against the OPEN project) it
  // came back to life when the original project was reopened. Called from every path that takes the loop's
  // authority away, so the token cannot outlive the state that justifies it.
  expireScope(scope: Scope): void {
    for (const [token, cred] of this.#byToken) {
      if (cred.scope === scope) this.#byToken.delete(token);
    }
  }
}
