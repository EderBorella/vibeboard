import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The seam is `wrapCommand` — the last thing between a decision made in buildApp and a real spawn.
// Spied, not replaced: the real implementation still runs, so this cannot pass by neutering the
// thing it is testing.
const spy = vi.hoisted(() => ({ statuses: [] as unknown[] }));
vi.mock('../src/server/sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/sandbox.js')>();
  return {
    ...actual,
    wrapCommand: (bin: string, args: string[], status: Parameters<typeof actual.wrapCommand>[2]) => {
      spy.statuses.push(status);
      return actual.wrapCommand(bin, args, status);
    },
  };
});

import type { SandboxStatus } from '../src/server/sandbox.js';
import { openTestProject, shimArgsLog, wsClient } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const RUN_SHIM = join(here, 'fixtures', 'fake-agent.mjs');
const CHAT_SHIM = join(here, 'fixtures', 'fake-claude.mjs');

beforeAll(() => {
  chmodSync(RUN_SHIM, 0o755);
  chmodSync(CHAT_SHIM, 0o755);
  // The chat has no `bin` option, so this is how the existing copilot suite points it at a shim
  // (test/app.copilot.test.ts does the same, at file scope and with the same value — concurrent
  // files setting it identically is safe, a beforeEach racing siblings is not).
  process.env.VIBEBOARD_CLAUDE_BIN = CHAT_SHIM;
});

// Deliberately NOT ok. What is under test is that this exact object travels from buildApp to the
// spawn site, and its identity proves that on its own — while an `ok: true` sentinel would make
// wrapCommand invoke `aa-exec -p <profile-that-does-not-exist>`, so every turn would die and the
// test would be about the failure rather than the wiring. It also keeps this suite portable.
const STATUS: SandboxStatus = { ok: false, reason: 'wiring-probe-sentinel' };

afterEach(() => {
  spy.statuses.length = 0;
});

// Nothing else in the suite connects these two ends. test/agent-turn.test.ts proves the wrapper
// works when a status is handed to it directly; test/app.sandbox.test.ts proves the status reaches
// the ROUTE. Neither notices if the composition root stops handing it to the things that actually
// spawn agents — delete `sandbox: opts.sandbox` from the AgentRunner options and every dispatched
// run goes unconfined while GET /api/sandbox and the Settings panel keep reporting "Enforced by the
// OS". A fail-open with the UI vouching for it is the worst shape this change can take.
describe('buildApp hands the sandbox to everything that spawns an agent', () => {
  it('to skill runs', async () => {
    process.env.VIBEBOARD_SHIM_ARGS = shimArgsLog();
    const project = await openTestProject({ runBin: RUN_SHIM, sandbox: STATUS });
    const state = (await project.app.inject({ method: 'GET', url: '/api/state' })).json() as {
      snapshot: { boards: { engineering: { id: string }[] } };
    };
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        board: 'engineering',
        card: state.snapshot.boards.engineering[0].id,
        skill: 'execute',
        backend: 'claude-code',
      },
    });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(spy.statuses.length).toBeGreaterThan(0));
    expect(spy.statuses[0]).toEqual(STATUS);
  });

  it('to the chat copilot, which auto-approves its own tool calls', async () => {
    const { app } = await openTestProject({ name: 'Wiring', sandbox: STATUS });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = wsClient<{ type: string; event?: { kind: string } }>(address);
    await client.open;
    client.send({ type: 'copilot:send', text: 'hi', mode: 'plan' });
    await client.waitFor((m) => m.type === 'copilot:event' && m.event?.kind === 'result');
    client.close();

    expect(spy.statuses[0]).toEqual(STATUS);
  });
});
