import { Tabs } from '../../molecules/Tabs';
import { BACKENDS } from './format';

interface Props {
  value: string;
  onChange: (backend: string) => void;
  // The group's accessible name. It differs per site because the surrounding words do — the dock is
  // labelled by the panel it sits in, the auto-pilot bar has no heading of its own to borrow.
  label: string;
  disabled?: boolean;
  // Per-site hover text, because the CONSEQUENCE differs and the control does not. Switching in the
  // dock starts a new chat and touches nothing on disk; switching in the auto-pilot bar rewrites the
  // project default and moves the copilot and manual dispatches with it. One shared sentence would
  // have to be vague enough to be true of both, which is how a control comes to promise nothing.
  titleFor?: (backend: { value: string; label: string }) => string;
  // NO `size` ANY MORE. `.vb-seg-cell-sm` was `--t-micro` on the two dense rows, and an 11px cell in a
  // 12px row is the shape of the 10.88px incident this design system has ruled on twice. One face.
}

// THE ONE BACKEND SELECTOR. Three surfaces choose between the same two agents — the copilot dock, the
// auto-pilot bar and Settings — and until this existed each rendered its own button group from its own
// list. They had already diverged: Settings named the first backend "Claude Code" and the dock named it
// "Claude", so the same setting read as two different things depending on where you changed it.
//
// It renders the list and nothing else. WHAT a change means is the caller's — a session override in the
// dock, a write to the project config in the bar — because those are genuinely different acts, and a
// component that decided between them would be the place the difference gets lost.
export function BackendPicker({ value, onChange, label, disabled = false, titleFor }: Props) {
  // The per-site hover text is computed here and carried on the item, because `titleFor` is this
  // component's contract and the primitive's is a plain list.
  const items = BACKENDS.map((b) => ({ value: b.value, label: b.label, title: titleFor?.(b) }));
  return <Tabs grouped items={items} value={value} onChange={onChange} label={label} disabled={disabled} />;
}
