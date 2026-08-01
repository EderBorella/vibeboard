import { describe, expect, it } from 'vitest';
import { boardColumnSlugs } from '../src/core/board.js';
import { defaultConfig } from '../src/core/config.js';
import { openTestProject, wsClient } from './helpers.js';

interface WsMessage {
  type: string;
  snapshot: { boards: { engineering: { title: string }[] } };
}

// The scaffold writes the default config, so this is the column the board will be reading. Naming
// one it does not have would leave the card on disk but off every snapshot, and the only symptom
// would be this test waiting for a message that never comes.
const [ENG_COLUMN] = boardColumnSlugs(defaultConfig('WS'), 'engineering');

describe('/ws live sync', () => {
  it('sends a snapshot on connect and again when a card is created', async () => {
    const { app } = await openTestProject({ name: 'WS' });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = wsClient<WsMessage>(address);
    await client.open;

    // initial snapshot on connect
    const first = await client.waitFor((m) => m.type === 'snapshot');
    expect(first.snapshot.boards.engineering.length).toBeGreaterThan(0);

    // create a card → watcher should push a new snapshot containing it
    await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'engineering', columnSlug: ENG_COLUMN, title: 'Live card' },
    });

    const updated = await client.waitFor(
      (m) => m.type === 'snapshot' && m.snapshot.boards.engineering.some((c) => c.title === 'Live card'),
    );
    expect(updated.snapshot.boards.engineering.some((c) => c.title === 'Live card')).toBe(true);

    client.close();
  }, 5000);
});
