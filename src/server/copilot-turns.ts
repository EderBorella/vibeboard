import { resolveCopilotSelection } from '../core/copilot-choice.js';
import type { Backend, CopilotMode, EffortLevel } from './copilot.js';
import type { AppCtx, WsClient } from './route-context.js';

// Per-turn options are the dock's SESSION OVERRIDE. The project config holds the defaults
// and is the only persisted source; anything omitted here falls back to it. Precedence
// lives in resolveCopilotSelection — see src/core/copilot-choice.ts.
interface CopilotOpts { mode: CopilotMode; backend?: string; model?: string; effort?: EffortLevel }

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
    if (target) { try { target.send(JSON.stringify(payload)); } catch { /* closed */ } }
    else broadcast(payload);
  };
  // Switcher-only update (after a turn): refreshes the chat list without touching items.
  const broadcastChatList = async (): Promise<void> => {
    broadcast({ type: 'copilot:chats', ...(await chats.chatList()) });
  };

  // The backend in force for a turn: the override, else the configured default.
  const effectiveBackend = (override?: string): Backend =>
    (resolveCopilotSelection(session.config?.copilot, { backend: override }).backend as Backend);

  async function handleCopilotSend(text: string, opts: CopilotOpts): Promise<void> {
    if (!session.isOpen) { broadcast({ type: 'copilot:error', error: 'No project open' }); return; }
    if (!text.trim()) return;
    try {
      await chats.recordUser(text);
      copilotState(); // running flips true only once send starts; announce optimistically
      const choice = resolveCopilotSelection(session.config?.copilot, {
        backend: opts.backend, model: opts.model, effort: opts.effort,
      });
      await copilot.send({
        cwd: session.root!,
        text,
        mode: opts.mode,
        backend: choice.backend as Backend,
        model: choice.model,
        effort: choice.effort as EffortLevel,
        onEvent: (event) => { void chats.recordEvent(event); broadcast({ type: 'copilot:event', event }); },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      chats.recordError(message);
      broadcast({ type: 'copilot:error', error: message });
    } finally {
      await chats.flush();
      await broadcastChatList();
      copilotState();
    }
  }

  function handleCopilotMessage(raw: string): void {
    let msg: { type?: string; text?: string; chatId?: string; mode?: CopilotMode; backend?: string; model?: string; effort?: EffortLevel };
    try { msg = JSON.parse(raw); } catch { return; }
    const opts = (): CopilotOpts => ({
      mode: msg.mode ?? 'bypassPermissions', backend: msg.backend, model: msg.model, effort: msg.effort,
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
          await sendHistory();
          copilotState();
        })();
        break;
      case 'copilot:open':
        if (msg.chatId) void handleCopilotOpen(msg.chatId, msg.backend);
        break;
      case 'copilot:delete':
        if (msg.chatId) void handleCopilotDelete(msg.chatId);
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
