import { type AutopilotConfig, LIFECYCLE_MODES } from '../../lib/shared';
import { Tabs } from '../../molecules/Tabs';

interface Props {
  // The whole block rather than the mode alone, and `null` where a project has none. A project written
  // before the lifecycle existed has no block to write a key into, and auto-pilot refuses to start there
  // anyway — so this renders nothing rather than offering a choice that cannot be saved.
  config: AutopilotConfig | null;
  onChange: (mode: string) => void;
  disabled?: boolean;
}

// HOW COARSELY AUTO-PILOT BREAKS WORK DOWN. Its own component for the reason `BackendPicker` is: this is
// the second project-level choice the bar owns, the two are written the same way, and a segmented picker
// rendered inline was what took `AutopilotBar` past the complexity ceiling.
//
// `Tabs grouped`, the same primitive the backend picker uses, because two adjacent choices on one strip
// should not be two shapes.
//
// The titles carry the TRADE rather than a description, because that is the whole of the decision. Express
// was measured against standard on the same README and the same backend: 24 runs against 80, $14.06 against
// $41.07, 12 cards against 39, with a product that passes its smoke test either way.
export function LifecyclePicker({ config, onChange, disabled = false }: Props) {
  if (!config) return null;
  const items = LIFECYCLE_MODES.map((mode) => ({
    value: mode,
    label: mode === 'express' ? 'Express' : 'Standard',
    title:
      mode === 'express'
        ? 'One feature card listing the plan, one story per bullet, one task per story. Measured at roughly a third of the runs, cost and time on a small project — what it trades away is granularity.'
        : 'One card per capability, one story per acceptance criterion. More cards, more verification steps, more cost.',
  }));
  return (
    <Tabs
      grouped
      label="How coarsely auto-pilot breaks work down"
      value={config.mode}
      disabled={disabled}
      onChange={onChange}
      items={items}
    />
  );
}
