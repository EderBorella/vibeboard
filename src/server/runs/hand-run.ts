import type { DiaryEntry } from '../../core/diary.js';
import { findCard } from '../../core/find.js';
import { finishColumn, startColumn } from '../../core/hand-run.js';
import { isHandRun, type RunRecord } from '../../core/runs.js';
import type { Skill } from '../../core/skills.js';
import type { Card, ProjectConfig } from '../../core/types.js';
import { appendEntry } from '../../store/diary-store.js';
import { moveCard } from '../boards/move.js';
import { nowIso } from '../route-context.js';
import type { DispatchInput } from './agent-runner.js';

// A person's run moves its card on its way in, before its prompt is built, so the run is told the card's
// file where it now is. True when it moved.
export async function moveOnHandStart(
  root: string,
  config: ProjectConfig,
  card: Card,
  skill: Skill,
): Promise<boolean> {
  const to = startColumn(config, card, skill);
  return to !== undefined && (await moveCard(root, config, card, to, null)) !== 'unknown-column';
}

export interface HandRunDeps {
  session: { root?: string; config?: ProjectConfig };
  autopilotRunning: () => Promise<boolean>;
  broadcast: (msg: unknown) => void;
}

// And on its way out, whatever the ending: what the run did is waiting for the person (decision 95).
export function moveAfterHandRun(
  deps: HandRunDeps,
): (final: RunRecord, input: DispatchInput, root: string) => Promise<void> {
  return async (final, input, root) => {
    if (!isHandRun(final) || input.card === undefined) return;
    const { config } = deps.session;
    if (deps.session.root !== root || config === undefined) return;
    const card = await findCard(root, input.card.board, input.card.id, config);
    const to = finishColumn({
      record: final,
      skill: input.skill,
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
      text: `moved to ${to} to wait for you: a run you started ended ${final.status}`,
    };
    await appendEntry(root, entry);
    deps.broadcast({ type: 'diary:entry', entry });
  };
}
