import type { ReactNode } from 'react';
import { Surface } from '../../atoms/Surface';

// MODAL — the one thing on screen. Four surfaces built this by hand: the settings dialog, the auto-pilot
// help, the model picker, the confirm dialog, and the halt overlay that the sign-in prompt borrowed.
// 21 classes, five faces, four z-indexes and three different answers to "what closes it".
//
// A SHARED ORGANISM AND NOT A MOLECULE, because it knows about the app: it takes the alert layer, it
// decides whether clicking away is allowed, and it composes a `Surface` with a head, a body and a foot.
// A molecule is two atoms and at most one piece of behaviour.
//
// THE THREE OPTIONS ARE ATTRIBUTES ON THE ELEMENT rather than classes — see organisms/shared/modal.css
// for why, and it is the class budget rather than taste.
//
// WHAT IT DELIBERATELY DOES NOT OWN: Escape, and focus. Every one of the five callers already handles both
// and they do not agree, because they must not: the halt overlay TRAPS Tab and has no Escape at all (a
// halted project must not be dismissed by a reflex), the confirm focuses Cancel so a stray Enter answers
// "no", and the model picker focuses its search box. Moving that into here would have to pick one, which
// is a behaviour change no phase of this plan asked for. `Popover` owns dismissal because its five
// consumers agree; these five do not.
export type ModalSize = 'sm' | 'md' | 'lg';
export type ModalTone = 'plain' | 'accent' | 'danger';

interface Props {
  // Rendered in the head, beside `head`. A modal with no title has no head row at all — which is what a
  // blocking overlay is: prose in a card, with nothing to click in its top corner.
  title?: ReactNode;
  // Clicking the backdrop. GUARDED ON THE TARGET, and that guard is the whole reason this is one place:
  // two of the four callers put `onClick={onClose}` on the backdrop and cancelled it with a
  // `stopPropagation` on the card, which is the same claim made twice and the shape a dropped
  // `stopPropagation` hides in. Absent on a `blocking` modal, where clicking away is not an answer.
  onClose?: () => void;
  // The measure. `sm` a question, `md` a list you scan, `lg` a form you fill in.
  size?: ModalSize;
  // A colour and an elevation the caller owns: `accent` for the one thing on screen, `danger` for a
  // project that is broken.
  tone?: ModalTone;
  // No dismiss, and the page behind is washed rather than dimmed. The halt overlay and the sign-in
  // prompt: both are the app refusing to continue, not a dialog you answer.
  blocking?: boolean;
  // Above another modal. A confirm can be raised from inside one — SettingsModal renders SandboxPanel,
  // which raises a confirm — so the layer is a property of the ASK and not of the shape.
  alert?: boolean;
  // Controls in the head beside the title: the `✕`, the Close button.
  head?: ReactNode;
  // The foot. Inside the body when the modal has no head, because a dialog whose question and answer are
  // one paragraph does not want a rule between them.
  actions?: ReactNode;
  // A prose treatment on the body, which is the one thing a caller genuinely styles here: the auto-pilot
  // help is four screens of `<h3>`/`<p>` and the body is where that face lands.
  bodyClassName?: string;
  // The card's own measure, where none of the three sizes is it: the auto-pilot help is 44rem of prose.
  // Layout only, and not a padding — the body's inset is `bodyClassName`'s.
  //
  // AND IT CANNOT OUTRANK `data-size` OR `data-tone` ON ITS OWN. That is the whole price of expressing the
  // options as attributes: `.vb-modal[data-size='lg']` is (0,2,0) and a bare `.ap-help` is (0,1,0), so
  // this escape hatch was a dead 44rem and the help card shipped 84px narrower than it asked for. A rule
  // here must be written `.vb-modal.ap-help { … }` to reach (0,2,0) and win on order.
  className?: string;
  role?: 'dialog' | 'alertdialog';
  label?: string;
  labelledBy?: string;
  children?: ReactNode;
}

export function Modal({
  title,
  onClose,
  size = 'lg',
  tone = 'plain',
  blocking,
  alert,
  head,
  actions,
  bodyClassName,
  className,
  role = 'dialog',
  label,
  labelledBy,
  children,
}: Props) {
  const body = ['vb-modal-body', bodyClassName].filter(Boolean).join(' ');
  const foot = actions !== undefined && <div className="vb-modal-foot">{actions}</div>;
  return (
    <div
      className="vb-modal-backdrop"
      data-level={alert || blocking ? 'alert' : undefined}
      data-blocking={blocking ? '' : undefined}
      onClick={
        blocking || !onClose
          ? undefined
          : (e) => {
              if (e.target === e.currentTarget) onClose();
            }
      }
    >
      <Surface
        className={['vb-modal', className].filter(Boolean).join(' ')}
        data-size={size}
        data-tone={tone === 'plain' ? undefined : tone}
        role={role}
        aria-modal="true"
        aria-label={labelledBy === undefined ? label : undefined}
        aria-labelledby={labelledBy}
      >
        {title !== undefined && (
          <div className="vb-modal-head">
            <span className="vb-clip" id={labelledBy}>
              {title}
            </span>
            {head}
          </div>
        )}
        <div className={body}>
          {children}
          {title === undefined && foot}
        </div>
        {title !== undefined && foot}
      </Surface>
    </div>
  );
}
