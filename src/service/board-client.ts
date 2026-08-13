import type { DiaryKind } from '../core/diary.js';
import type { RunRecord } from '../core/runs.js';
import type { BoardName, Card, ProjectConfig } from '../core/types.js';
import type { Verification } from '../core/verify.js';
import type { Accounting } from '../server/routes/autopilot.js';

// The loop's whole view of the board, and it is the SAME HTTP surface an agent uses. Decision 20: the
// service consumes the existing server rather than reaching into the project itself, so every write it
// makes goes through the same validation, the same mutation layer and the same scope table as everything
// else. The one carve-out is `autopilot-state.json`, which the loop reads and writes directly — the
// counters are its own, and routing an integer through HTTP on every tick would be chatty for no gain.
//
// NOTHING HERE THROWS. The caller is a loop; an exception would end the run rather than the request. Every
// call answers with a result that says whether it worked and, when it did not, whether carrying on makes
// any sense — a 401 means this loop's authority is gone and no amount of retrying will bring it back,
// while a connection refused means the server is restarting and the next tick may well succeed.

export interface Ok<T> {
  ok: true;
  value: T;
}
export interface Failed {
  ok: false;
  reason: string;
  // Whether to give up rather than try again. TRUE for 401 and 403: the credential has been revoked or
  // the loop has no authority in this state, and both are decisions the server has made about this loop
  // rather than transient conditions. A service that spun on those would be a service ignoring a stop.
  fatal: boolean;
}
export type Answer<T> = Ok<T> | Failed;

export interface BoardView {
  config: ProjectConfig;
  boards: Record<BoardName, Card[]>;
  // Whatever the server could not parse. Carried deliberately and never optional: the setup barrier is
  // unknowable while any card will not parse, and an absent list reads as "nothing wrong" — the fail-open
  // default the barrier exists to prevent.
  problems: { path: string; reason: string }[];
}

export interface DiaryDetails {
  iteration?: number;
  card?: string;
  board?: BoardName;
  skill?: string;
  outcome?: string;
}

export interface DispatchRequest {
  // The card this run is about — both fields, or neither with `project: true`. A run about the PROJECT has no
  // card: the bootstrap derives the board from the README, so the card it would be dispatched against is the
  // thing it exists to create (see `bootstrapSkill` in core/autopilot.ts).
  board?: BoardName;
  card?: string;
  project?: true;
  skill: string;
  // The run this one follows: for a judging run, the run it is judging. Without it the judge was told to
  // score "work that is already done" and had to guess which — and on the first hand-run it guessed the
  // previous, successful run and passed a card whose actual run had died (run-prompt.ts).
  previous?: string;
  // WHAT THE LOOP ALREADY ESTABLISHED before dispatching a review: that the gates it ran in its own process
  // passed, and whether this card is in the setup subtree, where an absent gate set is expected.
  //
  // The first hop of the carrier chain — `DispatchRequest` → `DispatchBody` → `DispatchInput` →
  // `PromptInputs` — and refused from every scope but this one at the far end (ruling 63): a review agent
  // able to send `gatesPassed: true` could talk its own reviewer into a pass.
  review?: { gatesPassed: boolean; setupSubtree: boolean };
}

export interface ClientOptions {
  apiBase: string;
  token: string;
  // Injected so a test can point the loop at a real app instance without a listening socket, and so a
  // failure mode can be produced deliberately. Defaults to the platform's.
  fetch?: typeof globalThis.fetch;
}

const AUTH_FAILURES = [401, 403];

export class BoardClient {
  #base: string;
  #token: string;
  #fetch: typeof globalThis.fetch;

  constructor(opts: ClientOptions) {
    this.#base = opts.apiBase.replace(/\/$/, '');
    this.#token = opts.token;
    this.#fetch = opts.fetch ?? globalThis.fetch;
  }

  async #call<T>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#base}/api${path}`, {
        method,
        headers: {
          // On EVERY request, not just the writes. A read the loop cannot make is a tick it cannot take.
          authorization: `Bearer ${this.#token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      // No response at all: the server is down, restarting, or the address is wrong. Worth another tick.
      return {
        ok: false,
        reason: `${method} ${path} could not reach the board: ${String(err)}`,
        fatal: false,
      };
    }
    if (!res.ok) {
      const said = await this.#problem(res);
      return {
        ok: false,
        reason: `${method} ${path} was refused with ${res.status}: ${said}`,
        fatal: AUTH_FAILURES.includes(res.status),
      };
    }
    try {
      return { ok: true, value: (await res.json()) as T };
    } catch (err) {
      return {
        ok: false,
        reason: `${method} ${path} answered with something that is not JSON: ${String(err)}`,
        fatal: false,
      };
    }
  }

  // The server's own sentence where there is one. A refusal reported as its status code alone is a refusal
  // the diary cannot explain, and the diary is what a person reads afterwards.
  async #problem(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: unknown };
      return typeof body.error === 'string' ? body.error : res.statusText;
    } catch {
      return res.statusText;
    }
  }

  // The board, its config and whatever would not parse — one call, because they are one consistent read.
  // Asking for them separately would let the config describe a board the cards no longer match.
  async board(): Promise<Answer<BoardView>> {
    const answer = await this.#call<{ open: boolean; snapshot?: BoardView }>('GET', '/state');
    if (!answer.ok) return answer;
    const snapshot = answer.value.snapshot;
    if (!answer.value.open || !snapshot) {
      // Not transient and not the loop's fault: the project it was started for is no longer open, and
      // every credential check compares against the OPEN project, so nothing it does next can work.
      return { ok: false, reason: 'The project this loop was started for is no longer open.', fatal: true };
    }
    return { ok: true, value: snapshot };
  }

  runs(): Promise<Answer<{ runs: RunRecord[] }>> {
    return this.#call('GET', '/runs');
  }

  accounting(): Promise<Answer<Accounting>> {
    return this.#call('GET', '/accounting');
  }

  dispatch(input: DispatchRequest): Promise<Answer<{ run: RunRecord }>> {
    return this.#call('POST', '/runs', input);
  }

  // One card's runs, which is how the loop watches a dispatch settle: there is no per-RUN route, and
  // adding one would be a second way to read a fact the card route already carries.
  cardRuns(board: BoardName, card: string): Promise<Answer<{ runs: RunRecord[] }>> {
    return this.#call('GET', `/runs/${board}/${card}`);
  }

  move(board: BoardName, card: string, toColumnSlug: string): Promise<Answer<unknown>> {
    return this.#call('POST', `/cards/${board}/${card}/move`, { toColumnSlug });
  }

  // The verdict on a run, onto the record of the run it judged (decision 18). Through an endpoint rather than
  // by writing the file: decision 10 makes endpoints the only write path, and the loop having a second way in
  // would be the exception that swallows the rule — unlike the state file, whose counters are genuinely the
  // loop's own.
  verdict(board: BoardName, card: string, run: string, verification: Verification): Promise<Answer<unknown>> {
    return this.#call('POST', `/runs/${board}/${card}/${run}/verification`, verification);
  }

  // A diary entry, prose AND the fields the checkup reads. `DiaryEntry` carries `iteration`, `card`, `board`,
  // `skill` and `outcome` so its one reader does not have to regex a sentence — and this signature used to
  // accept only `(kind, text)`, so none of them was ever written by anything.
  log(kind: DiaryKind, text: string, details: DiaryDetails = {}): Promise<Answer<unknown>> {
    return this.#call('POST', '/log', { kind, text, ...details });
  }

  // How the loop says why it stopped. THROUGH THE SERVER, not by writing the state file: decision 20 gives
  // `state`/`reason`/`detail` to the server, and going through it is also what makes the overlay appear in
  // every open tab and the loop's credential get revoked — both of which a direct file write silently skips.
  stopped(reason: string, detail?: string): Promise<Answer<unknown>> {
    return this.#call('POST', '/autopilot/stopped', { reason, ...(detail === undefined ? {} : { detail }) });
  }
}
