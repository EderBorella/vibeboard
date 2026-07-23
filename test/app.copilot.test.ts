import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import WebSocket from 'ws';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers.js';
import { ProjectSession } from '../src/server/session.js';
import { buildApp } from '../src/server/app.js';
import type { FastifyInstance } from 'fastify';

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-claude.mjs');

let session: ProjectSession | undefined;
let app: FastifyInstance | undefined;

beforeAll(() => {
  chmodSync(SHIM, 0o755);
  process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
});

afterEach(async () => {
  await app?.close();
  await session?.close();
  app = undefined;
  session = undefined;
});

interface Msg { type: string; event?: { kind: string; text?: string }; state?: { running: boolean } }

describe('copilot over /ws', () => {
  it('streams copilot events for a turn and reports idle state at the end', async () => {
    session = new ProjectSession();
    app = buildApp(session);
    const root = await tempDir();
    await app.inject({ method: 'POST', url: '/api/project/scaffold', payload: { path: root, name: 'Co', mode: 'greenfield' } });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = new WebSocket(`${address.replace('http', 'ws')}/ws`);
    const messages: Msg[] = [];
    const waiters: Array<() => void> = [];
    client.on('message', (data) => { messages.push(JSON.parse(data.toString())); waiters.forEach((w) => w()); });
    const waitFor = (pred: () => boolean): Promise<void> =>
      new Promise((resolve) => { if (pred()) return resolve(); waiters.push(() => { if (pred()) resolve(); }); });

    await new Promise<void>((r) => client.on('open', () => r()));
    client.send(JSON.stringify({ type: 'copilot:send', text: 'hi', mode: 'plan' }));

    // shim emits init -> text('fresh') -> result
    await waitFor(() => messages.some((m) => m.type === 'copilot:event' && m.event?.kind === 'result'));
    const kinds = messages.filter((m) => m.type === 'copilot:event').map((m) => m.event!.kind);
    expect(kinds).toEqual(['init', 'text', 'result']);
    const textEvt = messages.find((m) => m.event?.kind === 'text');
    expect(textEvt!.event!.text).toBe('fresh');

    // an idle state should arrive after the turn completes
    await waitFor(() => messages.some((m) => m.type === 'copilot:state' && m.state?.running === false && messages.indexOf(m) > 2));
    client.close();
  }, 8000);
});
