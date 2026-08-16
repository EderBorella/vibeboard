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
  // The dock and the auto-pilot bar are dense rows; Settings is a form with room. Same control, two
  // scales — this is the only thing the three call sites disagreed about while each kept its own copy
  // of the markup, and Settings' copy had drifted to a different label for the same backend.
  size?: 'sm' | 'md';
}

// THE ONE BACKEND SELECTOR. Three surfaces choose between the same two agents — the copilot dock, the
// auto-pilot bar and Settings — and until this existed each rendered its own button group from its own
// list. They had already diverged: Settings named the first backend "Claude Code" and the dock named it
// "Claude", so the same setting read as two different things depending on where you changed it.
//
// It renders the list and nothing else. WHAT a change means is the caller's — a session override in the
// dock, a write to the project config in the bar — because those are genuinely different acts, and a
// component that decided between them would be the place the difference gets lost.
export function BackendPicker({ value, onChange, label, disabled = false, titleFor, size = 'sm' }: Props) {
  return (
    <div
      className={`backend-toggle${size === 'md' ? ' backend-toggle-md' : ''}`}
      role="group"
      aria-label={label}
    >
      {BACKENDS.map((b) => (
        <button
          key={b.value}
          type="button"
          className={`bt-btn${value === b.value ? ' active' : ''}`}
          disabled={disabled}
          title={titleFor?.(b)}
          onClick={() => onChange(b.value)}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
