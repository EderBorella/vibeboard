import { DEFAULT_AUTOPILOT, isBlockedColumn } from '../../core/autopilot.js';
import { unreviewedGatesSentence } from '../../core/autopilot-state.js';
import { latestOwnRun } from '../../core/bounds.js';
import { blockedUnder } from '../../core/derived-status.js';
import { childrenOf } from '../../core/hierarchy.js';
import type { PhaseName } from '../../core/phases.js';
import type { RunRecord } from '../../core/runs.js';
import { BOARDS, type Card } from '../../core/types.js';
import type { Verification } from '../../core/verify.js';
import { verifySmoke } from '../../exec/verify.js';
import type { DispatchRequest } from '../board-client.js';
import type { ActResult, TickContext } from '../loop.js';
import type { ActDeps, Dispatch } from './index.js';
import { stop } from './refusals.js';
import { smokeRanLine } from './sentences.js';

// WHAT A CHECKUP IS TOLD, and the one command the loop runs before it. Also the gate-document refusal, which
// lives here because the smoke command is one of the two spawns it stands in front of — the other is the review's
// gates, which imports it from here rather than repeating the check.

export type CheckupEvidence = NonNullable<DispatchRequest['checkup']>;

// THE TWO CHECKUP PHASES, and only the feature's has a smoke command: the one `foundation/TESTING.md` declares
// exercises the whole feature, and there is no per-story equivalent to run.
export const CHECKUP_PHASES: readonly PhaseName[] = ['story-checkup', 'feature-checkup'];

// EVERYTHING A CHECKUP IS TOLD, gathered here because it cannot fetch any of it (ruling 60). Every card run is
// minted `work` scope: `GET /api/runs` is `service`-only, `GET /api/suggestions` is not `work`'s, and the diary
// has no read row at all. Minting a wider scope would grant an agent authority to solve a problem the loop can
// solve — and the loop already holds every one of these facts.
//
// A read that fails degrades to an EMPTY list rather than to no field. "There is nothing outstanding" is how a
// checkup concludes a project is clean, so the honest failure is to say the list is empty and let the checkup's
// own subject — the cards — still be judged.
export async function checkupEvidence(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  context: TickContext,
): Promise<{ evidence?: CheckupEvidence; refused?: ActResult }> {
  // BEFORE ANY OF THE READS, because for a feature checkup gathering the evidence RUNS A COMMAND, and a
  // command out of a gate document nobody has read does not run (see `refuseWhileGateDocumentUnread`).
  const smoke = await smokeFor(deps, action, context);
  if (smoke.refused) return { refused: smoke.refused };
  const board = await deps.client.board();
  const ap = board.ok ? (board.value.config.autopilot ?? DEFAULT_AUTOPILOT) : DEFAULT_AUTOPILOT;
  const cards = board.ok ? BOARDS.flatMap((b) => board.value.boards[b] ?? []) : [];
  const runs = await deps.client.runs();
  const suggestions = await deps.client.suggestions();
  const children = childrenOf(card, cards).map((child) => ({
    id: child.id,
    column: child.columnSlug,
    // HOW ITS OWN WORK LAST ENDED, read off `status` — which VibeBoard writes for a run it killed and which
    // an agent may only ever set to `success` or `attention` (decision 40). Absent rather than invented for a
    // child nothing has run on yet.
    //
    // ITS OWN WORK, so a REVIEW run is not it: a review's status is how the REVIEWER's turn went, so a task
    // the reviewer sent back with findings was being described here as having ended `success`.
    ...(runs.ok ? lastOutcome(runs.value.runs, child.id) : {}),
    // Named as a fact rather than left to be derived from the column: which slug means blocked is config, and
    // the checkup has no way to read it.
    blocked: isBlockedColumn(ap, child.board, child.columnSlug),
  }));
  return {
    evidence: {
      children,
      // Through as many levels as there are: a feature's problem is often two levels down, where its story is
      // done and the task under that story is what is blocked.
      blocked: blockedUnder(ap, card, cards).map((c) => c.id),
      suggestions: suggestions.ok
        ? suggestions.value.suggestions.map((s) => ({ id: s.id, title: s.title }))
        : [],
      ...(smoke.smoke === undefined ? {} : { smoke: smoke.smoke }),
    },
  };
}

// The smoke command, run by the LOOP in its own process before the dispatch (ruling 55), and handed over as
// EVIDENCE rather than as a gate: a feature whose smoke command fails is exactly what a person needs told
// about, and blocking on it would stop the project instead of reporting it.
//
// THE GATE-DOCUMENT REFUSAL IS IN HERE, in front of the spawn, rather than at the call site: it is the one
// place this command is ever run, and a caller that had to remember the check is a caller that will not.
async function smokeFor(
  deps: ActDeps,
  action: Dispatch,
  context: TickContext,
): Promise<{ smoke?: Verification; refused?: ActResult }> {
  if (action.phase !== 'feature-checkup') return {};
  const unread = await refuseWhileGateDocumentUnread(deps);
  if (unread) return { refused: unread };
  const smoke = await (deps.verify?.smoke ?? verifySmoke)(deps.root, deps.now().toISOString());
  await deps.client.log('run', smokeRanLine(action, smoke, context), {
    iteration: context.iteration + 1,
    ...(action.card ? { card: action.card.id } : {}),
  });
  return { smoke };
}

// THE GATE-DOCUMENT REFUSAL, in front of EVERY command this feature spawns (decision 51). Until the review phase
// ran its gates before dispatching, the only thing between an agent-rewritten gate document and its commands
// running unsandboxed as this user was the refusal on `POST /api/runs` — which worked precisely because the
// commands ran AFTER a dispatch the endpoint could refuse.
//
// BOTH DOCUMENTS, and that is the correction. `foundation/CODE-QUALITY.md` carries `gates:` and
// `foundation/TESTING.md` carries `smoke:`; they are the same `EXECUTED` set in routes/control.ts and both run
// through `/bin/sh` as the server's own user. Guarding only the gates left the hole open one document over: a
// copilot rewrites `TESTING.md`, the loop reaches a feature checkup, and the new command executes before the
// dispatch that would have been refused.
//
// Read at the moment the command would run rather than once at start-up, because an agent may rewrite the
// document mid-session. `undefined` means nothing is unread and the caller may go on.
export async function refuseWhileGateDocumentUnread(deps: ActDeps): Promise<ActResult | undefined> {
  const unread = (await deps.state()).unreviewedGates;
  if (!unread || unread.length === 0) return undefined;
  return await stop(
    deps,
    'stalled',
    `Auto-pilot will not run a gate command while a gate document is unread. ${unreviewedGatesSentence(unread)}`,
  );
}

// How this card's own work last ended, or nothing when nothing has run on it. `latestOwnRun` is in bounds.ts
// with every other "which run answers this" question, and it excludes the REVIEW runs — the whole of what was
// wrong here — and orders by when a run started rather than by an id whose tie-break is random.
function lastOutcome(runs: RunRecord[], card: string): { outcome?: string } {
  const last = latestOwnRun(runs, card);
  return last === undefined ? {} : { outcome: last.status };
}
