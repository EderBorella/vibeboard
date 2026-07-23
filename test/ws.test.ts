import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { tempDir } from './helpers.js';
import { ProjectSession } from '../src/server/session.js';
import { buildApp } from '../src/server/app.js';
import type { FastifyInstance } from 'fastify';

let session: ProjectSession | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  await session?.close();
  app = undefined;
  session = undefined;
});

interface WsMessage { type: string; snapshot: { boards: { engineering: { title: string }[] } } }

describe('/ws live sync', () => {
  it('sends a snapshot on connect and again when a card is created', async () => {
    session = new ProjectSession();
    app = buildApp(session);
    const root = await tempDir();
    await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      payload: { path: root, name: 'WS', mode: 'greenfield' },
    });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = new WebSocket(`${address.replace('http', 'ws')}/ws`);

    const messages: WsMessage[] = [];
    const waiters: Array<(m: WsMessage) => void> = [];
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as WsMessage;
      messages.push(msg);
      for (const w of waiters) w(msg);
    });

    const waitFor = (pred: (m: WsMessage) => boolean): Promise<WsMessage> =>
      new Promise((resolve) => {
        const existing = messages.find(pred);
        if (existing) return resolve(existing);
        waiters.push((m) => { if (pred(m)) resolve(m); });
      });

    await new Promise<void>((resolve) => client.on('open', () => resolve()));

    // initial snapshot on connect
    const first = await waitFor((m) => m.type === 'snapshot');
    expect(first.snapshot.boards.engineering.length).toBeGreaterThan(0);

    // create a card → watcher should push a new snapshot containing it
    await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'engineering', columnSlug: 'todo', title: 'Live card' },
    });

    const updated = await waitFor((m) =>
      m.type === 'snapshot' && m.snapshot.boards.engineering.some((c) => c.title === 'Live card'));
    expect(updated.snapshot.boards.engineering.some((c) => c.title === 'Live card')).toBe(true);

    client.close();
  }, 5000);
});
