import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { groupStartTime } from '../src/exec/process-group.js';
import {
  readAutopilotState,
  updateAutopilotState,
  writeAutopilotState,
} from '../src/server/autopilot-store.js';
import { writeRun } from '../src/server/run-store.js';
import { openTestProject, wsClient } from './helpers.js';

// Decision 12: three levels of stopping, and an explicit way back. Each one is a state on disk, so it
// survives a reload — otherwise a refresh would bypass the overlay that explains the halt.

const AT = '2026-08-03T12:00:00.000Z';

async function state(app: Awaited<ReturnType<typeof openTestProject>>['app']) {
  const res = await app.inject({ method: 'GET', url: '/api/autopilot/state' });
  return { code: res.statusCode, ...(res.json() as { state: Record<string, unknown> }) };
}

describe('the auto-pilot controls', () => {
  it('reports idle for a project that has never run it', async () => {
    const { app } = await openTestProject();
    expect(await state(app)).toMatchObject({ code: 200, state: IDLE_STATE });
  });

  it('soft-stops without touching anything else', async () => {
    const { app } = await openTestProject();
    const res = await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    expect(res.statusCode).toBe(200);
    expect((await state(app)).state).toMatchObject({ state: 'stopped', reason: 'stopped' });
  });

  it('carries the detail into the sentence a person reads', async () => {
    const { app } = await openTestProject();
    await app.inject({
      method: 'POST',
      url: '/api/autopilot/stop',
      payload: { detail: 'E-004 has used all three attempts.' },
    });
    expect((await state(app)).state.detail).toContain('E-004');
  });

  it('halts on an emergency stop, with a reason and a timestamp', async () => {
    const { app } = await openTestProject();
    const res = await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    expect(res.statusCode).toBe(200);
    const halted = (await state(app)).state;
    expect(halted).toMatchObject({ state: 'halted', reason: 'killed' });
    expect(typeof halted.at).toBe('string');
  });

  // Otherwise the soft stop would silently undo an emergency stop, and the overlay explaining it would
  // vanish without anyone deciding it should.
  it('refuses a soft stop while halted, naming the way out', async () => {
    const { app } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    const res = await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Restart');
    expect((await state(app)).state.state).toBe('halted');
  });

  it('restarts back to idle, clearing the reason and the detail', async () => {
    const { app } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: { detail: 'panic' } });
    const res = await app.inject({ method: 'POST', url: '/api/autopilot/restart', payload: {} });
    expect(res.statusCode).toBe(200);
    const after = (await state(app)).state;
    expect(after.state).toBe('idle');
    expect(after.reason).toBeUndefined();
    expect(after.detail).toBeUndefined();
  });

  it('refuses a restart while auto-pilot is running', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 4 });
    const res = await app.inject({ method: 'POST', url: '/api/autopilot/restart', payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Soft-stop');
  });

  // The service owns the counters; the main server owns the state. A stop must not lose the other's
  // fields — they are the ledger of the run being stopped.
  it('keeps the service’s counter when it records a stop', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'running',
      iteration: 12,
    });
    await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    expect(await readAutopilotState(root, AT)).toMatchObject({
      state: 'stopped',
      iteration: 12,
    });
  });

  // Decision 13's blast radius. `cancelAll` covers what this process holds handles for; the records
  // cover what a PREVIOUS server left behind, and a halt that left those running would be a halt in
  // name only.
  it('kills a process group left behind by a previous server', async () => {
    const { app, root } = await openTestProject();
    const child = spawn('/bin/sh', ['-c', 'sleep 30'], { detached: true, stdio: 'ignore' });
    const pgid = child.pid as number;
    const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
    await new Promise((r) => setTimeout(r, 100));
    const pgstart = groupStartTime(pgid) as number;
    await writeRun(root, {
      run: '20260803-090000-zzzz',
      card: 'E-001',
      board: 'engineering',
      skill: 'implement',
      status: 'success', // ENDED, and its group still leaked: exactly the case cancelAll cannot see
      started: '2026-08-03T09:00:00.000Z',
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
      mode: 'bypassPermissions',
      pgid,
      pgstart,
      report: '',
    });

    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    await closed;
    expect(child.signalCode).toBe('SIGTERM');
  }, 15_000);

  // HIGH found in review: deleting the broadcast left all 2,241 tests passing. The hook's half was
  // covered and the server's was not — so the promise that a kill in one tab raises the overlay in
  // another rested on nothing.
  it('pushes every state change to the other tabs', async () => {
    const { app } = await openTestProject();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = wsClient<{ type: string; state?: { state: string; reason?: string } }>(address);
    await client.open;

    await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    const stopped = await client.waitFor((m) => m.type === 'autopilot:state');
    expect(stopped.state).toMatchObject({ state: 'stopped', reason: 'stopped' });

    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    await client.waitUntil((all) =>
      all.some((m) => m.type === 'autopilot:state' && m.state?.state === 'halted'),
    );

    await app.inject({ method: 'POST', url: '/api/autopilot/restart', payload: {} });
    await client.waitUntil((all) =>
      all.some((m) => m.type === 'autopilot:state' && m.state?.state === 'idle'),
    );
    client.close();
  }, 10_000);

  // The merge itself is pinned deterministically in autopilot-runtime.test.ts, where a test owns the
  // kill's timing. What this covers is the pair through HTTP: whichever of the two writes lands last, the
  // halt survives and the service's counter is not rolled back.
  it('survives the service writing counters around the same moment', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 41 });
    // Stand in for the service: advance the counters on disk while the request is in flight. The kill
    // reads the state, then awaits the whole blast radius, so this lands inside that window.
    // MERGING, the way the service is contracted to write (autopilot-state.ts names the split): it owns
    // the counters and adds to whatever state it finds. A stand-in that wrote the whole record would be
    // testing a writer that does not exist — and it would clobber the halt, which is now refused by the
    // store itself.
    const advancing = (async () => {
      await new Promise((r) => setTimeout(r, 5));
      await updateAutopilotState(root, AT, (current) => ({
        ...current,
        iteration: 42,
        servicePgid: 4242,
        servicePgstart: 99,
      }));
    })();
    const [res] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} }),
      advancing,
    ]);
    expect(res.statusCode).toBe(200);
    const after = await readAutopilotState(root, AT);
    expect(after.state).toBe('halted');
    // The four fields this process owns are set; everything the service owns survived.
    expect(after).toMatchObject({
      reason: 'killed',
      iteration: 42,
      servicePgid: 4242,
      servicePgstart: 99,
    });
  }, 10_000);

  // Persistence is the whole point of the file: a reload must not be a way out of a halt.
  it('is still halted after the project is reopened', async () => {
    const { app, session, root } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    await session.close();
    await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect((await state(app)).state).toMatchObject({ state: 'halted', reason: 'killed' });
  });

  // A server restart finds `running` with no live processes: those children died with it.
  it('reconciles a running state into a stopped one when the project opens', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 7 });
    await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect((await state(app)).state).toMatchObject({
      state: 'stopped',
      reason: 'interrupted',
      iteration: 7,
    });
  });
});
