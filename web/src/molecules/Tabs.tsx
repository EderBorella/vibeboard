import { Fragment, type ReactNode } from 'react';
import { Button } from '../atoms/Button';
import { Chip } from '../atoms/Chip';
import { Icon } from '../atoms/Icon';

// TABS — a row of mutually-exclusive cells where the SURFACE STAYS. Four families were this: the dock's
// utility panes, the open cards, the editor's Fields/Edit/Preview, and the segmented value pickers.
//
// THE LINE BETWEEN THIS AND `Menu`, said here so a future surface does not have to guess: a Tab switches
// what you are LOOKING AT and the surface stays; a Menu takes you SOMEWHERE ELSE. They differ in
// behaviour and not only in looks — a menu may navigate and dismiss, a tab never dismisses anything —
// which is why they are two components with two consumers each rather than one with a seventh option.
//
// WHAT THE FOUR FAMILIES DISAGREED ABOUT, AND WHICH ANSWER WON. `.dock-tab` was uppercase, tracked and
// went `--text` when selected; `.control-tabs button` was plain, sat on `--panel-2` and went `--accent`
// on the border; `.cards-tab` put the selected ink on its CHILD and the border on its parent; the
// segmented cells inverted to `--accent-fill`. One selected state survives — `--text` ink on `--panel-2`
// with a visible edge, which is the dock's — because it is the only one of the four that reads as
// "selected" without also reading as "primary". The display face and the uppercase go: `--font-display`
// on a 12px cell was a treatment two of the four had and two did not, and the tracking made the dock's
// row wider than the words in it.
//
// `grouped` IS THE ONLY SHAPE VARIANT, and it is the one the segmented control earned: the GROUP owns one
// border and one corner and clips its cells, so there is no seam down the middle. The group declares
// `--ctl-h` and the cells stretch into it, which is why the browser harness measures the group as the
// control and a cell as 2px shorter — its own edge is inside the 28px.
//
// THE `sm` SIZE IS GONE. `.vb-seg-cell-sm` was `--t-micro` on the dense rows, and an 11px cell in a 12px
// row is the shape of the 10.88px incident this design system has already ruled on twice.
export interface TabItem {
  value: string;
  label: ReactNode;
  // Per-item hover text. The mode groups carried one per option and the backend picker computed one per
  // site, so it belongs on the item rather than on the strip.
  title?: string;
  // A count of what is IN FRONT OF YOU — the dock's unread pane badge. `Chip pill fill`, which is what
  // the dock already rendered; `.tab-badge`'s `--accent-2` ground went with the top row to `Menu`.
  badge?: ReactNode;
}

interface Props {
  items: readonly TabItem[];
  // `null` is a real state: the cards pane opens with no card selected.
  value: string | null;
  onChange: (value: string) => void;
  // The strip's accessible name. It differs per site because the surrounding words do.
  label: string;
  grouped?: boolean;
  // A closable tab gets a bare `✕` beside it. NOT inside it — a button inside a button is invalid and
  // unclickable — so the pair are siblings in the strip and the cell's own 1px transparent edge is what
  // keeps the row from shifting when one appears.
  closable?: boolean;
  onClose?: (value: string) => void;
  // Disables every cell. The backend picker cannot be switched while a run is in flight, which is
  // behaviour rather than a face, so it survives the option cull.
  disabled?: boolean;
  className?: string;
  // Trailing controls that belong to the STRIP rather than to a tab — the dock's collapse toggle, the
  // cards pane's Raw switch. They were already siblings of the cells in all four families.
  children?: ReactNode;
}

export function Tabs({
  items,
  value,
  onChange,
  label,
  grouped = false,
  closable = false,
  onClose,
  disabled = false,
  className,
  children,
}: Props) {
  const strip = ['vb-tabs', grouped && 'vb-tabs-grouped', className].filter(Boolean).join(' ');
  // `group` for a value picker and `tablist` for a view switch, which is the ARIA difference between the
  // two things `grouped` names: a segmented picker chooses a VALUE and its cells are not tabs. What a
  // grouped cell carries in place of `aria-selected` is `aria-pressed` — see the button below.
  return (
    <div className={strip} role={grouped ? 'group' : 'tablist'} aria-label={label}>
      {items.map((item) => (
        // A FRAGMENT AND NOT A WRAPPER, which is what `.cards-tab` was. The box it drew around the pair is
        // gone; what was load-bearing is that the `✕` sits against its own tab and not in the strip's
        // rhythm, and `molecules/tabs.css` does that with an adjacent-sibling margin rather than a class.
        <Fragment key={item.value}>
          <button
            type="button"
            role={grouped ? undefined : 'tab'}
            aria-selected={grouped ? undefined : item.value === value}
            // AND THE GROUPED CELL SAYS SO TOO. Dropping `aria-selected` from a value picker is right —
            // its cells are not tabs — but nothing was put in its place, so the chosen option of every
            // segmented picker in this app was carried by a CLASS and a fill alone, and was invisible to
            // a screen reader. `aria-pressed` is the toggle-button state, which is what a cell in a
            // `role="group"` of buttons actually is, and it changes nothing on screen.
            aria-pressed={grouped ? item.value === value : undefined}
            className={item.value === value ? 'vb-tab active' : 'vb-tab'}
            disabled={disabled}
            title={item.title}
            onClick={() => onChange(item.value)}
          >
            <span className="vb-clip">{item.label}</span>
            {item.badge !== undefined && (
              <Chip pill fill className="vb-readout" testId="tab-badge">
                {item.badge}
              </Chip>
            )}
          </button>
          {closable && (
            <Button
              variant="bare"
              size="sm"
              // THE ATTRIBUTE IS THE SELECTOR, and it is here so `molecules/tabs.css` can pull the `✕`
              // against its own cell without a wrapper class. `.vb-tab + .vb-btn-bare` matched ANY bare
              // button following a cell — the dock's collapse toggle is exactly that, passed as
              // `children` — so a strip-level control took a per-tab pull. `check:class-budget` counts
              // class selectors, so this costs nothing and the rule says what it means.
              data-tab-close=""
              title={`Close ${item.value}`}
              onClick={() => onClose?.(item.value)}
            >
              <Icon name="close" />
            </Button>
          )}
        </Fragment>
      ))}
      {children}
    </div>
  );
}
