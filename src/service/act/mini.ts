import { checksSentence } from '../../core/lifecycle/mini.js';
import type { RunRecord } from '../../core/runs.js';
import { verifyGates, verifySmoke } from '../../exec/verify.js';
import type { ActResult, TickContext } from '../loop.js';
import { refuseWhileGateDocumentUnread } from './checkup.js';
import type { ActDeps, Dispatch } from './index.js';

// A MINI RUN'S TAIL (decision 100). The build needs nothing from the loop but a line in the diary. After a review
// the loop runs the gates and then the smoke command in its own process, and hands the next tick what they did —
// the review's word about its own fixes is not what decides whether the project is finished.
export async function afterMiniRun(
  deps: ActDeps,
  action: Dispatch,
  settled: RunRecord,
  context: TickContext,
): Promise<ActResult> {
  const said = settled.summary?.trim();
  await deps.client.log('run', `${action.skill} ended ${settled.status}${said ? `: ${said}` : ''}`, {
    iteration: context.iteration + 1,
    skill: action.skill,
    outcome: settled.status,
  });
  if (action.phase !== 'mini-review') return { dispatches: 1 };
  const unread = await refuseWhileGateDocumentUnread(deps);
  if (unread) return { ...unread, dispatches: 1 };
  const at = deps.now().toISOString();
  const gates = await (deps.verify?.gates ?? verifyGates)(deps.root, at);
  const checked = gates.passed ? await (deps.verify?.smoke ?? verifySmoke)(deps.root, at) : gates;
  // On the review's own record, so the next round is told it and the tick reads it off disk.
  const wrote = await deps.client.projectVerdict(settled.run, checked);
  if (!wrote.ok) deps.log?.(`could not record what the checks did on ${settled.run}: ${wrote.reason}`);
  await deps.client.log('run', checksSentence(checked), {
    iteration: context.iteration + 1,
    outcome: checked.mode,
  });
  return { dispatches: 1 };
}
