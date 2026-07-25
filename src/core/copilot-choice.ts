import { DEFAULT_BACKEND, backendDefaults } from './backends.js';

// The ONE place backend/model/effort precedence is decided.
//
// Before this existed the same `||`-chain lived in six places (two on the server, three in
// the UI, one in Settings), and the three commits that reworked the dock had to keep all of
// them in step. They didn't: a stale copy is what made "switch connector for one chat"
// rewrite the project defaults.
//
// Precedence: override → the backend's own saved slot → the backend's built-in default.
//
// A model id is backend-specific, so each backend keeps its own slot. Reading the slot FOR THE
// BACKEND IN FORCE is what makes switching connector non-destructive: it can never hand
// OpenCode a Claude model id, and it never has to discard the other backend's choice. With a
// single shared slot, switching fell back to the built-in default and the next save overwrote
// the model chosen for the backend being left.

interface CopilotSelection {
  backend: string;
  model: string;
  effort: string;
}

interface CopilotOverride {
  backend?: string;
  model?: string;
  effort?: string;
}

interface ConfiguredCopilot {
  backend: string;
  backends?: Record<string, { model?: string; effort?: string }>;
  model?: string; // legacy single slot
  effort?: string; // legacy single slot
}

export function resolveCopilotSelection(
  configured: ConfiguredCopilot | undefined,
  override: CopilotOverride,
): CopilotSelection {
  const backend = override.backend || configured?.backend || DEFAULT_BACKEND;
  // An unmigrated config's single pair describes whichever backend was selected when it was
  // written, so it counts as that backend's slot and no other.
  const legacy =
    backend === configured?.backend ? { model: configured?.model, effort: configured?.effort } : undefined;
  const saved = configured?.backends?.[backend] ?? legacy;
  const fallback = backendDefaults(backend);
  // `||` not `??`: a blank left by an older config must fall through to the real default
  // rather than count as a deliberate choice.
  return {
    backend,
    model: override.model || saved?.model || fallback.model,
    effort: override.effort || saved?.effort || fallback.effort,
  };
}
