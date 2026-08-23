import {
  backendCaps,
  backendDefaults,
  type CopilotChoice,
  type CopilotConfig,
  DEFAULT_BACKEND,
} from '../../lib/shared';

// Accepts the legacy single-slot shape too, so a config not yet migrated still resolves.
type Configured = Pick<CopilotConfig, 'backend'> & Partial<Omit<CopilotConfig, 'backend'>>;

// The client half of copilot selection. Deliberately mirrors src/core/copilot-choice.ts
// rather than importing it: web/ is bundler-resolved and src/ is NodeNext with mandatory
// .js extensions, so the two live on opposite sides of that boundary (see web/src/lib/shared.ts).
// test/copilot-choice-web.test.ts asserts the two agree on the shared cases.

// Precedence: override → the backend's own saved slot → the backend's built-in default.
// Reading the slot FOR THE BACKEND IN FORCE is what makes switching connector non-destructive:
// it can never hand OpenCode a Claude model id, and never discards the other backend's choice.
export function resolveChoice(
  configured: Configured | undefined,
  override: Partial<CopilotChoice>,
): CopilotChoice {
  const backend = override.backend || configured?.backend || DEFAULT_BACKEND;
  // An unmigrated config's single pair describes the backend selected when it was written.
  const legacy =
    backend === configured?.backend ? { model: configured?.model, effort: configured?.effort } : undefined;
  const saved = configured?.backends?.[backend] ?? legacy;
  const fallback = backendDefaults(backend);
  // `||` not `??`, so a blank left in an old config falls through to the real default.
  return {
    backend,
    model: override.model || saved?.model || fallback.model,
    effort: override.effort || saved?.effort || fallback.effort,
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

// Whether the dock is actually running something other than the project default. Compares the
// RESOLVED selections rather than asking "is any override field set": switching connector away
// and back leaves `{backend}` set while changing nothing, and claiming a session override in
// that state reads as the UI losing track of itself.
export function isOverridden(configured: Configured | undefined, override: Partial<CopilotChoice>): boolean {
  const now = resolveChoice(configured, override);
  const base = resolveChoice(configured, {});
  return now.backend !== base.backend || now.model !== base.model || now.effort !== base.effort;
}
