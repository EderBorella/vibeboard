import { resolveCopilotSelection } from '../../core/copilot-choice.js';
import { classifyCopilotError } from '../../core/copilot-errors.js';
import type { Credential } from '../auth/credentials.js';
import { attachedOpencodeUrl } from '../boxes/opencode-server.js';
import { agentRefusal } from '../boxes/sandbox.js';
import { errorText } from '../errors.js';
import { redactCredential } from '../redaction.js';
import type { AppCtx, WsClient } from '../route-context.js';
import { assistCredentialSection } from '../runs/prompt/credential.js';
import type { Backend, CopilotMode, EffortLevel } from './copilot.js';

// Per-turn options are the dock's SESSION OVERRIDE. The project config holds the defaults
// and is the only persisted source; anything omitted here falls back to it. Precedence
// lives in resolveCopilotSelection — see src/core/copilot-choice.ts.
interface CopilotOpts {
  mode: CopilotMode;
  backend?: string;
  model?: string;
  effort?: EffortLevel;
}

// Everything the copilot channel does over /ws: turn orchestration, chat open/delete, and
// the three broadcast shapes the client distinguishes (state, full history, chat list).
export function createCopilotTurns(ctx: AppCtx): {
  handleMessage: (raw: string) => void;
  sendHistory: (target?: WsClient) => Promise<void>;
  copilotState: () => void;
} {
  const { session, copilot, chats, broadcast } = ctx;

  const copilotState = (): void => broadcast({ type: 'copilot:state', state: copilot.state });
  // Full replay (connect + explicit chat change): replaces the client's transcript.
  const sendHistory = async (target?: WsClient): Promise<void> => {
    const payload = { type: 'copilot:history', ...(await chats.historyPayload()) };
    if (target) {
      try {
        target.send(JSON.stringify(payload));
      } catch {
        /* closed */
      }
    } else broadcast(payload);
  };
  // Switcher-only update (after a turn): refreshes the chat list without touching items.
  const broadcastChatList = async (): Promise<void> => {
    broadcast({ type: 'copilot:chats', ...(await chats.chatList()) });
  };

  // The backend in force for a turn: the override, else the configured default.
  const effectiveBackend = (override?: string): Backend =>
    resolveCopilotSelection(session.config?.copilot, { backend: override }).backend as Backend;

  // Why this turn cannot start, or nothing. One function because they are one decision — and separate
  // from the handler because three `if`s each with a broadcast inside was the whole of that function's
  // complexity budget, and flattening beats suppressing the rule.
  const sendRefusal = async (): Promise<string | undefined> => {
    // The chat is an agent too, and it auto-approves its own tool calls. Same gate, same reason.
    const refusal = agentRefusal(await ctx.sandbox(), attachedOpencodeUrl());
    if (refusal) return refusal;
    // Decision 12: while halted the chat "says plainly that the project is halted". Refused HERE, in
    // front of the spawn, rather than left to the lazy-respawn gate deeper down: that one produces a
    // failed turn with a technical message, and this is a state the user themselves chose.
    if ((await ctx.autopilot.current()).state === 'halted') {
      return 'This project is halted, so nothing will be started for it. Restart it from the auto-pilot panel to use the copilot again.';
    }
    return undefined;
  };

  // Every path that changes which conversation is open ends the credential that belonged to the last
  // one. Called eagerly rather than left to `forTurn`, which only fires when a turn is sent.
  const endAuthorityIfChanged = async (): Promise<void> => {
    const chat = session.root ? await chats.currentId() : undefined;
    ctx.copilotAuthority.endedIfChanged(chat, session.root);
  };

  // The credential section, prepended to the model's copy of the message when a person has authorised
  // this conversation. Nothing is injected otherwise — not a placeholder, not an explanation — because
  // an unauthorised copilot that knows an endpoint exists is one that will keep trying it and reporting
  // 403s to the user as if they were bugs.
  async function turnCredential(root: string): Promise<Credential | undefined> {
    return ctx.copilotAuthority.forTurn(await chats.currentId(), root);
  }

  function withCredential(token: string, text: string): string {
    const apiBase = `http://127.0.0.1:${process.env.VIBEBOARD_PORT ?? 4610}`;
    return `${assistCredentialSection(apiBase, token)}\n\n---\n\n${text}`;
  }

  async function handleCopilotSend(text: string, opts: CopilotOpts): Promise<void> {
    // Read root rather than isOpen, so the cwd below needs no assertion.
    const root = session.root;
    if (!root) {
      broadcast({ type: 'copilot:error', error: 'No project open' });
      return;
    }
    if (!text.trim()) return;
    const refused = await sendRefusal();
    if (refused) {
      broadcast({ type: 'copilot:error', error: refused });
      return;
    }
    try {
      await chats.recordUser(text);
      // THE TRANSCRIPT GETS THE PERSON'S WORDS; THE MODEL GETS THE CREDENTIAL TOO.
      //
      // Two statements, and the separation is the security property: the token never enters
      // `.vibeboard/chat/`. A chat file is readable inside the project's box for as long as it exists,
      // so a token recorded here would be readable by every agent working that project.
      //
      // On stdin, in the prompt, rather than argv: `--append-system-prompt` is a command-line argument
      // and /proc/<pid>/cmdline is world-readable, which agent-turn.ts refuses credentials for by name.
      //
      // NOT A CLOSED LEAK, AND SAYING SO: the CLI writes its own session transcript into the box's
      // `/state`, which every agent on the same (project, backend) shares — so a `work` agent can lift
      // this credential out of the copilot's session file. Runs have the same exposure and survive it
      // because their tokens die in minutes; this one lives for a conversation, which is the argument
      // for ending it eagerly on every chat and project change rather than only on a send. The
      // exposure and its limits are stated in full in docs/security/containment.md.
      const credential = await turnCredential(root);
      const modelText = credential ? withCredential(credential.token, text) : text;
      const choice = resolveCopilotSelection(session.config?.copilot, {
        backend: opts.backend,
        model: opts.model,
        effort: opts.effort,
      });
      await copilot.send({
        // ANNOUNCED FROM INSIDE `send`, at the assignment of its turn. This used to be a
        // `copilotState()` on the line above the call, described as optimistic — and it shipped
        // `running: false`, because the flag it reads is set inside the method it was announcing
        // ahead of. The browser therefore learned a turn had started only when it ENDED, and the
        // copilot's thinking indicator had nothing to mount on. See the hook's comment in copilot.ts.
        onStart: copilotState,
        cwd: root,
        text: modelText,
        mode: opts.mode,
        backend: choice.backend as Backend,
        model: choice.model,
        effort: choice.effort as EffortLevel,
        onEvent: (event) => {
          // REDACTED ON THE WAY TO DISK, the way agent-runner.ts already does for a run's transcript
          // and report. `.vibeboard/chat/` is readable by every agent on the machine, and a model that
          // quotes back the `Authorization: Bearer …` it just sent would otherwise persist the
          // credential there for the life of the conversation. The prompt tells it not to; prompt
          // compliance is not a security boundary.
          void chats.recordEvent(redactCredential(event, credential?.token));
          broadcast({ type: 'copilot:event', event });
        },
      });
    } catch (err) {
      // CLASSIFIED HERE TOO, so all three failure paths speak one vocabulary. This one already
      // rendered as an error rather than as prose — it was the only one that did — but it offered no
      // remedy either, which is the other half of the complaint.
      const classified = classifyCopilotError(errorText(err));
      chats.recordError(classified.sentence);
      broadcast({ type: 'copilot:error', error: classified.sentence, retryable: classified.retryable });
    } finally {
      await chats.flush();
      await broadcastChatList();
      copilotState();
    }
  }

  function handleCopilotMessage(raw: string): void {
    let msg: {
      type?: string;
      text?: string;
      chatId?: string;
      mode?: CopilotMode;
      backend?: string;
      model?: string;
      effort?: EffortLevel;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const opts = (): CopilotOpts => ({
      mode: msg.mode ?? 'bypassPermissions',
      backend: msg.backend,
      model: msg.model,
      effort: msg.effort,
    });
    switch (msg.type) {
      case 'copilot:send':
        void handleCopilotSend(msg.text ?? '', opts());
        break;
      case 'copilot:compact':
        void handleCopilotSend('/compact', opts());
        break;
      case 'copilot:new':
        void (async () => {
          copilot.newSession();
          await chats.newChat();
          await endAuthorityIfChanged();
          await sendHistory();
          copilotState();
        })();
        break;
      case 'copilot:open':
        if (msg.chatId) void handleCopilotOpen(msg.chatId, msg.backend).then(endAuthorityIfChanged);
        break;
      case 'copilot:delete':
        if (msg.chatId) void handleCopilotDelete(msg.chatId).then(endAuthorityIfChanged);
        break;
      case 'copilot:cancel':
        copilot.cancel();
        copilotState();
        break;
    }
  }

  // Reopen a stored chat: restore its transcript and, when the backend matches, resume the
  // underlying CLI session so the next message continues it (a mismatch continues fresh — the
  // ChatStore attaches a one-shot note to the history payload).
  async function handleCopilotOpen(chatId: string, backendOverride?: string): Promise<void> {
    const info = await chats.open(chatId);
    if (!info) return;
    const backend = effectiveBackend(backendOverride);
    if (info.backend === backend) copilot.resume(info.cliSessionId, info.model);
    else copilot.newSession();
    await sendHistory();
    copilotState();
  }

  async function handleCopilotDelete(chatId: string): Promise<void> {
    const { wasCurrent } = await chats.delete(chatId);
    if (wasCurrent) copilot.newSession();
    await sendHistory();
    copilotState();
  }

  return { handleMessage: handleCopilotMessage, sendHistory, copilotState };
}
