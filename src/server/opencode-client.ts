import { type CopilotEvent, num } from './copilot-events.js';
import { opencodeBaseUrl, opencodeDirectory, opencodeLog } from './opencode-server.js';

// OpenCode's HTTP API wants the model as { providerID, modelID }. Our ids are
// "provider/model" (modelID itself may contain slashes, e.g. openrouter/deepseek/x:free).
export function splitModel(model: string): { providerID: string; modelID: string } {
  const i = model.indexOf('/');
  return i < 0
    ? { providerID: model, modelID: model }
    : { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}

interface OcPart {
  type?: string;
  text?: string;
  id?: string;
  tool?: string;
  name?: string;
  state?: { input?: unknown };
}
// Only `name` and `data.message` are read for the transcript; the rest of whatever the provider sent
// is kept, because that is the part worth logging — a bare "Streaming response failed" is not a
// diagnosis. Indexed rather than closed: the shape differs per provider and per failure.
export interface OcError {
  name?: string;
  message?: string;
  data?: { message?: string } & Record<string, unknown>;
  [key: string]: unknown;
}
interface OcInfo {
  sessionID?: string;
  cost?: number;
  error?: OcError;
  tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
  // Epoch milliseconds, both present on a completed message (verified against a live server's
  // response). This is the turn as the server timed it, so it excludes our own HTTP overhead.
  time?: { created?: number; completed?: number };
}
interface OcMessageResponse {
  info?: OcInfo;
  parts?: OcPart[];
}

export interface MessageEvents {
  events: CopilotEvent[];
  // Threaded out rather than logged here: this function is pure and has no logger, and the caller
  // that does (opencodeTurn) is one frame up. Everything but the message used to die on this line.
  error?: OcError;
}

// Both name and message when they differ: the name says what kind of failure it was, the message
// says what the provider said, and each alone has already proved useless in the field.
function errorText(error: OcError): string {
  const message = error.data?.message ?? error.message;
  if (error.name && message && error.name !== message) return `${error.name}: ${message}`;
  return message ?? error.name ?? 'error';
}

// How long the turn took, preferring the server's own stamps and falling back to what the caller
// measured around the request. Never a literal: a hardcoded 0 here is what made every OpenCode run
// report "0ms" on the Execution board while Claude runs reported real figures.
function durationOf(time: OcInfo['time'], measuredMs: number): number {
  const { created, completed } = time ?? {};
  return typeof created === 'number' && typeof completed === 'number' && completed >= created
    ? completed - created
    : measuredMs;
}

// Map a POST /session/:id/message response into the shared CopilotEvent stream. `measuredMs` is the
// wall clock around the request, used only when the response carries no timing of its own.
export function messageToEvents(data: OcMessageResponse, measuredMs: number): MessageEvents {
  const events: CopilotEvent[] = [];
  for (const p of data.parts ?? []) {
    if (p.type === 'text' && p.text) events.push({ kind: 'text', text: p.text });
    else if (p.type === 'tool')
      events.push({
        kind: 'tool_use',
        id: p.id ?? '',
        name: p.tool ?? p.name ?? 'tool',
        input: p.state?.input,
      });
    // 'reasoning' parts are intentionally dropped (thinking is hidden); step-* are ignored.
  }
  const info = data.info ?? {};
  const tk = info.tokens ?? {};
  const contextTokens = num(tk.input) + num(tk.cache?.read) + num(tk.cache?.write);
  events.push({ kind: 'usage', contextTokens });
  if (info.error) events.push({ kind: 'text', text: `\n[opencode: ${errorText(info.error)}]` });
  events.push({
    kind: 'result',
    sessionId: info.sessionID ?? '',
    stats: {
      ok: !info.error,
      text: '',
      costUsd: num(info.cost),
      durationMs: durationOf(info.time, measuredMs),
      // `turns` is deliberately absent, not 1. A message response describes ONE assistant message;
      // its step-start parts count model steps, which is not what Claude's num_turns counts, so
      // mapping them across would report a different quantity under the same name. RunUsage keeps
      // absence and zero apart and usageLine renders only what is present, so omitting says
      // "OpenCode did not report this" instead of asserting a number nobody measured.
      contextTokens,
      outputTokens: num(tk.output),
    },
  });
  return { events, ...(info.error ? { error: info.error } : {}) };
}

// pino serialises with JSON, so a cycle anywhere in the payload throws inside the log call — turning
// "record the failure" into a second failure. A depth-bounded plain copy also strips getters and
// class instances, whatever a provider's client attached to the object.
const MAX_DEPTH = 6;
function plainCopy(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth === MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => plainCopy(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainCopy(v, depth + 1)]));
}

interface OpencodeTurnOptions {
  cwd: string;
  text: string;
  model?: string;
  // OpenCode's reasoning scale, per-model (`low | medium | high | max` on models that have
  // one). This is what the UI calls "effort" for Claude; OpenCode names it a variant.
  variant?: string;
  system?: string;
  sessionId?: string;
  signal?: AbortSignal;
  onEvent: (event: CopilotEvent) => void;
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`opencode ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Run one OpenCode turn over the persistent server. Reuses the session id across turns
// (create one on first turn), returns the session id for the next turn.
//
// The project directory is a QUERY param (`?directory=`). It used to carry the real host path, which
// is how one shared server knew which project to operate in. Containerised it is the CONSTANT
// `/work` — the host path does not exist inside a box — so what distinguishes one project from
// another is now the BOX, not this parameter. `opencodeBaseUrl` therefore has to be per project, and
// is.
export async function opencodeTurn(opts: OpencodeTurnOptions): Promise<string> {
  const base = await opencodeBaseUrl();
  const dq = `?directory=${encodeURIComponent(opencodeDirectory(opts.cwd))}`;
  let sessionId = opts.sessionId;
  if (!sessionId) {
    const session = (await postJson(`${base}/session${dq}`, { title: 'VibeBoard' }, opts.signal)) as {
      id?: string;
    };
    sessionId = session.id ?? '';
  }
  const body: Record<string, unknown> = { parts: [{ type: 'text', text: opts.text }] };
  if (opts.model) body.model = splitModel(opts.model);
  if (opts.variant) body.variant = opts.variant;
  if (opts.system) body.system = opts.system;
  // Measured here, around the request, as the fallback for a response that reports no timing.
  const startedAt = Date.now();
  const data = (await postJson(
    `${base}/session/${sessionId}/message${dq}`,
    body,
    opts.signal,
  )) as OcMessageResponse;
  const { events, error } = messageToEvents(data, Date.now() - startedAt);
  // The transcript gets one short line; the whole error goes to the log, so the next occurrence is
  // readable with: jq 'select(.component == "opencode")' logs/vibeboard-*.log
  if (error) opencodeLog()?.error({ err: plainCopy(error), sessionId }, 'opencode turn failed');
  for (const event of events) opts.onEvent(event);
  return sessionId;
}
