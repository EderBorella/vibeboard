import { useEffect, useRef, useState } from 'react';
import type { CopilotChoice, CopilotConfig } from './shared';
import { resolveChoice, isOverridden } from './copilot/choice';

// One source of truth for the defaults: the project config, written ONLY by Settings.
// The dock's controls are a session override — they never touch the file, so switching
// connector for one conversation can't rewrite what you configured.
export function useCopilotChoice(
  configured: CopilotConfig | undefined,
): {
  choice: CopilotChoice;
  overridden: boolean;
  setModel: (m: string) => void;
  setEffort: (e: string) => void;
  setBackend: (b: string) => void;
  reset: () => void;
} {
  const [override, setOverride] = useState<Partial<CopilotChoice>>({});

  // A Settings save is an explicit statement of intent, so it clears the session override —
  // otherwise a stale dock value would keep winning over the defaults you just changed.
  // Covers the whole block, per-backend slots included — a save that changes only the slot for
  // some backend still has to clear the override, or the dock keeps overriding what you meant
  // to change.
  const configKey = JSON.stringify(configured ?? null);
  const lastConfigKey = useRef(configKey);
  useEffect(() => {
    if (lastConfigKey.current === configKey) return;
    lastConfigKey.current = configKey;
    setOverride({});
  }, [configKey]);

  // Precedence lives in one place, shared with Settings and mirrored on the server.
  const choice = resolveChoice(configured, override);

  return {
    choice,
    overridden: isOverridden(configured, override),
    setModel: (model: string): void => setOverride((o) => ({ ...o, model })),
    setEffort: (effort: string): void => setOverride((o) => ({ ...o, effort })),
    // Switch connector for THIS SESSION only — the configured default is untouched. Model and
    // effort drop out of the override too: they belong to the backend being left. Starting the
    // fresh chat that a backend switch implies is the caller's job, not this hook's.
    setBackend: (backend: string): void => {
      if (backend === choice.backend) return;
      setOverride({ backend });
    },
    reset: (): void => setOverride({}),
  };
}
