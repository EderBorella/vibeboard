import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import WebSocket from 'ws';
import { chmodSync, existsSync, rmSync, readFileSync } from 'node:fs';
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

// The dock's controls are a SESSION OVERRIDE: the project config holds the defaults and is the
// only persisted source, so per-turn values must win without ever changing the file.
describe('copilot session override', () => {
  const ARGS_LOG = join(here, 'fixtures', '.override-args.log');

  async function turn(payload: Record<string, unknown>): Promise<string[]> {
    if (existsSync(ARGS_LOG)) rmSync(ARGS_LOG);
    process.env.VIBEBOARD_SHIM_ARGS = ARGS_LOG;
    const address = await app!.listen({ port: 0, host: '127.0.0.1' });
    const client = new WebSocket(`${address.replace('http', 'ws')}/ws`);
    const messages: Msg[] = [];
    const waiters: Array<() => void> = [];
    client.on('message', (d) => { messages.push(JSON.parse(d.toString())); waiters.forEach((w) => w()); });
    const waitFor = (pred: () => boolean): Promise<void> =>
      new Promise((resolve) => { if (pred()) return resolve(); waiters.push(() => { if (pred()) resolve(); }); });
    await new Promise<void>((r) => client.on('open', () => r()));
    client.send(JSON.stringify({ type: 'copilot:send', text: 'hi', ...payload }));
    await waitFor(() => messages.some((m) => m.type === 'copilot:event' && m.event?.kind === 'result'));
    client.close();
    delete process.env.VIBEBOARD_SHIM_ARGS;
    return JSON.parse(readFileSync(ARGS_LOG, 'utf8').trim().split('\n')[0]) as string[];
  }

  async function open(copilot: unknown): Promise<string> {
    session = new ProjectSession();
    app = buildApp(session);
    const root = await tempDir();
    await app.inject({ method: 'POST', url: '/api/project/scaffold', payload: { path: root, name: 'Ov', mode: 'greenfield' } });
    await app.inject({ method: 'PATCH', url: '/api/config', payload: { copilot } });
    return root;
  }

  const configured = {
    backend: 'claude-code',
    backends: {
      'claude-code': { model: 'sonnet', effort: 'low' },
      opencode: { model: 'opencode/big-pickle', effort: 'max' },
    },
  };

  it('uses the configured default when the turn names nothing', async () => {
    await open(configured);
    const args = await turn({ mode: 'plan' });
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
  });

  it('lets a per-turn value win over the configured default', async () => {
    await open(configured);
    const args = await turn({ mode: 'plan', backend: 'claude-code', model: 'haiku', effort: 'max' });
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    expect(args[args.indexOf('--effort') + 1]).toBe('max');
    // The file is untouched — that is the whole point of an override.
    const onDisk = (await app!.inject({ method: 'GET', url: '/api/config' })).json();
    expect(onDisk.copilot.backend).toBe('claude-code');
    expect(onDisk.copilot.backends['claude-code']).toEqual({ model: 'sonnet', effort: 'low' });
  });

  // Regression: the configured model belongs to ONE backend. Overriding the backend must read
  // THAT backend's own slot — not the selected backend's model, and not the built-in default
  // when a saved choice exists. Previously this yielded 'opus' and a save then destroyed the
  // slot, so one round-trip through the connector toggle lost both models.
  //
  // Overriding *to* claude-code (rather than away from it) so the arg-logging shim sees the
  // spawn: the opencode backend talks HTTP and passes no CLI flags. The opencode direction is
  // covered at the resolver level in test/copilot-choice.test.ts.
  it('reads the overridden backend own slot, not the selected backend model', async () => {
    await open({ ...configured, backend: 'opencode' });
    const args = await turn({ mode: 'plan', backend: 'claude-code' });
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet'); // claude's saved slot
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
    expect(args).not.toContain('opencode/big-pickle');
    expect(args).not.toContain('opus'); // the built-in default, i.e. the old broken answer
  });

  it('falls back to the built-in default for a backend with no saved slot', async () => {
    await open({ backend: 'opencode', backends: { opencode: { model: 'opencode/big-pickle', effort: 'max' } } });
    const args = await turn({ mode: 'plan', backend: 'claude-code' });
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
  });
});
