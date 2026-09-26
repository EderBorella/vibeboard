import { AUTOPILOT_CONCURRENCY } from '../core/autopilot.js';
import type { AutopilotState } from '../core/autopilot-state.js';
import { criterionToCheck } from '../core/satisfied.js';
import type { Card } from '../core/types.js';
import { commandFailed } from '../core/verify.js';
import { runCommand } from '../exec/commands.js';
import { headRevision } from '../exec/git-work.js';
import type { RunOne } from '../exec/verify.js';
import type { DeclaredCommands } from '../store/project/foundation.js';
import type { BoardClient } from './board-client.js';

// RUNNING A STORY'S ACCEPTANCE CRITERION BEFORE ANYTHING IS DISPATCHED (decision 85). The rule about WHICH
// command that is lives in `core/satisfied.ts` and is read from both ends; this is the half that spawns,
// and it holds no decisions of its own beyond "is it worth spawning at all".
//
// IN THIS PROCESS, like the gates and the smoke command, and for the same reason (rule 3 in act.ts):
// putting arbitrary command execution behind an HTTP endpoint would be a far larger hole than the one it
// closes.
//
// FOUR REFUSALS, EACH SILENT, and silence is the right answer for all four because the fallback is the
// behaviour this project had before the check existed — the story is broken down, nothing is lost, and
// nothing about a criterion that could not be measured is a reason to stop a project:
//
//   a run already in flight   the tick's own next act is then `wait`, so the measurement is bought and
//                             thrown away — and it is taken while an agent is editing the tree, against a
//                             HEAD its uncommitted edits are not in, so the wrong answer is then CACHED.
//                             `AUTOPILOT_CONCURRENCY` is read here rather than restated, because the whole
//                             argument is that this is the same threshold the tick waits on;
//   an unread gate document   the command comes out of `foundation/CODE-QUALITY.md`, and decision 51's
//                             refusal is in front of every spawn that reads it — an agent may have
//                             rewritten it and nobody has looked;
//   no readable HEAD          with nothing to key an answer against, the check would run the project's
//                             whole suite on every tick, which costs far more than it saves;
//   no candidate              a board with no open story, a story with tasks, a card naming nothing or
//                             naming something the project does not declare as a gate.
//
// AND ONE THING IT IS NOT SILENT ABOUT: a command that is about to be spawned, and one that has answered
// no. Both go in the diary — see `passes` below.

export interface SatisfiedWorld {
  cards: Card[];
  commands: DeclaredCommands;
  // The focused feature, which is the one thing that changes WHICH story is open (decision 73). Carried
  // in rather than read here: the loop already holds the config the tick is given.
  focus?: string;
  // THE RUNS QUEUED OR RUNNING RIGHT NOW, exactly the list the tick is handed, so the two read one fact.
  //
  // REQUIRED RATHER THAN OPTIONAL, for the reason `TickInput.satisfied` is required: an absent field would
  // read as "nothing is running", which switches the first refusal above off for every caller at once and
  // leaves no board state saying it happened.
  inFlight: { card?: string; skill: string }[];
}

export interface SatisfiedDeps {
  root: string;
  // THE DIARY, and it is not decoration. This is the only thing in the loop that can occupy ten minutes of
  // wall clock without producing a run record, an accounting entry or a card movement — so the one place
  // both a person and the checkup read is where it says what it is doing. Required, like `StampDeps.client`:
  // a diary write a caller can forget is one that will be forgotten.
  client: Pick<BoardClient, 'log'>;
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
  // BEFORE THE SPAWN, because the spawn is what a person is waiting through. A project whose gate suite
  // takes eight minutes has, at this line, no run in flight, no dispatch, no accounting movement and no
  // diary entry — it looks frozen, and the thing that would explain it is a command nobody can see. The
  // stdio line further down does not serve: `service-process.ts` gives this process stdout `ignore` unless
  // the debug setting is on, and even then it goes to a log file rather than to anyone watching.
  await deps.client.log(
    'lifecycle',
    `Measuring ${wanted.card}'s acceptance criterion before its break-down: \`${wanted.command}\`.`,
    { card: wanted.card },
  );
  const result = await (deps.run ?? runCommand)(wanted.command, { cwd: deps.root });
  const passed = !commandFailed(result);
  measured.answers.set(wanted.command, passed);
  // AND AFTERWARDS ONLY WHERE IT DID NOT HOLD, because the other answer already has a line: a criterion
  // that passes closes the story through `story-satisfied`, and `stamp.ts` writes the move and its reason
  // in the same tick. One that fails moves nothing — so without this the command ran, spent the wall
  // clock, and left the diary saying a break-down simply happened.
  if (!passed) {
    await deps.client.log(
      'lifecycle',
      `${wanted.card}'s acceptance criterion \`${wanted.command}\` does not pass yet, so it is being broken down as usual.`,
      { card: wanted.card },
    );
  }
  // Only where something actually ran. A line on every tick would say the same thing 240 times about a
  // command nobody spawned. Kept alongside the diary rather than replaced by it: this is what a hand-run
  // of `node dist/service/main.js` prints, which is the one case stdout goes anywhere a person is looking.
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
// and a tick that changed nothing leaves it where it was.
//
// WHAT IT CANNOT SEE IS AN EDIT NOTHING COMMITS, and the limit here used to be written as "a person editing
// the tree by hand", which understated the reachable set badly. The server admits `maxConcurrentRuns` runs
// and only the loop's own are held to `AUTOPILOT_CONCURRENCY`, so a run a person or the copilot started was
// free to be rewriting the tree at the exact moment a criterion was measured — and because uncommitted work
// does not move HEAD, the answer then OUTLIVED the edits that falsified it. That case is refused rather than
// documented now: the first refusal in the list above declines to measure while anything is in flight.
//
// What is left is an edit by something that is not a run at all — a person in their editor, or a tool
// writing beside the project. The answer is re-taken the next time anything commits, and what bounds the
// window is that a candidate is normally answered on the first tick it appears: a story either closes or is
// broken down.
export function satisfiedChecker(deps: SatisfiedDeps): (world: SatisfiedWorld) => Promise<string[]> {
  const measured: Measured = { answers: new Map() };
  return async (world) => {
    // FIRST, so that nothing below is paid for on a tick that is going to wait. The comparison is the
    // tick's own, against the tick's own constant, because the argument for it is precisely that the two
    // are the same question asked a moment apart.
    if (world.inFlight.length >= AUTOPILOT_CONCURRENCY) return [];
    const wanted = criterionToCheck(world.cards, world.commands, world.focus);
    if (wanted === undefined) return [];
    const head = await measurableAt(deps);
    if (head === undefined) return [];
    return (await passes(deps, measured, head, wanted)) ? [wanted.card] : [];
  };
}
