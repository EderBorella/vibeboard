import { readConfig } from '../core/config.js';
import { readBoard } from '../core/board.js';
import type { Card, ProjectConfig } from '../core/types.js';

export interface ProjectSnapshot {
  root: string;
  name: string;
  config: ProjectConfig;
  boards: { product: Card[]; engineering: Card[] };
}

export async function buildSnapshot(projectRoot: string): Promise<ProjectSnapshot> {
  const config = await readConfig(projectRoot);
  const [product, engineering] = await Promise.all([
    readBoard(projectRoot, 'product', config),
    readBoard(projectRoot, 'engineering', config),
  ]);
  return { root: projectRoot, name: config.name, config, boards: { product, engineering } };
}
