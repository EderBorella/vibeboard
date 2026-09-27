import { BLOCKED_BOARDS, DEFAULT_AUTOPILOT, isTerminalColumn } from './autopilot.js';
import { boardColumnSlugs } from './board/columns.js';
import { isHandRun, type RunRecord } from './runs.js';
import type { Skill } from './skills.js';
import type { Card, ProjectConfig } from './types.js';

// WHERE A PERSON'S RUN PUTS ITS CARD (decision 95): into the working column while it runs, and into the
// blocked one — shown as "Blocked / Waiting approval" — when it ends, so what is waiting for them is where
// they look. Two fixed columns, the same on every board that has them, and nothing else decides a move.
export const WORKING_COLUMN = 'in-progress';

const moves = (skill: Skill): boolean => skill.movesCard && !skill.autopilotOnly;

// Not out of a terminal column: a finished card someone reads or checks stays finished.
export function startColumn(config: ProjectConfig, card: Card, skill: Skill): string | undefined {
  if (!moves(skill) || card.columnSlug === WORKING_COLUMN) return undefined;
  if (isTerminalColumn(config.autopilot ?? DEFAULT_AUTOPILOT, card.board, card.columnSlug)) return undefined;
  return boardColumnSlugs(config, card.board).includes(WORKING_COLUMN) ? WORKING_COLUMN : undefined;
}

export interface HandRunEnding {
  record: RunRecord;
  skill: Skill;
  card: Card | undefined;
  config: ProjectConfig;
  autopilotRunning: boolean;
}

// Only a card still in the working column: one the run itself moved — a check that passed and put it in
// done — or one somebody moved meanwhile has had its answer. While auto-pilot runs, the columns are its to
// stamp. The features board has no blocked column, so a feature stays where it is.
export function finishColumn(e: HandRunEnding): string | undefined {
  const { record, skill, card, config } = e;
  if (!isHandRun(record) || !moves(skill) || e.autopilotRunning) return undefined;
  if (card === undefined || card.columnSlug !== WORKING_COLUMN || !BLOCKED_BOARDS.includes(card.board)) {
    return undefined;
  }
  const blocked = (config.autopilot ?? DEFAULT_AUTOPILOT).blockedColumn;
  return boardColumnSlugs(config, card.board).includes(blocked) ? blocked : undefined;
}
