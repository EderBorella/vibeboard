import { describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { readAutopilotState, writeAutopilotState } from '../src/server/autopilot-store.js';
import { openTestProject } from './helpers.js';

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
    // The checkup is mandatory on resume, and after a kill the board is in a state nobody has looked at.
    expect(after.needsCheckup).toBe(true);
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
  it('keeps the service’s counters when it records a stop', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'running',
      iteration: 12,
      dispatchesSinceCheckup: 3,
    });
    await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    expect(await readAutopilotState(root, AT)).toMatchObject({
      state: 'stopped',
      iteration: 12,
      dispatchesSinceCheckup: 3,
    });
  });

  // Persistence is the whole point of the file: a reload must not be a way out of a halt.
  it('is still halted after the project is reopened', async () => {
    const { app, session, root } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    await session.close();
    await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect((await state(app)).state).toMatchObject({ state: 'halted', reason: 'killed' });
  });

  // A server restart finds `running` with no live processes: those children died with it.
  it('reconciles a running state into one that owes a checkup when the project opens', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 7 });
    await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect((await state(app)).state).toMatchObject({
      state: 'stopped',
      reason: 'interrupted',
      needsCheckup: true,
      iteration: 7,
    });
  });
});
