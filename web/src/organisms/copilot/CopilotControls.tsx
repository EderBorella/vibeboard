import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Stack } from '../../atoms/Stack';
import type { ModelOption } from '../../lib/api';
import type { BackendCaps } from '../../lib/shared';
import { Tabs } from '../../molecules/Tabs';
import { ModelPicker } from '../shared/ModelPicker';

interface Props {
  // Modes and efforts are backend-specific; the caller passes the caps of the backend in force.
  caps: BackendCaps;
  // Already clamped to `caps` by the caller — these are what the dock highlights.
  effMode: string;
  effEffort: string;
  effModel: string;
  defaultModel: string;
  models: ModelOption[];
  running: boolean;
  onMode: (m: string) => void;
  onModel: (m: string) => void;
  onEffort: (e: string) => void;
  onCompact: () => void;
}

// Mode buttons, Compact, and the model/effort selects.
export function CopilotControls({
  caps,
  effMode,
  effEffort,
  effModel,
  defaultModel,
  models,
  running,
  onMode,
  onModel,
  onEffort,
  onCompact,
}: Props) {
  return (
    <>
      <Stack wrap pad={[4, 5]} edge="bottom">
        <Tabs
          grouped
          items={caps.modes.map((m) => ({ value: m.value, label: m.label, title: m.hint }))}
          value={effMode}
          onChange={onMode}
          label="Mode"
          disabled={running}
        />
        {/* `Button` `default` `sm`, which `.copilot-actions button` had written out value for value.
            `push` is all that is left of the wrapper it sat in: a flex row with one child and a gap
            that separated nothing, whose other declaration was `margin-left: auto`. */}
        <Button className="push" onClick={onCompact} disabled={running} title="Compact the conversation">
          Compact
        </Button>
      </Stack>

      {/* `align="stretch"`: this row named no `align-items`, so its two selects fill its height. */}
      <Stack align="stretch" pad={[0, 5, 4]} className="copilot-selects">
        <ModelPicker
          models={models}
          value={effModel}
          defaultModel={defaultModel}
          disabled={running}
          onChange={onModel}
        />
        {/* NOT a `Field`: the dock's control row carries no labels at all, and one label on one of its
            two controls would read worse than none. The box is the primitive's. */}
        <Control as="select" value={effEffort} disabled={running} onChange={(e) => onEffort(e.target.value)}>
          {caps.efforts.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </Control>
      </Stack>
    </>
  );
}
