import { StatusChip } from '../ui/StatusChip';
import { type LightState, lightAdvice, type RecentFailure, type RefusalKind } from './connection-light';

// The light, as a button that explains itself.
//
// A TOOLTIP WAS NOT ENOUGH, and that is the whole reason this exists: `title` needs a hover, so it is
// unreachable on a touch device, invisible to anyone who does not know to try, and impossible to read
// slowly or copy out of. The one state whose text you most need — the refusal naming a missing
// dependency — is also the longest, and a tooltip truncates it.
//
// The `title` stays anyway. It costs nothing, it is what a keyboard user's focus ring surfaces, and it
// makes the state legible without a click for the people who do hover.
//
// The panel BEHAVIOUR lives in ui/Popover. What is specific here is what it says, and that comes from
// `lightAdvice` — pure, and tested without a DOM.
export function ConnectionLight({
  light,
  title,
  agentRefusal,
  refusalKind,
  recentFailure,
}: {
  light: LightState;
  title: string;
  agentRefusal: string | null | undefined;
  // Which cause the server named. Carried alongside the sentence rather than sniffed out of it: the
  // sentence is the server's to word and may be reworded there without this component noticing.
  refusalKind?: RefusalKind | null;
  // What already went wrong, so the balloon can quote the harness. Carried for the same reason as
  // `refusalKind` and refusing nothing — see `lightFor`.
  recentFailure?: RecentFailure | null;
}) {
  return (
    // A `StatusChip`, AND IT IS THE FIRST OF THE FOUR — this is the one the other three were made to look
    // like, because it was the only one that already explained itself on a click. What it gives up is its
    // own box: `.conn-status` declared a border, a padding, a background and a font-size of its own, which
    // was four decisions about a shape three other indicators were also making separately. See
    // ui/StatusChip.tsx for the census.
    //
    // THE STATE IS STILL AN ATTRIBUTE and not a class built at run time from `conn-${light}`. Six classes
    // lived only inside that template string, so a literal grep for any of them found nothing and all six
    // looked dead — the exact defect the *Risks* section of docs/design-system.md describes, and the worst
    // possible shape for one: deleting them breaks the colour that tells you the connection has dropped,
    // and nothing else. `StatusChip` passes it through `triggerState`, which sets the attribute and the
    // tone class from the one table.
    <StatusChip
      state={light}
      // THE HALO IS THIS SURFACE'S, and it is the reason `glow` is a prop rather than a tone: the app's
      // own health is one of the two things in the app worth one, and `--glow` is `none` in two themes.
      dot={12}
      glow={light === 'online'}
      // A FIXED 12ch BOX, sized to the longest name the light can report, and it is a claim about THIS
      // row rather than about a status chip: the indicator sits left of the tabs, so a label that resized
      // with its text would shove the whole tab row sideways on every reconnect.
      word={<span className="conn-text">{light}</span>}
      advice={lightAdvice(light, agentRefusal, refusalKind, recentFailure)}
      title={title}
      className="conn-status"
      testId="conn-status"
    />
  );
}
