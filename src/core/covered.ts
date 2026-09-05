import type { AutopilotConfig } from './autopilot.js';
import { isSettled } from './derived-status.js';
import { liveCards } from './hierarchy.js';
import type { Card } from './types.js';

// WORK THAT IS ALREADY DONE, AND WHETHER THE CLAIM CAN BE BELIEVED.
//
// `decision 43` refuses to advance a creating phase whose board did not grow, whatever the run reported.
// That rule exists because agents claimed to have created cards they had not, and it is right. What it
// leaves no room for is the truthful version of the same sentence: *I created nothing, because the work
// already exists*. A break-down cannot close a card by finding nothing to do, so `recordEmptyCreate`
// burns an attempt, three times, and the loop stops on a card whose job was finished before it was
// written.
//
// Observed rather than imagined: on a greenfield project the machine's own smoke-harness feature was
// created after a smoke command had already been declared and exercised, and its three break-down runs
// each reported "every claim this card makes is already true" and each named the cards that had done it.
// A separate story was blocked the same way, citing the file and line of the test a sibling had written.
//
// THE CLAIM IS ACCEPTED ONLY WHERE IT IS CHECKABLE, which is the whole of the difference from what
// decision 43 refuses. A report names CARD IDS; this verifies each one exists on the board and is
// settled. An id that does not exist, or one still open, fails the check and the run is treated exactly
// as an empty create — so a run that invents a citation is no better off than one that says nothing.
//
// NOT REQUIRED TO BE UNDER THE CARD, deliberately. The case that produced this had the work sitting under
// a DIFFERENT feature: the harness feature's job had been done by the feature the models derived from the
// README. Requiring a parent link would refuse the only real example there is.
export function coveredBy(ap: AutopilotConfig, cards: Card[], claimed: string[]): boolean {
  // An empty claim is not a claim. `[].every()` is true, and a report with `covered: []` would otherwise
  // advance a card having cited nothing — the vacuous pass this codebase has been bitten by before.
  if (claimed.length === 0) return false;
  const live = liveCards(cards);
  return claimed.every((id) => {
    const card = live.find((c) => c.id === id);
    return card !== undefined && isSettled(ap, card);
  });
}
