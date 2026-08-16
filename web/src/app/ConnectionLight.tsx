import { Popover } from '../ui/Popover';
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
  const advice = lightAdvice(light, agentRefusal, refusalKind, recentFailure);
  return (
    <Popover
      label={advice.heading}
      triggerClassName={`conn-status conn-${light}`}
      triggerTitle={title}
      className="conn-pop"
      trigger={
        <>
          <span className="conn" />
          <span className="conn-text">{light}</span>
        </>
      }
    >
      <h3 className="conn-pop-head">{advice.heading}</h3>
      <p className="conn-pop-detail">{advice.detail}</p>
      {advice.next && <p className="conn-pop-next">{advice.next}</p>}
    </Popover>
  );
}
