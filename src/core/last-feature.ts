import type { AutopilotConfig } from './autopilot.js';
import { isSettled } from './derived-status.js';
import { liveCards } from './hierarchy.js';
import type { Card } from './types.js';

// IS THIS THE LAST FEATURE STILL OPEN — the question `decision 69`'s refusal needs and did not ask.
//
// The smoke command proves the ASSEMBLED product runs. A feature is a part of it, and until the last part
// lands the whole cannot run, so a smoke command consulted at every feature refuses a close that the
// feature's own work could never have earned. `service/act/bootstrap.ts` already says this in as many
// words about the harness feature it creates: *"there is nothing to smoke test before the product
// exists"*, which is why that card is last by construction. The refusal simply did not inherit the rule.
//
// A FEATURE IS THE LAST ONE when every OTHER live feature is settled. For a feature that means DONE and
// only done: `BLOCKED_BOARDS` is product and engineering, so a feature has no blocked column and cannot
// sit in one — a first version of this file reasoned about blocked features and its test caught that the
// case does not exist.
//
// So a feature still in `backlog` makes this false, which is the whole point: F-003 waiting its turn is
// work the product still needs, and the assembled thing cannot run without it.
//
// `liveCards` first, so an archived feature cannot hold the gate open for ever.
// UNDER FOCUS THE QUESTION IS ASKED WITHIN THE FOCUS, and without this the gate would never fire in the one
// mode it matters most. `ap.focus` confines the loop to one feature (core/position.ts), so that feature IS
// the whole of what this run will build — while another feature sitting untouched in the backlog would make
// the count below false for ever, and a failing smoke command would never refuse anything.
export function isLastOpenFeature(ap: AutopilotConfig, cards: Card[], feature: Card): boolean {
  if (ap.focus !== undefined) return ap.focus === feature.id;
  const others = liveCards(cards).filter((c) => c.board === 'features' && c.id !== feature.id);
  return others.every((c) => isSettled(ap, c));
}
