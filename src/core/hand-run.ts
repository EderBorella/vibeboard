import { DEFAULT_AUTOPILOT, isBlockedColumn } from './autopilot.js';
import { boardColumnSlugs } from './board/columns.js';
import { isHandRun, type RunRecord } from './runs.js';
import type { Skill } from './skills.js';
import type { BoardName, Card, ProjectConfig } from './types.js';

// The column after `from` in board order, passing over the blocked one: only a judgement puts a card there.
export function nextColumn(config: ProjectConfig, board: BoardName, from: string): string | undefined {
  const slugs = boardColumnSlugs(config, board);
  const at = slugs.indexOf(from);
  if (at === -1) return undefined;
  const ap = config.autopilot ?? DEFAULT_AUTOPILOT;
  return slugs.slice(at + 1).find((slug) => !isBlockedColumn(ap, board, slug));
}

export interface HandRunEnding {
  record: RunRecord;
  skill: Skill;
  // Where the card stood when the run was dispatched, and where it stands now.
  dispatchedFrom: string;
  card: Card | undefined;
  config: ProjectConfig;
  autopilotRunning: boolean;
}

// WHERE A PERSON'S RUN MOVES ITS CARD, if anywhere (decision 95). A card somebody moved while the run worked
// has had its answer already, and while auto-pilot runs the board's columns are the loop's to stamp.
export function handRunTarget(e: HandRunEnding): string | undefined {
  const { record, skill, card } = e;
  if (!isHandRun(record) || record.status !== 'success' || record.fault !== undefined) return undefined;
  if (record.verdict === 'sent-back' || skill.autopilotOnly || !skill.moveOnSuccess) return undefined;
  if (e.autopilotRunning || card === undefined || card.columnSlug !== e.dispatchedFrom) return undefined;
  return nextColumn(e.config, card.board, card.columnSlug);
}
