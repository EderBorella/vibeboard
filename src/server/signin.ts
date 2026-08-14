import { randomBytes } from 'node:crypto';
import type { AutopilotStateName } from '../core/autopilot-state.js';
import { deviceLabel } from './devices.js';

// Sign-in's bookkeeping: who has asked to be let in, and what happened to each request.
//
// WHERE THE AUTHORITY COMES FROM. The browser needs TCP and an agent can always reach TCP loopback
// (decision 21), so nothing about the connection itself distinguishes them — and no header does
// either, since `curl -H 'User-Agent: …'` reproduces every one a browser sends. That leaves exactly
// two things an agent cannot do:
//
//   1. BE FIRST. Before any browser has signed in, no agent can exist, because dispatching one needs
//      a credential nobody holds yet. That is `POST /auth/claim`, and it is open only while the
//      device store is empty.
//   2. BE APPROVED BY A BROWSER THAT IS ALREADY IN. That is this file: a request goes on a list, the
//      list is pushed to every signed-in browser, and a person clicks Allow.
//
// Neither asks the user to see, copy or type a secret, which is the whole point.
//
// THE ATTACK ON PATH 2 IS NOT GUESSING — request ids are 32 random bytes. It is PROMPT FATIGUE: a
// process that can raise a dialog on your screen as often as it likes eventually catches an
// absent-minded Allow. Everything below that looks like a limit is aimed at that: at most three
// outstanding, a hard rate limit, and a TTL. The rest of the mitigation is in the UI — the prompt
// names the address as well as the label, Refuse is the primary action, and Enter does not allow.
// And the route refuses to open a request at all while any agent is running, which is when an agent
// asking would otherwise be least surprising.

export const REQUEST_TTL_MS = 120_000;
export const MAX_OUTSTANDING = 3;
// One request per ten seconds and ten an hour, counted for the whole server rather than per address:
// on loopback every caller shares one address, so a per-address limit would be no limit at all.
//
// The cost is real and accepted: an agent burning the budget can delay the user's own sign-in for an
// hour. It cannot gain anything by it, the SIGUSR2 break-glass is unaffected, and the alternative is
// a limit that does not limit.
export const MIN_GAP_MS = 10_000;
export const MAX_PER_HOUR = 10;
const HOUR_MS = 3_600_000;

type RequestState = 'pending' | 'approved' | 'refused';

interface Pending {
  id: string;
  label: string;
  address: string;
  at: string;
  expires: number;
  state: RequestState;
  // Set once approved. Handed over exactly once, by `collect`.
  token?: string;
  // True between "approve was called" and "the credential exists". Set synchronously, so two
  // approvals of one request cannot both get past it and mint two devices for one browser.
  minting?: true;
}

// What a signed-in browser is shown. No token, ever: this list is broadcast to every open socket.
interface PendingView {
  id: string;
  label: string;
  address: string;
  at: string;
}

// The label and address come back with the id so the WAITING browser can show what the person
// deciding will see. Without it the user is asked to match a prompt against nothing.
type OpenResult = { id: string; label: string; address: string } | 'too-many' | 'rate-limited';

type CollectResult =
  | { state: 'pending' }
  | { state: 'refused' }
  | { state: 'approved'; token: string }
  // Never opened, already collected, or timed out. One answer for all three deliberately: the browser
  // does the same thing in each case — ask again — and telling a caller which of the three it was
  // would confirm that an id it guessed once existed.
  | { state: 'expired' };

interface PendingOptions {
  // Mints the credential. Injected rather than reached for, so this class does no crypto and no IO
  // and its state machine can be tested without a device store on disk.
  mint: (label: string, address: string) => Promise<string>;
  now?: () => Date;
  ttlMs?: number;
  max?: number;
  // Fired whenever the outstanding list changes, so the routes can push it to signed-in browsers.
  onChange?: () => void;
}

export class PendingRequests {
  readonly #byId = new Map<string, Pending>();
  // When each request was opened, for the rate limit. Trimmed to the last hour on every check.
  #opened: number[] = [];
  readonly #opts: Required<Omit<PendingOptions, 'onChange'>> & Pick<PendingOptions, 'onChange'>;

  constructor(opts: PendingOptions) {
    this.#opts = {
      mint: opts.mint,
      now: opts.now ?? (() => new Date()),
      ttlMs: opts.ttlMs ?? REQUEST_TTL_MS,
      max: opts.max ?? MAX_OUTSTANDING,
      ...(opts.onChange ? { onChange: opts.onChange } : {}),
    };
  }

  #ms(): number {
    return this.#opts.now().getTime();
  }

  // Swept on every entry point rather than on a timer: a timer would be one more thing to stop on
  // shutdown, and there is no path into this class that does not start by asking what is still live.
  #sweep(): void {
    const ms = this.#ms();
    for (const [id, p] of this.#byId) if (p.expires <= ms) this.#byId.delete(id);
  }

  open(userAgent: string | undefined, address: string): OpenResult {
    this.#sweep();
    const ms = this.#ms();
    this.#opened = this.#opened.filter((t) => t > ms - HOUR_MS);
    // The gap first: it is the one that answers a burst, and answering the burst is the point.
    const last = this.#opened.at(-1);
    if ((last !== undefined && ms - last < MIN_GAP_MS) || this.#opened.length >= MAX_PER_HOUR) {
      return 'rate-limited';
    }
    if (this.#pending().length >= this.#opts.max) return 'too-many';
    // 32 bytes, so an id cannot be guessed: guessing one would let a second caller collect the token
    // a person approved for the first.
    const id = randomBytes(32).toString('base64url');
    const label = deviceLabel(userAgent);
    this.#byId.set(id, {
      id,
      label,
      address,
      at: this.#opts.now().toISOString(),
      expires: ms + this.#opts.ttlMs,
      state: 'pending',
    });
    this.#opened.push(ms);
    this.#opts.onChange?.();
    return { id, label, address };
  }

  #pending(): Pending[] {
    return [...this.#byId.values()].filter((p) => p.state === 'pending');
  }

  list(): PendingView[] {
    this.#sweep();
    return this.#pending().map(({ id, label, address, at }) => ({ id, label, address, at }));
  }

  // 'unknown' covers expired as well as never-existed, and both mean the prompt a person just clicked
  // is stale — which the UI has to say, because otherwise Allow appears to have done nothing.
  async approve(id: string): Promise<'ok' | 'unknown'> {
    this.#sweep();
    const p = this.#byId.get(id);
    if (p?.state !== 'pending' || p.minting) return 'unknown';
    // Set BEFORE the await. Two clicks on one prompt would otherwise both mint, and the second device
    // would exist with nobody holding its credential — a phantom row in the device list forever.
    p.minting = true;
    let token: string;
    try {
      token = await this.#opts.mint(p.label, p.address);
    } catch (err) {
      delete p.minting;
      throw err;
    }
    // Re-checked after the await: the request may have been refused or swept while the credential was
    // being written, and handing over a token for a request that no longer exists would be the one
    // way an approval could outlive its own refusal.
    if (this.#byId.get(id) !== p || p.state !== 'pending') return 'unknown';
    delete p.minting;
    p.state = 'approved';
    p.token = token;
    this.#opts.onChange?.();
    return 'ok';
  }

  refuse(id: string): boolean {
    this.#sweep();
    const p = this.#byId.get(id);
    if (p?.state !== 'pending') return false;
    p.state = 'refused';
    this.#opts.onChange?.();
    return true;
  }

  // SINGLE SHOT for the approved case: the token is deleted as it is handed over, so a second caller
  // polling the same id gets nothing. A refusal is left until it expires instead, so the browser that
  // was refused keeps being told why rather than flipping to "ask again" on its next poll.
  collect(id: string): CollectResult {
    this.#sweep();
    const p = this.#byId.get(id);
    if (!p) return { state: 'expired' };
    if (p.state === 'refused') return { state: 'refused' };
    if (p.state === 'pending' || !p.token) return { state: 'pending' };
    const token = p.token;
    this.#byId.delete(id);
    return { state: 'approved', token };
  }
}

// Why sign-in is closed, or null when it is open. One sentence, because it is rendered verbatim on the
// sign-in screen — a screen that says only "refused" is the bug this whole feature exists to fix.
//
// Refused while agents are running, and that is the user's ruling. The reason it is not merely tidy:
// an agent is the one caller that could plausibly be behind an unexpected request, and while runs are
// in flight a prompt appearing is least surprising and most likely to be waved through.
export function signinClosed(activity: { runs: number; autopilot: AutopilotStateName }): string | null {
  if (activity.autopilot === 'running') {
    return 'Auto-pilot is running on this project, so signing in a new browser is closed until it stops.';
  }
  if (activity.runs > 0) {
    const s = activity.runs === 1 ? '' : 's';
    return `${activity.runs} agent${s} ${activity.runs === 1 ? 'is' : 'are'} running on this project, so signing in a new browser is closed until they finish.`;
  }
  return null;
}
