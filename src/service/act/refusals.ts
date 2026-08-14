import type { StopReason } from '../../core/dispatch-gate.js';
import type { ActResult } from '../loop.js';
import type { ActDeps } from './index.js';

// THE TWO WAYS AN ACTION REPORTS IT COULD NOT: a refusal from the board, and a stop. Every module in here
// needs both, which is why they are a leaf rather than part of the orchestrator — a part importing a value
// from the file that imports it is a cycle waiting to bite.

// A refusal from the board. Reported to the diary where it can be, and fatal refusals end the loop: a loop
// that cannot move a card cannot make progress, and one whose credential is gone cannot do anything at all.
//
// `dispatches` is carried through it, and that is not tidiness: a dispatch that HAPPENED and then failed to
// record its verdict or move its card was reported as no dispatch at all, so neither cap was told about a real
// agent run, the tick counted as idle, and the next tick re-picked the same card and dispatched over work that
// had already passed — three times over, until the attempt cap caught it. Decision 8 says everything a model
// does counts against every cap, and it has to count even when what came after it broke.
export async function refused(
  deps: ActDeps,
  what: string,
  reason: string,
  fatal: boolean,
  dispatches = 0,
): Promise<ActResult> {
  deps.log?.(`${what}: ${reason}`);
  if (fatal) return { dispatches, stop: { reason: 'stalled', detail: `${what}: ${reason}` } };
  await deps.client.log('note', `Auto-pilot ${what}: ${reason}`);
  return { dispatches };
}

export async function stop(deps: ActDeps, reason: StopReason, detail: string): Promise<ActResult> {
  deps.log?.(detail);
  await deps.client.log('note', detail);
  return { dispatches: 0, stop: { reason, detail } };
}
