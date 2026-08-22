import { Fragment, type ReactNode } from 'react';
import { Chip } from '../atoms/Chip';
import { Surface } from '../atoms/Surface';

// MENU — a set of mutually-exclusive cells that takes you SOMEWHERE ELSE. Two families were this: the
// five top destinations and the chat session list.
//
// WHY IT IS NOT `Tabs` WITH A SEVENTH OPTION, against the rule that a component must justify itself. A
// menu row's selected item is a LOCATION and its badge is a count on somewhere you are NOT; a tab's
// selected cell is a VIEW and its badge counts what is in front of you. They differ in behaviour and not
// only in looks — a menu may navigate and DISMISS, a tab never dismisses anything — and the ARIA differs
// with them: a destination carries `aria-current`, a tab carries `aria-selected`. Two consumers each,
// which is this project's own floor for a component existing at all.
//
// THE SELECTED STATE IS ACCENT INK, and that is the whole visible difference from a `Tabs` cell: accent
// says "you are here", `--text` on `--panel-2` says "this is the view you are reading". The `--glow` the
// top row wore is gone: a halo on a destination made the header's selected tab the brightest thing on a
// board with work running on it.
export interface MenuItem {
  value: string;
  label: ReactNode;
  title?: string;
  // A count of somewhere you are NOT — runs waiting on a decision, on a destination you are not looking
  // at. `.tab-badge`'s `--accent-2` ground went with it: one badge treatment, which is `Chip pill fill`.
  badge?: ReactNode;
  // A second line under the label, in list orientation: what the chat session list said about each
  // session. Content, so it is the caller's — a relative time and a message count are a `Readout`.
  meta?: ReactNode;
  // A control BESIDE the item rather than inside it — a button inside a button is invalid and
  // unclickable. The chat list's delete glyph, which is the only one. `molecules/menu.css` places it in
  // the second grid column, so it shares a row with the item it acts on and needs no wrapper class.
  trailing?: ReactNode;
}

interface Props {
  items: readonly MenuItem[];
  value: string | null;
  onChange: (value: string) => void;
  // The accessible name of the row or the list.
  label: string;
  // `row` is chrome on a surface; `list` floats under whatever opened it, anchored to its width. A list
  // is the shape that needs dismissing, which is what `onDismiss` renders a backdrop for.
  orientation?: 'row' | 'list';
  // Present only on a list, and its presence is what draws the click-catcher: a floating menu that
  // cannot be dismissed by clicking away is the defect `Popover` exists to have solved once.
  onDismiss?: () => void;
  className?: string;
  // Shown in place of the items when there are none. The chat list's "No saved chats yet".
  children?: ReactNode;
}

export function Menu({
  items,
  value,
  onChange,
  label,
  orientation = 'row',
  onDismiss,
  className,
  children,
}: Props) {
  const list = orientation === 'list';
  const cells = items.map((item) => (
    // A fragment and not a wrapper: in `list` orientation the item and its `trailing` control are two
    // cells of ONE GRID ROW, so an element between them would BE the row and would need a class.
    <Fragment key={item.value}>
      <button
        type="button"
        role={list ? 'menuitem' : undefined}
        // THE DESTINATION ATTRIBUTE, and it is the discriminator the shape census reads: `aria-current`
        // says "this is where you are", `aria-selected` says "this is the pane you are reading".
        aria-current={item.value === value ? 'page' : undefined}
        className={item.value === value ? 'vb-menu-item active' : 'vb-menu-item'}
        title={item.title}
        onClick={() => onChange(item.value)}
      >
        <span className="vb-clip">{item.label}</span>
        {item.meta}
        {item.badge !== undefined && (
          <Chip pill fill className="vb-readout" testId="menu-badge">
            {item.badge}
          </Chip>
        )}
      </button>
      {item.trailing}
    </Fragment>
  ));

  if (!list) {
    return (
      <div className={['vb-menu', className].filter(Boolean).join(' ')} role="group" aria-label={label}>
        {cells}
        {children}
      </div>
    );
  }
  // `raised` for the ground, the edge and the corner — the chat menu was already a `Surface`; what is
  // here is where it sits and how tall it is allowed to get.
  return (
    <>
      {onDismiss && <div className="vb-menu-backdrop" onClick={onDismiss} />}
      <Surface
        variant="raised"
        className={['vb-menu', 'vb-menu-list', className].filter(Boolean).join(' ')}
        role="menu"
        aria-label={label}
      >
        {cells}
        {children}
      </Surface>
    </>
  );
}
