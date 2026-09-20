import type { ActResult } from '../loop.js';
import { stamp } from '../stamp.js';
import type { ActDeps, Dispatch } from './index.js';
import { refused } from './refusals.js';

// THE CARDS ONE LEVEL DOWN THAT A DISPATCH DELIVERS (decision 83): a story's implement run and the tasks it
// was asked for. Both stamps live here rather than beside the two callers, because they are the two halves
// of one promise — the run is told which tasks are its own by where they stand, and those same tasks are
// closed together when it succeeds. Split across two files, the second half is the one that gets forgotten.
//
// WHICH COLUMNS came from the tick (`Group` in core/actions.ts). Nothing here decides anything: which slug
// means "being worked" and which means "finished" is a fact about the machine, and the executor holds no
// decisions of its own.
//
// Both answer `undefined` when there was nothing to do or it all worked, and an `ActResult` — a refusal —
// when a move was refused. Neither throws: the caller is a loop.

// BEFORE THE DISPATCH, and it is the whole of how the run is told what it is for. The prompt names every
// card this story links to with the column it stands in, so a task in `in-progress` is this run's and one
// still in `backlog` is a later run's — which is what makes the ceiling in core/lifecycle/tick.ts a real
// bound on what one agent is asked for rather than a bound on the bookkeeping afterwards.
//
// ONLY WHERE THE CARD IS NOT THERE ALREADY, the same care `stampEntry` takes over the card itself: a second
// attempt at a group finds its tasks where the first one left them, and re-stamping would write "moved to
// in-progress" into the diary once per attempt for an event that did not happen.
export async function claimGroup(deps: ActDeps, action: Dispatch): Promise<ActResult | undefined> {
  const group = action.group;
  if (!group) return undefined;
  for (const task of group.cards) {
    if (task.columnSlug === group.entry) continue;
    const stamped = await stamp(
      deps,
      task,
      group.entry,
      `its story's ${action.skill} run is doing the work it asks for.`,
    );
    if (!stamped.ok) {
      return await refused(
        deps,
        `could not move ${task.id} to ${group.entry}`,
        stamped.reason,
        stamped.fatal,
      );
    }
  }
  return undefined;
}

// AND AFTER IT, TOGETHER. A story is judged once every task under it is settled, so settling them one tick
// at a time would leave a window in which the story is half-closed — and a loop that died inside it would
// come back to a story whose judgement fires over work no run ever did. One act: every task, or the story
// does not move and the next tick dispatches the group again.
//
// IT STOPS AT THE FIRST REFUSAL rather than stamping what it can. Both leave a partial board, and this one
// leaves it on the side that is safe — fewer tasks settled means the story stays unjudgeable, which is the
// state the machine already knows how to recover from: the next dispatch re-forms the group out of whatever
// is still outstanding, and a task already settled is not in it.
//
// `dispatches` is carried into the refusal because the run HAPPENED: a dispatch reported as none at all is
// how the caps came to be told nothing about a real agent run (see `refused`).
export async function settleGroup(
  deps: ActDeps,
  action: Dispatch,
  dispatches: number,
): Promise<ActResult | undefined> {
  const group = action.group;
  if (!group) return undefined;
  for (const task of group.cards) {
    const stamped = await stamp(deps, task, group.settled, `its story's ${action.skill} run delivered it.`);
    if (!stamped.ok) {
      return await refused(
        deps,
        `could not settle ${task.id} in ${group.settled}`,
        stamped.reason,
        stamped.fatal,
        dispatches,
      );
    }
  }
  return undefined;
}
