import { describe, it, expect } from 'vitest';
import { openTestProject, wsClient } from './helpers.js';

interface WsMessage {
  type: string;
  snapshot: { boards: { engineering: { title: string }[] } };
}

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
      payload: { board: 'engineering', columnSlug: 'todo', title: 'Live card' },
    });

    const updated = await client.waitFor(
      (m) => m.type === 'snapshot' && m.snapshot.boards.engineering.some((c) => c.title === 'Live card'),
    );
    expect(updated.snapshot.boards.engineering.some((c) => c.title === 'Live card')).toBe(true);

    client.close();
  }, 5000);
});
