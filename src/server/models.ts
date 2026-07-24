import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { opencodeBaseUrl } from './opencode-server.js';

export interface ModelCaps {
  toolCall?: boolean;   // can call tools — the copilot needs this to edit cards
  reasoning?: boolean;
  vision?: boolean;     // accepts image input
  attachment?: boolean;
}

export interface ModelOption {
  id: string;
  free: boolean;
  name?: string;            // human display name
  promptPerM?: number;      // USD per 1M input tokens
  completionPerM?: number;  // USD per 1M output tokens
  contextLength?: number;   // max context tokens
  outputLimit?: number;     // max output tokens
  caps?: ModelCaps;
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

// Claude aliases carry known caps (all support tools + reasoning + vision).
const CLAUDE_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'];
function claudeAliasOption(id: string): ModelOption {
  return { id, free: false, name: id[0].toUpperCase() + id.slice(1), caps: { toolCall: true, reasoning: true, vision: true, attachment: true } };
}

// OpenCode credentials live here; we read provider names + keys to query the right APIs.
function opencodeAuth(): Record<string, { key?: string; apiKey?: string }> {
  try {
    return JSON.parse(readFileSync(join(homedir(), '.local/share/opencode/auth.json'), 'utf8'));
  } catch {
    return {};
  }
}

interface Cache<T> { at: number; value: T }
const TTL_MS = 10 * 60 * 1000;
const caches = new Map<string, Cache<unknown>>();

async function cached<T>(key: string, fetcher: () => Promise<T>, fallback: T): Promise<T> {
  const hit = caches.get(key) as Cache<T> | undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const value = await fetcher();
    caches.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return hit?.value ?? fallback;
  }
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

// DeepSeek's own /models — the current, valid id set. Its registry entry in opencode
// over-lists deprecated ids (deepseek-chat), so we intersect against this.
async function deepseekIds(key: string): Promise<Set<string>> {
  const res = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  const json = (await res.json()) as { data?: { id: string }[] };
  return new Set((json.data ?? []).map((m) => m.id));
}

// The rich per-model definition from OpenCode's /config/providers.
interface OcModelDef {
  name?: string;
  capabilities?: { toolcall?: boolean; reasoning?: boolean; attachment?: boolean; input?: { image?: boolean } };
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number };
}
interface OcProviderFull { id?: string; models?: Record<string, OcModelDef> }

function optionFromDef(id: string, m: OcModelDef): ModelOption {
  const cost = m.cost ?? {};
  const cap = m.capabilities ?? {};
  return {
    id,
    free: (cost.input ?? 0) === 0 && (cost.output ?? 0) === 0,
    name: m.name,
    promptPerM: cost.input,
    completionPerM: cost.output,
    contextLength: m.limit?.context,
    outputLimit: m.limit?.output,
    caps: { toolCall: cap.toolcall, reasoning: cap.reasoning, vision: cap.input?.image, attachment: cap.attachment },
  };
}

// Pure: map one provider's /config/providers entry to ModelOptions (ids as provider/model,
// matching what opencode's HTTP API expects). Exported for testing.
export function modelsFromProvider(providerId: string, models: Record<string, OcModelDef>): ModelOption[] {
  return Object.entries(models).map(([id, def]) => optionFromDef(`${providerId}/${id}`, def));
}

// The running OpenCode server's provider catalog — authoritative for which models it will
// accept, and rich with capabilities/limits/cost for every provider it has configured.
async function fetchOpencodeCatalog(): Promise<Record<string, Record<string, OcModelDef>>> {
  const base = await opencodeBaseUrl();
  const res = await fetch(`${base}/config/providers`, { signal: AbortSignal.timeout(8000) });
  const json = (await res.json()) as { providers?: OcProviderFull[] };
  const out: Record<string, Record<string, OcModelDef>> = {};
  for (const p of json.providers ?? []) if (p.id) out[p.id] = p.models ?? {};
  return out;
}

// Live, capability-rich model list per backend. For opencode we read the running server's
// catalog (authoritative — no models.dev drift), filtering DeepSeek to its live id set.
export async function listBackendModels(backend: string): Promise<ModelOption[]> {
  if (backend !== 'opencode') return CLAUDE_ALIASES.map(claudeAliasOption);

  const catalog = await cached<ModelOption[]>('oc-catalog', async () =>
    Object.entries(await fetchOpencodeCatalog()).flatMap(([prov, models]) => modelsFromProvider(prov, models)), []);

  const dsKey = opencodeAuth().deepseek?.key ?? opencodeAuth().deepseek?.apiKey;
  let models = catalog;
  if (dsKey) {
    const valid = await cached<Set<string>>('deepseek-ids', () => deepseekIds(dsKey), new Set());
    if (valid.size) models = catalog.filter((m) => !m.id.startsWith('deepseek/') || valid.has(m.id.slice('deepseek/'.length)));
  }
  return mergeModels([models]);
}
