import { chmodSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { writeAutopilotState } from '../src/server/autopilot-store.js';
import { openTestProject, shimArgsLog, tempDir, wsClient } from './helpers.js';

// What a halted project and a running auto-pilot refuse, and what each refusal SAYS. A message about a
// state the user cannot see and cannot act on is a worse failure than the state itself, so every one
// of these names the way forward.

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-claude.mjs');

beforeAll(() => {
  chmodSync(SHIM, 0o755);
  process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
});

const dispatch = { board: 'engineering', card: 'E-001', skill: 'implement' };

describe('while a project is halted', () => {
  it('refuses a dispatch, naming the restart', async () => {
    const { app } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: dispatch });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Restart');
  });

  it('dispatches again once it has been restarted', async () => {
    const { app } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    await app.inject({ method: 'POST', url: '/api/autopilot/restart', payload: {} });
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: dispatch });
    // 404 would mean the card is missing rather than the lock refusing; anything but 409 proves the
    // lock is open. The sample board has E-001, so this is a real dispatch.
    expect(res.statusCode).not.toBe(409);
  });

  // The assertion is that NO PROCESS WAS CREATED, not that the message was polite. Decision 12 is
  // explicit that while halted "nothing dispatches, nothing respawns lazily, and the chat says plainly
  // that the project is halted" — and the args log is the only place that can tell those apart.
  it('starts no agent for a chat message, and says so', async () => {
    const ARGS_LOG = shimArgsLog();
    if (existsSync(ARGS_LOG)) rmSync(ARGS_LOG);
    process.env.VIBEBOARD_SHIM_ARGS = ARGS_LOG;
    const { app } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = wsClient<{ type: string; error?: string }>(address);
    await client.open;
    client.send({ type: 'copilot:send', text: 'hello', mode: 'plan' });
    const refusal = await client.waitFor((m) => m.type === 'copilot:error');
    client.close();
    delete process.env.VIBEBOARD_SHIM_ARGS;

    expect(refusal.error).toContain('halted');
    expect(existsSync(ARGS_LOG)).toBe(false);
  }, 8000);
});

describe('while auto-pilot is running', () => {
  it('refuses a manual dispatch, offering the soft stop', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: dispatch });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Soft-stop');
  });

  it('dispatches by hand again after a soft stop', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: dispatch });
    expect(res.statusCode).not.toBe(409);
  });

  // S7. Switching would resolve the next dispatch against the new project and rewrite the old one's
  // live runs to `interrupted` — a status that burns no attempt, corrupting the ledger of a run still
  // in flight.
  it('refuses to open a DIFFERENT project', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const elsewhere = await tempDir();
    const res = await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: elsewhere } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Soft-stop');
  });

  // Not a switch, and refusing it would deadlock recovery: a server that died mid-run leaves `running`
  // on disk, and the reconcile that fixes it happens on open.
  it('still allows reopening the project already open', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const res = await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect(res.statusCode).toBe(200);
  });

  it('allows the switch after a soft stop', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    const other = await openTestProject({ name: 'B' });
    const res = await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: other.root } });
    expect(res.statusCode).toBe(200);
  });
});
