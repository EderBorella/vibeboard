import { execFile } from 'node:child_process';

export interface ModelOption {
  id: string;
  free: boolean;
}

// Free models: OpenRouter uses a ":free" suffix; OpenCode's gateway uses "-free".
export function isFreeModel(id: string): boolean {
  return id.endsWith(':free') || id.includes('-free');
}

export function parseOpencodeModels(output: string): ModelOption[] {
  return output.split('\n').map((l) => l.trim()).filter(Boolean).map((id) => ({ id, free: isFreeModel(id) }));
}

const CLAUDE_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'];

interface OrModel { id: string; pricing?: { prompt?: string; completion?: string } }
let orCache: { at: number; models: ModelOption[] } | undefined;
const OR_TTL_MS = 10 * 60 * 1000;

// OpenRouter's free models, addressed for OpenCode as `openrouter/<id>`. Cached; failures
// degrade to the last good list (or empty) so the dropdown never blocks on the network.
export async function fetchOpenrouterFreeModels(): Promise<ModelOption[]> {
  if (orCache && Date.now() - orCache.at < OR_TTL_MS) return orCache.models;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(8000) });
    const json = (await res.json()) as { data?: OrModel[] };
    const models = (json.data ?? [])
      .filter((m) => m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'))
      .map((m) => ({ id: `openrouter/${m.id}`, free: true }));
    orCache = { at: Date.now(), models };
    return models;
  } catch {
    return orCache?.models ?? [];
  }
}

function opencodeModelsOutput(bin: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, ['models'], { maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

// Free models first (this deployment leans on free tiers), then the rest.
function freeFirst(models: ModelOption[]): ModelOption[] {
  return [...models].sort((a, b) => Number(b.free) - Number(a.free));
}

export async function listBackendModels(backend: string): Promise<ModelOption[]> {
  if (backend === 'opencode') {
    const bin = process.env.VIBEBOARD_OPENCODE_BIN ?? 'opencode';
    const [oc, openrouter] = await Promise.all([
      opencodeModelsOutput(bin).then(parseOpencodeModels),
      fetchOpenrouterFreeModels(),
    ]);
    const seen = new Set(oc.map((m) => m.id));
    return freeFirst([...oc, ...openrouter.filter((m) => !seen.has(m.id))]);
  }
  return CLAUDE_ALIASES.map((id) => ({ id, free: false }));
}
