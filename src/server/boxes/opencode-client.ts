import { Agent, fetch as undiciFetch } from 'undici';
import { classifyCopilotError } from '../../core/copilot-errors.js';
import { type CopilotEvent, num } from '../copilot-events.js';
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
interface OcError {
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

interface MessageEvents {
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
  // A COMPLETED TURN CARRYING AN ERROR IS STILL AN ERROR. This pushed `kind: 'text'`, so the failure
  // arrived as an ordinary assistant bubble wearing the provider's payload — the exact `[opencode:
  // UnknownError: {"code":429,…}]` the owner saw on 2026-08-31. `classifyCopilotError` turns it into a
  // situation and a remedy, and `retryable` is what puts a Retry beside it.
  if (info.error) {
    const classified = classifyCopilotError(errorText(info.error));
    events.push({ kind: 'error', text: classified.sentence, retryable: classified.retryable });
  }
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

// NO TIMEOUT OF ITS OWN, and that is the whole reason this dispatcher exists.
//
// Node's `fetch` uses undici, whose default `headersTimeout` is 300 SECONDS. A model that takes longer than
// that to produce its first byte — ordinary for a free one — makes the request reject with
// `TypeError: fetch failed`, which is indistinguishable at a glance from a server that is not there.
//
// Measured on the calculator project, 2026-08-17: ELEVEN failures at 300.7–300.9 seconds across five cards, in
// one afternoon. Every one burned an attempt because the request really had been sent; E-002's three `fix` runs
// took it to its cap; and auto-pilot then reported that the cards could not be done. Nothing was wrong with any
// card, and `VIBEBOARD_RUN_TIMEOUT_MS` — the bound the product documents — is thirty minutes.
//
// So the turn's own timer is the ONE bound: `agent-turn.ts` holds it, with an AbortController that reaches this
// request through `signal`. A second, shorter, undeclared bound down here is what produced the eleven.
//
// `undici` is imported rather than reaching for the global `fetch` because an `Agent` is the only way to set
// this, and it is the same library Node uses internally — so the error shapes `neverConnected` classifies are
// unchanged. ONE agent for the process: a new one per request would open a connection pool per turn.
// Exported as a value because an `Agent` does not expose what it was built with, and "no cap" is the claim
// worth pinning: the behavioural test proves the dispatcher is wired, and this proves the numbers are zero
// rather than merely large — a ten-minute cap is the same defect one order of magnitude further out.
export const OPENCODE_TIMEOUTS = { headersTimeout: 0, bodyTimeout: 0 } as const;

let dispatcher: Agent | undefined;
export function opencodeDispatcher(): Agent {
  dispatcher ??= new Agent({ ...OPENCODE_TIMEOUTS });
  return dispatcher;
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await undiciFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    dispatcher: opencodeDispatcher(),
    signal,
  });
  // A NON-2xx IS NOT AN UNREACHABLE SERVER, and `neverConnected` below depends on this staying an
  // ordinary Error: the server answered, so it may have spent tokens before it failed.
  if (!res.ok) throw new Error(`opencode ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// THE REQUEST NEVER CROSSED THE WIRE — the one failure where zero usage is a measurement rather than a
// guess, and therefore the one that lets `fault.ts` call a dead turn the machine's fault.
//
// `fault.ts` classifies infrastructure only from usage the backend REPORTED being zero in both
// directions; absent usage tells us nothing and is deliberately not treated as zero. That left the
// OpenCode case unclassifiable, and its comment said so. Three records on 2026-08-16 are what this is
// derived from: a container had been replaced under a live server, so every dispatch rejected in 449ms
// with `fetch failed`, nothing was charged to any model, and auto-pilot blamed a README nothing had
// read.
//
// THE CAUSE CODE, NEVER THE SURFACE. `TypeError: fetch failed` is what Node throws for a refused
// connection AND for a server that accepted the request and answered too slowly — measured, a
// `headersTimeout` fires at 300862ms with exactly that message. Matching the TypeError alone therefore
// called a five-minute model timeout "never reached a model", which is false twice over: the request
// was sent and may have spent tokens, and classifying it as the machine's fault stops it burning an
// attempt, so a card that times out every time would retry for ever without ever reaching a person.
// The calculator project hit precisely that on 2026-08-16 — every first run died at 5m01s.
//
// So the list is connection ESTABLISHMENT failures only, each of which is a measurement that no byte
// left this process: there was nothing to send it over. A timeout, a reset and an unrecognised cause all
// fail towards "the agent's own", which costs a card one attempt it did not deserve — where being wrong
// the other way costs the whole cap and never reaches a person.
//
// AN ABORT IS REFUSED FIRST, not merely downstream. A cancelled turn and a timed-out one reject the same
// fetch, and both are already refused by `neverReachedModel` — but a person's decision to stop a run must
// not read as the machine breaking, and that reason belongs here rather than two modules away.
const NEVER_SENT = new Set([
  'ECONNREFUSED', // nothing listening — a replaced or stopped box
  'ENOTFOUND', // no such host
  'EAI_AGAIN', // DNS could not answer
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', // the connection itself never came up
]);

export function neverConnected(err: unknown): boolean {
  const cause = err instanceof OpencodeTurnFailed ? err.cause : err;
  if (cause instanceof DOMException && cause.name === 'AbortError') return false;
  if (!(cause instanceof TypeError)) return false;
  const code = (cause.cause as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && NEVER_SENT.has(code);
}

// Run one OpenCode turn over the persistent server. Reuses the session id across turns
// (create one on first turn), returns the session id for the next turn.
//
// The project directory is a QUERY param (`?directory=`). It used to carry the real host path, which
// is how one shared server knew which project to operate in. Containerised it is the CONSTANT
// `/work` — the host path does not exist inside a box — so what distinguishes one project from
// another is now the BOX, not this parameter. `opencodeBaseUrl` therefore has to be per project, and
// is.
// Thrown instead of a bare error once a session EXISTS, so a caller whose turn failed can still learn
// which conversation it was failing in. Without this the id is created and then lost with the
// exception, the session is orphaned on the OpenCode server, and the chat's next message opens another
// one — so a failed first turn silently discards the thread rather than continuing it.
export class OpencodeTurnFailed extends Error {
  readonly sessionId: string;
  constructor(sessionId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'OpencodeTurnFailed';
    this.sessionId = sessionId;
    this.cause = cause;
  }
}

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
  // Wrapped so the session id survives the throw. Everything above this point either used the id the
  // caller gave us or created one; from here on a failure must not take it with it.
  let data: OcMessageResponse;
  try {
    data = (await postJson(
      `${base}/session/${sessionId}/message${dq}`,
      body,
      opts.signal,
    )) as OcMessageResponse;
  } catch (err) {
    throw new OpencodeTurnFailed(sessionId, err);
  }
  const { events, error } = messageToEvents(data, Date.now() - startedAt);
  // The transcript gets one short line; the whole error goes to the log, so the next occurrence is
  // readable with: jq 'select(.component == "opencode")' logs/vibeboard-*.log
  if (error) opencodeLog()?.error({ err: plainCopy(error), sessionId }, 'opencode turn failed');
  for (const event of events) opts.onEvent(event);
  return sessionId;
}
