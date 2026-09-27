import type { DiaryEntry } from '../../core/diary.js';
import { findCard } from '../../core/find.js';
import { handRunTarget } from '../../core/hand-run.js';
import { isHandRun, type RunRecord } from '../../core/runs.js';
import type { ProjectConfig } from '../../core/types.js';
import { appendEntry } from '../../store/diary-store.js';
import { moveCard } from '../boards/move.js';
import { nowIso } from '../route-context.js';
import type { DispatchInput } from './agent-runner.js';

export interface HandRunDeps {
  session: { root?: string; config?: ProjectConfig };
  autopilotRunning: () => Promise<boolean>;
  broadcast: (msg: unknown) => void;
}

// A person's run that succeeded moves its card on (decision 95), so the board says the work happened without
// anyone opening the card to find out.
export function moveAfterHandRun(
  deps: HandRunDeps,
): (final: RunRecord, input: DispatchInput, root: string) => Promise<void> {
  return async (final, input, root) => {
    if (!isHandRun(final) || input.card === undefined) return;
    const { config } = deps.session;
    if (deps.session.root !== root || config === undefined) return;
    const card = await findCard(root, input.card.board, input.card.id, config);
    const to = handRunTarget({
      record: final,
      skill: input.skill,
      dispatchedFrom: input.card.columnSlug,
      card,
      config,
      autopilotRunning: await deps.autopilotRunning(),
    });
    if (card === undefined || to === undefined) return;
    if ((await moveCard(root, config, card, to, null)) === 'unknown-column') return;
    const entry: DiaryEntry = {
      at: nowIso(),
      kind: 'run',
      card: card.id,
      board: card.board,
      skill: final.skill,
      outcome: final.status,
      text: `moved to ${to}: started by hand, and it finished in success`,
    };
    await appendEntry(root, entry);
    deps.broadcast({ type: 'diary:entry', entry });
  };
}
