import { describe, expect, it } from 'vitest';
import { archiveCard, createCard, moveCard, readBoard, readConfig, scaffoldProject } from '../src/index.js';
import { tempDir } from './helpers.js';

const TODAY = '2026-07-23';
const NOW = '2026-07-23T10:00:00.000Z';

describe('end-to-end: scaffold → create → move → archive', () => {
  it('drives a project through the full lifecycle from the public API', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'E2E', mode: 'greenfield', today: TODAY });
    const config = await readConfig(root);

    // create an engineering card
    let eng = await createCard(
      root,
      config,
      { board: 'engineering', columnSlug: 'todo', title: 'Build the thing' },
      TODAY,
    );
    expect(eng.id).toBe('E-002'); // E-001 is the sample card

    // move it across the board
    eng = await moveCard(root, eng, 'in-progress');
    let board = await readBoard(root, 'engineering', config);
    expect(board.find((c) => c.id === eng.id)?.columnSlug).toBe('in-progress');

    // archive it — it leaves the board
    await archiveCard(root, eng, NOW);
    board = await readBoard(root, 'engineering', config);
    expect(board.find((c) => c.id === eng.id)).toBeUndefined();
  });
});
