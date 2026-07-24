import type { CopilotEvent } from './copilot-events.js';
import { opencodeBaseUrl } from './opencode-server.js';

// OpenCode's HTTP API wants the model as { providerID, modelID }. Our ids are
// "provider/model" (modelID itself may contain slashes, e.g. openrouter/deepseek/x:free).
export function splitModel(model: string): { providerID: string; modelID: string } {
  const i = model.indexOf('/');
  return i < 0 ? { providerID: model, modelID: model } : { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

interface OcPart { type?: string; text?: string; id?: string; tool?: string; name?: string; state?: { input?: unknown } }
interface OcInfo { sessionID?: string; cost?: number; error?: { name?: string; data?: { message?: string } }; tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } } }
export interface OcMessageResponse { info?: OcInfo; parts?: OcPart[] }

// Map a POST /session/:id/message response into the shared CopilotEvent stream.
export function messageToEvents(data: OcMessageResponse): CopilotEvent[] {
  const events: CopilotEvent[] = [];
  for (const p of data.parts ?? []) {
    if (p.type === 'text' && p.text) events.push({ kind: 'text', text: p.text });
    else if (p.type === 'tool') events.push({ kind: 'tool_use', id: p.id ?? '', name: p.tool ?? p.name ?? 'tool', input: p.state?.input });
    // 'reasoning' parts are intentionally dropped (thinking is hidden); step-* are ignored.
  }
  const info = data.info ?? {};
  const tk = info.tokens ?? {};
  const contextTokens = num(tk.input) + num(tk.cache?.read) + num(tk.cache?.write);
  events.push({ kind: 'usage', contextTokens });
  if (info.error) {
    events.push({ kind: 'text', text: `\n[opencode: ${info.error.data?.message ?? info.error.name ?? 'error'}]` });
  }
  events.push({
    kind: 'result',
    sessionId: info.sessionID ?? '',
    stats: { ok: !info.error, text: '', costUsd: num(info.cost), durationMs: 0, turns: 1, contextTokens, outputTokens: num(tk.output) },
  });
  return events;
}

export interface OpencodeTurnOptions {
  cwd: string;
  text: string;
  model?: string;
  system?: string;
  sessionId?: string;
  signal?: AbortSignal;
  onEvent: (event: CopilotEvent) => void;
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`opencode ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Run one OpenCode turn over the persistent server. Reuses the session id across turns
// (create one on first turn), returns the session id for the next turn.
export async function opencodeTurn(opts: OpencodeTurnOptions): Promise<string> {
  const base = await opencodeBaseUrl();
  let sessionId = opts.sessionId;
  if (!sessionId) {
    const session = (await postJson(`${base}/session`, { title: 'VibeBoard' }, opts.signal)) as { id?: string };
    sessionId = session.id ?? '';
  }
  const body: Record<string, unknown> = { parts: [{ type: 'text', text: opts.text }], directory: opts.cwd };
  if (opts.model) body.model = splitModel(opts.model);
  if (opts.system) body.system = opts.system;
  const data = (await postJson(`${base}/session/${sessionId}/message`, body, opts.signal)) as OcMessageResponse;
  for (const event of messageToEvents(data)) opts.onEvent(event);
  return sessionId;
}
