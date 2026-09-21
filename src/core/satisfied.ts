import type { DeclaredCommands } from '../store/project/foundation.js';
import { derivePosition } from './position.js';
import type { Card } from './types.js';

// WHETHER A STORY'S ACCEPTANCE CRITERION IS ONE A MACHINE CAN ALREADY ANSWER (decision 85).
//
// In a 219-dispatch trial four cards asked for work the tree had already done — the lint gate, the types
// gate, the test gate and the smoke card, every one of them satisfied by the scaffold an earlier story
// produced. Each cost a full implement and a full review to discover it was already true: $4.68, 2.5% of
// the project's spend, 8 dispatches. The information was on disk, three commands away.
//
// ONE RULE, READ FROM BOTH ENDS, and that is the whole reason this is a module rather than two conditions.
// `service/satisfied.ts` asks it what to run; `lifecycle/tick.ts` asks it whether a result may close a
// story. Two copies would eventually run one command and close a story on another.
//
// IT NAMES A COMMAND, IT NEVER CARRIES ONE. The card is written by an agent through `POST /api/cards`, so
// nothing here trusts the string: it is answered only when the project itself declares it as a gate in
// `foundation/CODE-QUALITY.md`. A loop that ran what a card told it to would be arbitrary command
// execution as the user — the hole decision 51 closed from the other side, and the same unread-gate-document
// refusal stands in front of this one in the service.
//
// NOT THE SMOKE COMMAND, even though the loop runs that too: ruling 66 already rules that a smoke command
// which is also a gate has exercised nothing, and a break-down is not the place to weaken that.

// The command a story's criterion names, when it is one a machine may run. `undefined` — which is every
// card on every project written before this — means break the story down exactly as before.
//
// THE TASKS DECIDE AS MUCH AS THE CARD DOES. This is a check for BREAK-DOWN CANDIDATES: a story that has
// tasks has been broken down, and running a project's gate suite over it would pay the suite to learn
// nothing. Handing the tasks in rather than asking the caller to remember is what keeps that true of both
// callers.
export function criterionCommand(story: Card, tasks: Card[], commands: DeclaredCommands): string | undefined {
  if (tasks.length > 0) return undefined;
  const named = story.satisfiedBy?.trim();
  if (!named) return undefined;
  // Surrounding whitespace only. `readGates` already trims what the document declares and a card carries
  // whatever its author typed; anything looser — a prefix match, a fold — is the guess that closes a story
  // on a command nobody declared.
  return commands.gates.some((gate) => gate.trim() === named) ? named : undefined;
}

// THE ONE STORY A TICK MAY SPEND A COMMAND ON, for the service that has to run it.
//
// AT MOST ONE, from the position the machine is actually in, and that bound is the cost control rather
// than a tidiness: every story under a feature is childless the moment that feature's break-down returns,
// so a sweep of "every story with no tasks" would run the project's gate suite once per story per commit —
// far more than the eight dispatches this exists to save.
//
// The tick derives the same position from the same board (decision 39), so a disagreement between the two
// can only mean the loop ran a command nothing asked about: the result is then reported for a card the tick
// never consults, and the story is broken down as it always was.
export function criterionToCheck(
  cards: Card[],
  commands: DeclaredCommands,
  focus?: string,
): { card: string; command: string } | undefined {
  const found = derivePosition(cards, focus);
  if (!('position' in found)) return undefined;
  const { story, tasks } = found.position;
  if (story === undefined) return undefined;
  const command = criterionCommand(story, tasks, commands);
  return command === undefined ? undefined : { card: story.id, command };
}
