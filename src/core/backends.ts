// Real defaults per copilot backend — never blank.
//
// A blank model means "let the CLI decide", which looks harmless but hides which model is
// actually answering: the OpenCode CLI and its HTTP API both quietly fall back to their own
// pick, and a config with no model gives no clue what that will be. Naming the model here
// makes the choice visible and identical everywhere (fresh project, old project, direct
// WebSocket call), and gives the UI something concrete to show as "default".
//
// Model ids are backend-specific and NOT interchangeable: a Claude alias means nothing to
// OpenCode. Switching backend must switch to that backend's default, not carry the old id.

export interface BackendDefaults {
  model: string;
  effort: string;
}

export const DEFAULT_BACKEND = 'claude-code';

export const BACKEND_DEFAULTS: Record<string, BackendDefaults> = {
  // Claude Code takes an alias and resolves the latest model behind it.
  'claude-code': { model: 'opus', effort: 'high' },
  // OpenCode's own auto-pick when nothing is configured, so this changes no behaviour — it
  // only makes it visible. Free, tool-capable, 200k context, and supports the variant scale.
  opencode: { model: 'opencode/deepseek-v4-flash-free', effort: 'high' },
};

export function backendDefaults(backend: string | undefined): BackendDefaults {
  return BACKEND_DEFAULTS[backend ?? ''] ?? BACKEND_DEFAULTS[DEFAULT_BACKEND];
}

// A full per-backend map seeded with the built-in defaults: the starting point for a new
// project, and the backfill for a backend a config has never selected.
export function defaultBackendMap(): Record<string, BackendDefaults> {
  return Object.fromEntries(Object.entries(BACKEND_DEFAULTS).map(([k, v]) => [k, { ...v }]));
}
