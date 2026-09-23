import type { ActResult } from '../loop.js';
import { stamp } from '../stamp.js';
import type { ActDeps, Dispatch } from './index.js';
import { refused } from './refusals.js';

// THE CARDS ONE LEVEL DOWN THAT A DISPATCH DELIVERS (decision 83): a story's implement run and the tasks it
// was asked for, and a story's fix and the tasks its send-back re-opened. Both stamps live here rather than
// beside the two callers, because they are the two halves of one promise — the run is told which tasks are
// its own by where they stand, and those same tasks are delivered together when it completes. Split across
// two files, the second half is the one that gets forgotten.
//
// WHICH COLUMNS came from the tick (`Group` in core/actions.ts). Nothing here decides anything: which slug
// means "being worked" and which means "delivered" is a fact about the machine, and the executor holds no
// decisions of its own.
//
// Both answer `undefined` when there was nothing to do or it all worked, and an `ActResult` — a refusal —
// when a move was refused. Neither throws: the caller is a loop.

// BEFORE THE DISPATCH, and it is the whole of how the run is told what it is for. The prompt names every
// card this story links to with the column it stands in, so a task in `in-progress` is this run's and one
// still in `backlog` is a later run's.
//
// THE COLUMN IS ALL THAT SEPARATES THEM, and that is worth stating exactly rather than claiming more for it:
// `resolveDispatch` resolves EVERY id in `card.links` and `linkedSection` renders each with its file path,
// unfiltered, so the tasks past the ceiling are in front of the agent either way. What the ceiling bounds is
// what the run is asked for and what `deliverGroup` delivers — a sixth task done anyway stays outstanding, and
// the next group pays for it again. The one thing holding the line in the agent's own head is the sentence
// the `implement-story` skill is seeded with, "A task still in `backlog` is a later run's".
//
// ONLY WHERE THE CARD IS NOT THERE ALREADY, the same care `stampEntry` takes over the card itself: a second
// attempt at a group finds its tasks where the first one left them, and a fix finds the tasks its send-back
// re-opened already standing there — re-stamping would write "moved to in-progress" into the diary once per
// attempt for an event that did not happen.
//
// AND NOT ONE ALREADY DELIVERED. The tick forms a group out of tasks that are neither delivered nor settled,
// off the same board read this card came from, so the loop cannot reach this — it holds the claim to its own
// contract for any other caller, which would otherwise pull landed work back into `in-progress` and ask a run
// to do it again, because the guard above compares against `entry` alone.
export async function claimGroup(deps: ActDeps, action: Dispatch): Promise<ActResult | undefined> {
  const group = action.group;
  if (!group) return undefined;
  for (const task of group.cards) {
    if (task.columnSlug === group.entry || task.columnSlug === group.delivered) continue;
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

// AND AFTER IT, TOGETHER — INTO `review`, NEVER `done` (decision 87). The run COMPLETED, which says nothing
// about whether it delivered: the two outcomes an agent may write are treated identically (decision 40), so
// the one that said it could not do the work lands its tasks exactly where the one that did lands them, and
// the story's judgement is what decides. Closing them here is how a story's tasks came to read "done, its
// implement delivered it" over a run that ended `attention` having built nothing.
//
// TOGETHER, because a story is judged once every task under it is delivered or settled, so delivering them
// one tick at a time would leave a window in which the story is half-judgeable — and a loop that died inside
// it would come back to a judgement firing over work no run ever did. One act: every task, or the story does
// not move on and the next tick dispatches the group again.
//
// IT STOPS AT THE FIRST REFUSAL rather than stamping what it can. Both leave a partial board, and this one
// leaves it on the side that is safe — fewer tasks delivered means the story stays unjudgeable, which is the
// state the machine already knows how to recover from: the next dispatch re-forms the group out of whatever
// is still outstanding, and a task already delivered is not in it.
//
// `dispatches` is carried into the refusal because the run HAPPENED: a dispatch reported as none at all is
// how the caps came to be told nothing about a real agent run (see `refused`).
//
// AND NOTHING IS STAMPED WHERE IT ALREADY STANDS, the same care `claimGroup`, `stampEntry`, `recordVerdict`
// and `earnedItsExit` each take at their own end.
export async function deliverGroup(
  deps: ActDeps,
  action: Dispatch,
  dispatches: number,
): Promise<ActResult | undefined> {
  const group = action.group;
  if (!group) return undefined;
  for (const task of group.cards) {
    if (task.columnSlug === group.delivered) continue;
    const stamped = await stamp(
      deps,
      task,
      group.delivered,
      `its story's ${action.skill} run finished; whether the work landed is for the story's review to say.`,
    );
    if (!stamped.ok) {
      return await refused(
        deps,
        `could not deliver ${task.id} to ${group.delivered}`,
        stamped.reason,
        stamped.fatal,
        dispatches,
      );
    }
  }
  return undefined;
}
