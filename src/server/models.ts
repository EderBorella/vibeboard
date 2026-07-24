import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { opencodeBaseUrl } from './opencode-server.js';

export interface ModelOption {
  id: string;
  free: boolean;
  promptPerM?: number;      // USD per 1M input tokens (OpenRouter)
  completionPerM?: number;  // USD per 1M output tokens
  contextLength?: number;
}

export interface ModelStatus {
  up: boolean;
  uptime?: number;    // % over last 30m (best endpoint)
  endpoints: number;  // how many providers serve it
}

// Free models: OpenRouter uses a ":free" suffix; OpenCode's gateway uses "-free".
export function isFreeModel(id: string): boolean {
  return id.endsWith(':free') || id.includes('-free');
}

// Dedupe by id and list free models first (this deployment leans on free tiers).
export function mergeModels(lists: ModelOption[][]): ModelOption[] {
  const seen = new Set<string>();
  const out: ModelOption[] = [];
  for (const m of lists.flat()) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort((a, b) => Number(b.free) - Number(a.free));
}

const CLAUDE_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'];

// OpenCode credentials live here; we read provider names + keys to query the right APIs.
function opencodeAuth(): Record<string, { key?: string; apiKey?: string }> {
  try {
    return JSON.parse(readFileSync(join(homedir(), '.local/share/opencode/auth.json'), 'utf8'));
  } catch {
    return {};
  }
}

interface Cache { at: number; models: ModelOption[] }
const TTL_MS = 10 * 60 * 1000;
const caches = new Map<string, Cache>();

async function cached(key: string, fetcher: () => Promise<ModelOption[]>): Promise<ModelOption[]> {
  const hit = caches.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  try {
    const models = await fetcher();
    caches.set(key, { at: Date.now(), models });
    return models;
  } catch {
    return hit?.models ?? [];
  }
}

// OpenRouter — precise live catalog; we surface the free tier (the paid list is huge),
// enriched with pricing + context length straight from the same call (no extra requests).
interface OrModel { id: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }
async function openrouterModels(): Promise<ModelOption[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(8000) });
  const json = (await res.json()) as { data?: OrModel[] };
  return (json.data ?? [])
    .filter((m) => m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'))
    .map((m) => ({
      id: `openrouter/${m.id}`,
      free: true,
      promptPerM: m.pricing ? Number(m.pricing.prompt) * 1e6 : undefined,
      completionPerM: m.pricing ? Number(m.pricing.completion) * 1e6 : undefined,
      contextLength: m.context_length,
    }));
}

// Live status/uptime for one model via OpenRouter's endpoints route. Only openrouter ids
// have a status source; others return null. Cached briefly (its own cache).
const statusCache = new Map<string, { at: number; value: ModelStatus | null }>();
export async function modelStatus(id: string): Promise<ModelStatus | null> {
  if (!id.startsWith('openrouter/')) return null;
  const hit = statusCache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const slug = id.slice('openrouter/'.length).split(':')[0]; // drop the :free variant
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models/${slug}/endpoints`, { signal: AbortSignal.timeout(8000) });
    const json = (await res.json()) as { data?: { endpoints?: { status?: number; uptime_last_30m?: number }[] } };
    const eps = json.data?.endpoints ?? [];
    // OpenRouter endpoint status: 0 = normal; negative = disabled/deranked/down.
    const up = eps.some((e) => (e.status ?? 0) >= 0);
    const uptime = eps.reduce((m, e) => Math.max(m, e.uptime_last_30m ?? 0), 0);
    const value: ModelStatus = { up, uptime: uptime || undefined, endpoints: eps.length };
    statusCache.set(id, { at: Date.now(), value });
    return value;
  } catch {
    return hit?.value ?? null;
  }
}

// DeepSeek — its own /models is authoritative and current (drops deprecated ids like
// deepseek-chat that opencode's cached catalog still lists).
async function deepseekModels(key: string): Promise<ModelOption[]> {
  const res = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => ({ id: `deepseek/${m.id}`, free: false }));
}

// OpenCode's own gateway models (usable without a provider key). Sourced from the RUNNING
// opencode server's /config/providers — the authoritative list of what it will actually
// accept. (models.dev's catalog drifts from the live gateway, so ids like qwen3.6-plus-free
// there 500 with ProviderModelNotFoundError when selected.)
interface OcProvider { id?: string; models?: Record<string, unknown> }

// Pure: extract the opencode gateway's models from a /config/providers payload.
export function opencodeModelsFromProviders(json: { providers?: OcProvider[] }): ModelOption[] {
  const out: ModelOption[] = [];
  for (const p of json.providers ?? []) {
    if (p.id !== 'opencode') continue; // deepseek/openrouter come from their own precise sources
    for (const id of Object.keys(p.models ?? {})) out.push({ id: `opencode/${id}`, free: isFreeModel(id) });
  }
  return out;
}

async function opencodeGatewayModels(): Promise<ModelOption[]> {
  const base = await opencodeBaseUrl();
  const res = await fetch(`${base}/config/providers`, { signal: AbortSignal.timeout(8000) });
  return opencodeModelsFromProviders((await res.json()) as { providers?: OcProvider[] });
}

// Live, precise model list per backend. For opencode we query the actual provider APIs the
// user has authed (plus the free OpenCode gateway) rather than the stale `opencode models`.
export async function listBackendModels(backend: string): Promise<ModelOption[]> {
  if (backend !== 'opencode') return CLAUDE_ALIASES.map((id) => ({ id, free: false }));

  const auth = opencodeAuth();
  const tasks: Promise<ModelOption[]>[] = [cached('opencode-gateway', opencodeGatewayModels)];
  if (auth.openrouter) tasks.push(cached('openrouter', openrouterModels));
  const dsKey = auth.deepseek?.key ?? auth.deepseek?.apiKey;
  if (dsKey) tasks.push(cached('deepseek', () => deepseekModels(dsKey)));

  return mergeModels(await Promise.all(tasks));
}
