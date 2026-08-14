import { useEffect, useRef, useState } from 'react';
import { type LightState, lightAdvice } from './connection-light';

// The light, as a button. Clicking it explains the state and says what to do about it.
//
// A TOOLTIP WAS NOT ENOUGH, and that is the whole reason this exists: `title` needs a hover, so it is
// unreachable on a touch device, invisible to anyone who does not know to try, and impossible to read
// slowly or copy out of. The one state whose text you most need — the refusal naming a missing
// dependency — is also the longest, and a tooltip truncates it.
//
// The `title` stays anyway. It costs nothing, it is what a keyboard user's focus ring surfaces, and it
// makes the state legible without a click for the people who do hover.
export function ConnectionLight({
  light,
  title,
  agentRefusal,
}: {
  light: LightState;
  title: string;
  agentRefusal: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const advice = lightAdvice(light, agentRefusal);

  // Escape and click-outside, both, and only while open — an app-wide listener that exists whether or
  // not anything is showing is a listener nobody remembers is there.
  //
  // `mousedown`, not `click`: a click that begins outside and ends inside (a drag, a text selection that
  // overshoots) would otherwise close the balloon out from under the pointer. Capture phase so it wins
  // over anything that stops propagation on the way up.
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
    <span className="conn-wrap" ref={wrap}>
      <button
        type="button"
        className={`conn-status conn-${light}`}
        title={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="conn" />
        <span className="conn-text">{light}</span>
      </button>
      {open && (
        <div className="conn-pop" role="dialog" aria-label={advice.heading}>
          <h3 className="conn-pop-head">{advice.heading}</h3>
          <p className="conn-pop-detail">{advice.detail}</p>
          {advice.next && <p className="conn-pop-next">{advice.next}</p>}
        </div>
      )}
    </span>
  );
}
