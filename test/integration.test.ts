import { describe, expect, it } from 'vitest';
// Imported from the modules that own these functions, not from a root barrel. The barrel existed so
// that VibeBoard COULD be consumed as a library; nothing consumed it, and this file was its only
// importer — see `decision 68`. Naming the real homes also makes the layering visible: one pure
// module in `core/`, five in `store/`, and not a line of `server/` in an end-to-end lifecycle test.
import { boardColumnSlugs } from '../src/core/board/columns.js';
import { readBoard } from '../src/store/cards/board.js';
import { archiveCard, createCard, placeCard } from '../src/store/cards/mutations.js';
import { readConfig } from '../src/store/project/config.js';
import { scaffoldProject } from '../src/store/project/scaffold.js';
import { cardFrom, tempDir } from './helpers.js';

const TODAY = '2026-07-23';
const NOW = '2026-07-23T10:00:00.000Z';

describe('end-to-end: scaffold → create → move → archive', () => {
  it('drives a project through the full lifecycle from the public API', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'E2E', mode: 'greenfield', today: TODAY });
    const config = await readConfig(root);

    // Create an engineering card in a column the board actually has: one written elsewhere is not
    // on the board, so the move and archive steps below would both be about nothing.
    const [column] = boardColumnSlugs(config, 'engineering');
    let eng = cardFrom(
      await createCard(
        root,
        config,
        { board: 'engineering', columnSlug: column, title: 'Build the thing' },
        TODAY,
      ),
    );
    expect(eng.id).toBe('E-002'); // E-001 is the sample card

    // move it across the board
    // placeCard, because that is what both HTTP movers call — moveCard was library surface with
    // no caller, and an end-to-end test should exercise the path the app takes.
    eng = cardFrom(await placeCard(root, config, eng, 'in-progress', null));
    let board = await readBoard(root, 'engineering', config);
    expect(board.find((c) => c.id === eng.id)?.columnSlug).toBe('in-progress');

    // archive it — it leaves the board
    await archiveCard(root, eng, NOW);
    board = await readBoard(root, 'engineering', config);
    expect(board.find((c) => c.id === eng.id)).toBeUndefined();
  });
});
