import { DEFAULT_BACKEND, backendDefaults } from './backends.js';

// The ONE place backend/model/effort precedence is decided.
//
// Before this existed the same `||`-chain lived in six places (two on the server, three in
// the UI, one in Settings), and the three commits that reworked the dock had to keep all of
// them in step. They didn't: a stale copy is what made "switch connector for one chat"
// rewrite the project defaults.
//
// Precedence: override → configured default → the backend's own built-in default.
// The one subtlety: a model id is backend-specific. If the override names a DIFFERENT
// backend, the configured model and effort are discarded rather than carried across —
// "sonnet" means nothing to OpenCode.

export interface CopilotSelection {
  backend: string;
  model: string;
  effort: string;
}

export interface CopilotOverride {
  backend?: string;
  model?: string;
  effort?: string;
}

export function resolveCopilotSelection(
  configured: { backend: string; model?: string; effort?: string } | undefined,
  override: CopilotOverride,
): CopilotSelection {
  const backend = override.backend || configured?.backend || DEFAULT_BACKEND;
  // Only inherit the configured model/effort when they belong to the backend in force.
  const inherited = backend === configured?.backend ? configured : undefined;
  const fallback = backendDefaults(backend);
  // `||` not `??`: a blank in a config written before real defaults existed must fall
  // through, not be treated as a deliberate choice.
  return {
    backend,
    model: override.model || inherited?.model || fallback.model,
    effort: override.effort || inherited?.effort || fallback.effort,
  };
}
