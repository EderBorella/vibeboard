import { DEFAULT_BACKEND, backendCaps, backendDefaults, type CopilotChoice } from '../shared';

// The client half of copilot selection. Deliberately mirrors src/core/copilot-choice.ts
// rather than importing it: web/ is bundler-resolved and src/ is NodeNext with mandatory
// .js extensions, so the two live on opposite sides of that boundary (see web/src/shared.ts).
// test/copilot-choice-web.test.ts asserts the two agree on the shared cases.

// Precedence: override → configured default → the backend's own default. An overridden
// backend does NOT inherit the other backend's model id.
export function resolveChoice(
  configured: { backend: string; model?: string; effort?: string } | undefined,
  override: Partial<CopilotChoice>,
): CopilotChoice {
  const backend = override.backend || configured?.backend || DEFAULT_BACKEND;
  const inherited = backend === configured?.backend ? configured : undefined;
  const fallback = backendDefaults(backend);
  // `||` not `??`, so a blank left in an old config falls through to the real default.
  return {
    backend,
    model: override.model || inherited?.model || fallback.model,
    effort: override.effort || inherited?.effort || fallback.effort,
  };
}

// Modes and effort scales are backend-specific and asymmetric (BACKEND_CAPS). A selection
// carried across a backend switch may name a value the new backend does not publish; clamp
// it so the dock never highlights a control that isn't there.
export function clampToCaps(choice: CopilotChoice, mode: string): { mode: string; effort: string } {
  const caps = backendCaps(choice.backend);
  const defaults = backendDefaults(choice.backend);
  return {
    mode: caps.modes.some((m) => m.value === mode) ? mode : caps.modes[0].value,
    effort: caps.efforts.some((e) => e.value === choice.effort) ? choice.effort : defaults.effort,
  };
}

export function isOverridden(override: Partial<CopilotChoice>): boolean {
  return override.backend !== undefined || override.model !== undefined || override.effort !== undefined;
}
