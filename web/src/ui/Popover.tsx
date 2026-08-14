import { type ReactNode, useEffect, useRef, useState } from 'react';

// A button that reveals a small panel anchored under it.
//
// The SHELL only: opening, dismissing, anchoring and the accessibility wiring. What goes inside is the
// caller's, because the useful thing to share here is the behaviour — every popover gets Escape and
// click-outside wrong in the same three ways, and none of them share a layout.
//
// NOT A MODAL, and that is a decision rather than an omission. A modal takes the screen to say
// something about the screen; these explain or adjust the thing they are attached to, so the context
// has to stay visible behind them. If you need to interrupt, use the modal in AutopilotHelp instead.
export function Popover({
  label,
  trigger,
  triggerClassName,
  triggerTitle,
  className,
  children,
}: {
  // The accessible name of the panel. Announced when it opens, so it should say what the panel is
  // about rather than repeating the button's own text.
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  // Both listeners exist only while open. An app-wide handler that is registered whether or not
  // anything is showing is one nobody remembers is there, and several of them fight.
  //
  // `mousedown` in the CAPTURE phase, not `click`. Two separate reasons and both have bitten real
  // popovers: a click that begins inside and ends outside — a text selection that overshoots — would
  // close the panel being read from; and capture wins over anything that stops propagation on the way
  // up, which is otherwise a panel that cannot be dismissed at all.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open]);

  return (
    <span className="pop-wrap" ref={wrap}>
      <button
        type="button"
        className={triggerClassName}
        title={triggerTitle}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div className={className ? `popover ${className}` : 'popover'} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </span>
  );
}
