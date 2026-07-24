import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ModelOption {
  id: string;
  free: boolean;
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

// OpenRouter — precise live catalog; we surface the free tier (the paid list is huge).
async function openrouterModels(): Promise<ModelOption[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(8000) });
  const json = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
  return (json.data ?? [])
    .filter((m) => m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'))
    .map((m) => ({ id: `openrouter/${m.id}`, free: true }));
}

// DeepSeek — its own /models is authoritative and current (drops deprecated ids like
// deepseek-chat that opencode's cached catalog still lists).
async function deepseekModels(key: string): Promise<ModelOption[]> {
  const res = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => ({ id: `deepseek/${m.id}`, free: false }));
}

// OpenCode's own free gateway models (usable without a provider key), from models.dev.
async function opencodeGatewayFree(): Promise<ModelOption[]> {
  const res = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(8000) });
  const json = (await res.json()) as Record<string, { models?: Record<string, unknown> }>;
  const models = json.opencode?.models ?? {};
  return Object.keys(models)
    .filter((id) => isFreeModel(id))
    .map((id) => ({ id: `opencode/${id}`, free: true }));
}

// Live, precise model list per backend. For opencode we query the actual provider APIs the
// user has authed (plus the free OpenCode gateway) rather than the stale `opencode models`.
export async function listBackendModels(backend: string): Promise<ModelOption[]> {
  if (backend !== 'opencode') return CLAUDE_ALIASES.map((id) => ({ id, free: false }));

  const auth = opencodeAuth();
  const tasks: Promise<ModelOption[]>[] = [cached('opencode-gateway', opencodeGatewayFree)];
  if (auth.openrouter) tasks.push(cached('openrouter', openrouterModels));
  const dsKey = auth.deepseek?.key ?? auth.deepseek?.apiKey;
  if (dsKey) tasks.push(cached('deepseek', () => deepseekModels(dsKey)));

  return mergeModels(await Promise.all(tasks));
}
