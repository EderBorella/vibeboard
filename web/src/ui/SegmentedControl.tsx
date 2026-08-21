export interface SegmentedItem {
  value: string;
  label: string;
  // Per-item hover text. The mode groups already carried one per option and the backend picker computed
  // one per site, so it belongs on the item rather than on the group.
  title?: string;
}

interface Props {
  items: readonly SegmentedItem[];
  value: string;
  onChange: (value: string) => void;
  // The group's accessible name. It differs per site because the surrounding words do.
  label: string;
  // Two scales and no more: `md` is the default because it is what three of the four call sites already
  // rendered — the two mode groups and the backend picker in Settings, which reached it through a
  // `.backend-toggle-md` modifier whose declarations were `.mode-btn`'s exactly.
  size?: 'sm' | 'md';
  disabled?: boolean;
}

// A SEGMENTED CONTROL, AND IT WAS FOUR CLASSES SAYING ONE THING. `.mode-group` and `.backend-toggle` were
// byte-identical — `display: flex; border: 1px solid var(--border); border-radius: var(--r-md);
// overflow: hidden` — and `.mode-btn` and `.bt-btn` were identical too, declaration for declaration, apart
// from one size step. The proof that the difference was a size and not a shape was already in the file:
// `.backend-toggle-md .bt-btn` restated `.mode-btn`'s padding and font-size verbatim.
//
// WHY THIS EARNS A PRIMITIVE ON TWO CELL CLASSES when `Button`'s fifth variant needed twelve: the
// evidence is not the count, it is that the classes were already the same declarations under two names,
// with a modifier in the stylesheet asserting the equality. `Chip` gained `fill` on four.
//
// THE GROUP OWNS THE BORDER AND THE CORNER AND EACH CELL HAS NEITHER, which is the reason Phases 3 and 4
// both refused to make these `Button`s: every Button variant gives the cell its own border and radius,
// which puts a seam down the middle of the group. Here the group draws one box and clips its children.
//
// It renders the list and nothing else. What a change MEANS is the caller's — a session override in the
// dock, a write to the project config in the bar — because those are genuinely different acts.
export function SegmentedControl({ items, value, onChange, label, size = 'md', disabled = false }: Props) {
  const cell = size === 'sm' ? 'vb-seg-cell vb-seg-cell-sm' : 'vb-seg-cell';
  return (
    <div className="vb-seg" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={value === item.value ? `${cell} active` : cell}
          disabled={disabled}
          title={item.title}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
