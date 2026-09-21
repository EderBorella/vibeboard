import type { AutopilotState } from '../core/autopilot-state.js';
import { criterionToCheck } from '../core/satisfied.js';
import type { Card } from '../core/types.js';
import { commandFailed } from '../core/verify.js';
import { runCommand } from '../exec/commands.js';
import { headRevision } from '../exec/git-work.js';
import type { RunOne } from '../exec/verify.js';
import type { DeclaredCommands } from '../store/project/foundation.js';

// RUNNING A STORY'S ACCEPTANCE CRITERION BEFORE ANYTHING IS DISPATCHED (decision 85). The rule about WHICH
// command that is lives in `core/satisfied.ts` and is read from both ends; this is the half that spawns,
// and it holds no decisions of its own beyond "is it worth spawning at all".
//
// IN THIS PROCESS, like the gates and the smoke command, and for the same reason (rule 3 in act.ts):
// putting arbitrary command execution behind an HTTP endpoint would be a far larger hole than the one it
// closes.
//
// THREE REFUSALS, EACH SILENT, and silence is the right answer for all three because the fallback is the
// behaviour this project had before the check existed — the story is broken down, nothing is lost, and
// nothing about a criterion that could not be measured is a reason to stop a project:
//
//   an unread gate document   the command comes out of `foundation/CODE-QUALITY.md`, and decision 51's
//                             refusal is in front of every spawn that reads it — an agent may have
//                             rewritten it and nobody has looked;
//   no readable HEAD          with nothing to key an answer against, the check would run the project's
//                             whole suite on every tick, which costs far more than it saves;
//   no candidate              a board with no open story, a story with tasks, a card naming nothing or
//                             naming something the project does not declare as a gate.

export interface SatisfiedWorld {
  cards: Card[];
  commands: DeclaredCommands;
  // The focused feature, which is the one thing that changes WHICH story is open (decision 73). Carried
  // in rather than read here: the loop already holds the config the tick is given.
  focus?: string;
}

export interface SatisfiedDeps {
  root: string;
  // The gate-document approval, read at the moment the command would run rather than captured — an agent
  // may rewrite the document mid-session, exactly as `ActDeps.state` is read for the gates themselves.
  state: () => Promise<Pick<AutopilotState, 'unreviewedGates'>>;
  // Seams, so every branch here is reachable without spawning a shell or standing in a repository. The
  // spawning is tested where it belongs (exec/commands.ts) and the revision where it belongs (git-work.ts).
  run?: RunOne;
  head?: (root: string) => Promise<string | undefined>;
  log?: (message: string) => void;
}

// WHETHER A COMMAND MAY BE RUN AT ALL, and the tree to key its answer on if it may. Two refusals in one
// function because they answer the same question — "is this measurable right now" — and they are silent for
// the same reason: the fallback is the behaviour this project had before the check existed.
async function measurableAt(deps: SatisfiedDeps): Promise<string | undefined> {
  const unread = (await deps.state()).unreviewedGates;
  if (unread !== undefined && unread.length > 0) return undefined;
  return await (deps.head ?? headRevision)(deps.root);
}

// The answers taken against one tree, and only one: a revision that is no longer HEAD can never be asked
// about again, so clearing on a move is what stops this growing across a long session.
interface Measured {
  at?: string;
  answers: Map<string, boolean>;
}

async function passes(
  deps: SatisfiedDeps,
  measured: Measured,
  head: string,
  wanted: { card: string; command: string },
): Promise<boolean> {
  if (head !== measured.at) {
    measured.at = head;
    measured.answers.clear();
  }
  const known = measured.answers.get(wanted.command);
  if (known !== undefined) return known;
  const result = await (deps.run ?? runCommand)(wanted.command, { cwd: deps.root });
  const passed = !commandFailed(result);
  measured.answers.set(wanted.command, passed);
  // Only where something actually ran. A line on every tick would say the same thing 240 times about a
  // command nobody spawned.
  deps.log?.(
    `${wanted.card}'s criterion \`${wanted.command}\` ${passed ? 'already passes' : 'does not pass yet'}`,
  );
  return passed;
}

// THE ANSWER IS CACHED AGAINST THE TREE IT WAS MEASURED ON, and without that this is unaffordable: a tick
// that stamps or waits dispatches nothing and commits nothing, and `MAX_IDLE_TICKS` allows 240 of those in
// a row. Decision 82's incident is the shape — 57 gate-suite executions inside one 60-tick budget — and it
// halted a project.
//
// HEAD IS THE KEY BECAUSE THE LOOP COMMITS BEFORE EVERY DISPATCH: it moves exactly when work has landed,
// and a tick that changed nothing leaves it where it was. The limit is stated rather than hidden — a
// person editing the tree by hand between two ticks with no dispatch between them is not seen, and the
// answer is re-taken the next time anything commits. What bounds that window is that a candidate is
// normally answered on the first tick it appears: a story either closes or is broken down.
export function satisfiedChecker(deps: SatisfiedDeps): (world: SatisfiedWorld) => Promise<string[]> {
  const measured: Measured = { answers: new Map() };
  return async (world) => {
    const wanted = criterionToCheck(world.cards, world.commands, world.focus);
    if (wanted === undefined) return [];
    const head = await measurableAt(deps);
    if (head === undefined) return [];
    return (await passes(deps, measured, head, wanted)) ? [wanted.card] : [];
  };
}
