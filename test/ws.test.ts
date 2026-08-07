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

// A browser allows six persistent connections per host and Firefox counts a WebSocket handshake against
// that limit. This app fires six /api requests as the board mounts, which takes every slot — and
// keep-alive then holds them, so the socket's handshake is queued IN THE BROWSER and never arrives.
//
// Measured on a real load: page at 18:06:23, handshake at 18:07:41. Seventy-eight seconds of a board
// saying "Connecting…", with nothing in the server log to explain it, because nothing had been sent.
describe('the keep-alive window', () => {
  it('is short enough that a queued websocket handshake is not held for a minute', async () => {
    const { app } = await openTestProject({ name: 'KA' });

    // Fastify's default is 72_000. Asserted as a bound rather than a literal: what matters is that a
    // browser at its connection limit gets a slot back in seconds.
    expect(app.server.keepAliveTimeout).toBeLessThanOrEqual(5_000);
    expect(app.server.keepAliveTimeout).toBeGreaterThan(0); // 0 disables keep-alive entirely
  });

  it('still advertises keep-alive, so ordinary requests are not one connection each', async () => {
    const { app } = await openTestProject({ name: 'KA2' });
    const res = await app.inject({ method: 'GET', url: '/api/state' });
    expect(res.headers.connection).toBe('keep-alive');
  });
});
