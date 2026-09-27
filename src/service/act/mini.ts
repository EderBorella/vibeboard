import type { MiniChecks } from '../../core/lifecycle/mini.js';
import type { RunRecord } from '../../core/runs.js';
import { tail, type Verification } from '../../core/verify.js';
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
  const miniChecks: MiniChecks = { passed: checked.passed, detail: describe(checked) };
  await deps.client.log('run', miniChecks.detail, {
    iteration: context.iteration + 1,
    outcome: checked.mode,
  });
  return { dispatches: 1, miniChecks };
}

// Which command failed and what it printed, because that is where a person starts.
function describe(v: Verification): string {
  if (v.passed) return 'The gates and the smoke command pass.';
  const what = v.command ? `\`${v.command}\` failed` : `The ${v.mode} could not run`;
  if (v.output?.trim()) return `${what}:\n${tail(v.output.trim(), 1500)}`;
  return v.reason ? `${what}: ${v.reason}` : `${what}.`;
}
