import type { ReactNode } from 'react';
import { chipClasses } from './Chip';
import { Dot, type DotSize } from './Dot';
import { Popover } from './Popover';
import type { StateName } from './state-tones';

// A STATE, AS A CHIP YOU CAN CLICK FOR THE REST OF THE SENTENCE.
//
// Phase 13 gave the app one state VOCABULARY — five tones, one table, no surface choosing a colour. It
// did not give it one state INDICATOR, and the owner counted what was left: four of them, in one glance
// across two rows of chrome.
//
//   the connection light   a 12px dot, a word, a balloon      `.conn-status`      clickable
//   the auto-pilot chip    a bordered pill, no dot, a tooltip `.ap-chip`          not clickable
//   the agent chip         a 7px dot, a word, sometimes a balloon `.ap-agent-state` clickable when broken
//   the copilot's backend  a dot, a word, and two facts glued on `.copilot-status` not clickable
//
// They agreed on the colour and on nothing else: three sizes, two shapes, and three different answers to
// "where does the explanation live". Two of the four put theirs in a `title` — unreachable on a touch
// device, invisible to anyone who does not know to hover, and truncated on exactly the longest and most
// useful of them. And the agent chip was a button ONLY when something was wrong, which read as a control
// appearing out of nowhere at the worst moment.
//
// SO ALL FOUR ARE THIS, and all four are clickable whatever the state — the owner's ruling, and the right
// one: a control that is only sometimes a control cannot be learned. A healthy state's balloon says why
// it is healthy, which is a real sentence every one of these surfaces already had and was hiding in an
// attribute.
//
// THE BOX IS `Chip`'s, through `chipClasses` rather than through `<Chip>` itself: `Popover` renders its
// own `<button>` — it owns the open state, the Escape key and the click-outside — and the alternative was
// writing `vb-chip vb-chip-pill` out by hand in this file, which is the duplication ui/ exists to end.
//
// THE WORD IS A NODE and not a string, deliberately: the connection light wraps its own in a fixed 12ch
// box so that a reconnect cannot shove the tab row sideways. That is a layout claim about one surface's
// row, it is not a property of a status chip, and a `wordClassName` prop would be the same thing with a
// worse name.
export interface StatusAdvice {
  heading: string;
  detail: string;
  // What to do about it. Absent when there is nothing to do: `online` needs no instruction, and inventing
  // one would imply the state is a problem. Same contract as `LightAdvice`, which is assignable to this.
  next?: string;
}

export function StatusChip({
  state,
  word,
  advice,
  title,
  label,
  dot = 8,
  glow,
  pulse,
  className,
  testId,
}: {
  // A row in ui/state-tones.ts. The tone reaches the ink, the edge and the dot's fill from that one row.
  state: StateName;
  word: ReactNode;
  advice: StatusAdvice;
  // The hover text. Kept alongside the balloon rather than replaced by it: it costs nothing, it is what a
  // keyboard user's focus surfaces, and it makes the state legible without a click for people who hover.
  title?: string;
  // The accessible name of the PANEL. Defaults to the heading, which is what it is about — a caller
  // passes its own only when the heading is too terse to announce on its own.
  label?: string;
  dot?: DotSize;
  // The halo is emphasis and not a tone — see ui/Dot.tsx. Two surfaces spend it: the app's own health
  // and the copilot's backend.
  glow?: boolean;
  pulse?: boolean;
  // Layout, and a surface's own non-geometry treatment. Not a hole for a padding.
  className?: string;
  testId?: string;
}) {
  return (
    <Popover
      label={label ?? advice.heading}
      // `vb-status` carries the one step of size every status chip shares; the tone class and the
      // `data-state` attribute are `Popover`'s, from `triggerState`, so they are not written twice.
      triggerClassName={chipClasses({
        pill: true,
        toned: true,
        className: ['vb-status', className].filter(Boolean).join(' '),
      })}
      triggerTitle={title}
      triggerTestId={testId}
      triggerState={state}
      trigger={
        <>
          {/* NO STATE OF ITS OWN: the trigger carries the tone and the dot's fill inherits it through
              `currentColor`, which is how one row of the table paints a pip and a word together. */}
          <Dot size={dot} glow={glow} pulse={pulse} />
          {word}
        </>
      }
    >
      <strong className="vb-status-head">{advice.heading}</strong>
      <p className="vb-status-detail">{advice.detail}</p>
      {advice.next && <p className="vb-status-next">{advice.next}</p>}
    </Popover>
  );
}
