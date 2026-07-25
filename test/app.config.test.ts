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

interface WsMessage { type: string; snapshot?: { config?: { copilot?: { backend?: string } } } }

describe('PATCH /api/config', () => {
  // Regression: config lives under .vibeboard/, which the board watcher ignores, so a config
  // save must explicitly push a fresh snapshot — otherwise the UI never reflects the change
  // (the "Save does nothing" bug when switching backend).
  it('broadcasts an updated snapshot so clients see the new backend', async () => {
    session = new ProjectSession();
    app = buildApp(session);
    const root = await tempDir();
    await app.inject({ method: 'POST', url: '/api/project/scaffold', payload: { path: root, name: 'Cfg', mode: 'greenfield' } });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = new WebSocket(`${address.replace('http', 'ws')}/ws`);
    const messages: WsMessage[] = [];
    const waiters: Array<(m: WsMessage) => void> = [];
    client.on('message', (d) => { const m = JSON.parse(d.toString()) as WsMessage; messages.push(m); waiters.forEach((w) => w(m)); });
    const waitFor = (pred: (m: WsMessage) => boolean): Promise<WsMessage> =>
      new Promise((resolve) => { const e = messages.find(pred); if (e) return resolve(e); waiters.push((m) => { if (pred(m)) resolve(m); }); });

    await new Promise<void>((r) => client.on('open', () => r()));
    await waitFor((m) => m.type === 'snapshot'); // initial (claude-code default)

    await app.inject({ method: 'PATCH', url: '/api/config', payload: { copilot: { backend: 'opencode' } } });

    const updated = await waitFor((m) => m.type === 'snapshot' && m.snapshot?.config?.copilot?.backend === 'opencode');
    expect(updated.snapshot!.config!.copilot!.backend).toBe('opencode');

    client.close();
  }, 5000);
});
