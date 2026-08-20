import { backendDefaults, DEFAULT_BACKEND } from '../../core/backends.js';
import {
  type AgentTurnOptions,
  type Backend,
  type CopilotMode,
  type EffortLevel,
  type RunningTurn,
  runAgentTurn,
} from '../agent-turn.js';
import type { BoxService } from '../boxes/box-service.js';
import { fixedSandbox, type LiveSandbox, NOT_REQUESTED } from '../boxes/sandbox.js';
import type { CopilotEvent } from '../copilot-events.js';

// Re-exported so existing importers (copilot-turns.ts, the routes, the tests) keep their import
// path: these types describe the copilot channel, and agent-turn.ts is an implementation detail.
export type { Backend, CopilotMode, EffortLevel };

interface CopilotState {
  running: boolean;
  sessionId: string | undefined;
  model: string | undefined;
}

interface SendOptions {
  cwd: string;
  text: string;
  mode: CopilotMode;
  backend?: Backend; // default claude-code
  model?: string; // claude: alias/full name · opencode: provider/model
  effort?: EffortLevel; // claude: --effort scale · opencode: --variant scale
  onEvent: (event: CopilotEvent) => void;
}

// FIFTEEN MINUTES, up from three, and the old number was a guess about how long thinking takes.
//
// A reasoning model routinely spends minutes on one turn before its first token — three was already tight
// when the only cost was a chat message that gave up too early. It became the tightest bound in the system on
// 2026-08-17, when the HTTP layer's undeclared 300-second cap was removed: `postJson` no longer imposes one,
// so this timer is what actually ends a chat turn, and a run's own bound is thirty minutes.
//
// Still a bound rather than none: a turn that never ends holds the chat's single slot for ever, and the
// refusal it produces names the model and offers to try again. `VIBEBOARD_COPILOT_TIMEOUT_MS` overrides it.
function copilotTimeoutMs(): number {
  return Number(process.env.VIBEBOARD_COPILOT_TIMEOUT_MS ?? 900_000);
}

// The CHAT copilot: one turn at a time, resumed across turns by session id, run in the open
// project's directory so its file edits flow back through the board watcher.
//
// The one-at-a-time rule is this class's own, not the CLI's — a chat is a single conversation. Skill
// runs deliberately do not come through here; they call runAgentTurn directly, which is what lets
// several run at once without touching the chat's session.
export class CopilotSession {
  #sessionId: string | undefined;
  #model: string | undefined;
  #turn: RunningTurn | undefined;
  // The chat is an agent too, and it auto-approves its own tool calls — so it is confined on the
  // same terms as a run. Held on the session rather than passed per send: it is a fact about the
  // process, and threading it through every caller of `send` would invite one of them to forget.
  // The live probe, not a snapshot: this object is built once with the app and outlives any number of
  // Docker changes. Resolved where the turn is assembled, which is the last moment before the spawn.
  readonly #sandbox: LiveSandbox;
  readonly #boxes: BoxService | undefined;

  constructor(opts: { sandbox?: LiveSandbox; boxes?: BoxService } = {}) {
    this.#sandbox = opts.sandbox ?? fixedSandbox(NOT_REQUESTED);
    this.#boxes = opts.boxes;
  }

  get state(): CopilotState {
    return {
      running: this.#turn !== undefined,
      sessionId: this.#sessionId,
      model: this.#model,
    };
  }

  // Start a brand-new conversation on the next send (drops the resumable session id).
  newSession(): void {
    this.cancel();
    this.#sessionId = undefined;
    this.#model = undefined;
  }

  // Point the next send at a previous conversation (used when reopening a stored chat whose
  // backend matches the current one). No-op while a turn is in flight.
  resume(sessionId: string | undefined, model: string | undefined): void {
    if (this.#turn) return;
    this.#sessionId = sessionId;
    this.#model = model;
  }

  cancel(): void {
    this.#turn?.cancel();
    this.#turn = undefined;
  }

  async send(opts: SendOptions): Promise<void> {
    if (this.#turn) throw new Error('Copilot is busy');
    const backend: Backend = opts.backend ?? (DEFAULT_BACKEND as Backend);
    // Belt and braces, deliberately kept after resolveCopilotSelection landed: this guards a
    // caller that bypasses the route layer entirely (a raw WebSocket client, or an
    // unmigrated config), where nothing has resolved a default yet. Pinned by
    // test/copilot.test.ts ('spawns with a real model and effort when the caller names
    // neither') and test/opencode-variant.test.ts.
    const defaults = backendDefaults(backend);
    // Ensured before the turn, like a run's. The copilot SHARES the project's box with every run on
    // the same backend — S1: its rights are identical, only its credential differs — so this is
    // usually one `docker inspect` against a container that is already up.
    const box = this.#boxes ? (await this.#boxes.ensure(opts.cwd, backend)).name : undefined;
    const turnOptions: AgentTurnOptions = {
      cwd: opts.cwd,
      text: opts.text,
      mode: opts.mode,
      backend,
      model: opts.model || defaults.model,
      effort: opts.effort || defaults.effort,
      sessionId: this.#sessionId,
      timeoutMs: copilotTimeoutMs(),
      sandbox: await this.#sandbox(),
      ...(box ? { box } : {}),
      // The chat's own bookkeeping, kept here rather than in the shared turn: a skill run has no
      // session to remember, so watching for it is this class's concern alone.
      onEvent: (event) => {
        if (event.kind === 'init') {
          this.#sessionId = event.sessionId;
          this.#model = event.model;
        } else if (event.kind === 'result' && event.sessionId) {
          this.#sessionId = event.sessionId;
        }
        opts.onEvent(event);
      },
    };
    // OpenCode reports its model only on return, so state shows the requested one meanwhile.
    if (backend === 'opencode') this.#model = turnOptions.model;

    const turn = runAgentTurn(turnOptions);
    this.#turn = turn;
    try {
      const result = await turn.done;
      // ONLY IF THIS IS STILL THE CURRENT TURN, and that check is the whole fix.
      //
      // A cancelled turn still RESOLVES, carrying the session id it had seen. `newSession()` cancels
      // and then clears the id — and a few hundred milliseconds later this line put it straight back,
      // so the next message went out with `--resume <the old session>`. The "new" chat silently
      // continued the old conversation, inherited every message, and grew until it timed out at 180s.
      // Both chats on disk recorded the same cliSessionId, which is how it was found.
      //
      // `#turn` is set to undefined by `cancel()` and in the `finally` below, so identity is exactly
      // the question "is anyone still listening to this turn" — no counter needed, and it covers a
      // plain `copilot:cancel` followed by reopening another chat for the same reason.
      if (this.#turn === turn && result.sessionId) this.#sessionId = result.sessionId;
    } finally {
      this.#turn = undefined;
    }
  }
}
