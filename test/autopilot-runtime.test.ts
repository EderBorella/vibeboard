import { describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { AutopilotRuntime, type AutopilotRuntimeOptions } from '../src/server/autopilot-runtime.js';
import {
  readAutopilotState,
  updateAutopilotState,
  writeAutopilotState,
} from '../src/server/autopilot-store.js';
import { tempDir } from './helpers.js';

// The three stops, driven directly rather than through the app, because the ordering that matters is
// inside them: `emergencyStop` reads the state, awaits the whole kill, and only then records the halt.
// Through HTTP that window is however long the kill happens to take; here a test owns it.

const AT = '2026-08-03T12:00:00.000Z';

function build(root: string, over: Partial<AutopilotRuntimeOptions> = {}) {
  const changes: unknown[] = [];
  const runtime = new AutopilotRuntime({
    root: () => root,
    now: () => new Date(AT),
    onChange: (state) => changes.push(state),
    ...over,
  });
  return { runtime, changes };
}

describe('recording a stop', () => {
  // The window is the kill itself: cancelAll, stopOpencodeServer, listRuns over every results folder in
  // the project, and the reaper. The service is not dead until its group is reaped, so it can tick in
  // there — and a snapshot taken before the kill rolled that counter back, along with any servicePgid
  // recorded with it, which is the pgid the reaper was about to need.
  it('keeps what the service wrote WHILE the kill was running', async () => {
    const root = await tempDir();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 41 });
    const { runtime } = build(root, {
      // Stands in for the service, and lands deterministically inside the window: the runtime has read
      // the state by now and has not written it yet.
      onKill: async () => {
        await updateAutopilotState(root, AT, (current) => ({
          ...current,
          iteration: 42,
          dispatchesSinceCheckup: 7,
          servicePgid: 4242,
          servicePgstart: 99,
        }));
      },
    });
    await runtime.load();

    const result = await runtime.emergencyStop('You stopped everything.');
    expect(result.ok).toBe(true);
    const after = await readAutopilotState(root, AT);
    expect(after).toMatchObject({
      state: 'halted',
      reason: 'killed',
      iteration: 42,
      dispatchesSinceCheckup: 7,
      servicePgid: 4242,
      servicePgstart: 99,
    });
  });

  it('does the same for a soft stop', async () => {
    const root = await tempDir();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 12 });
    const { runtime } = build(root);
    await runtime.load();
    // Written behind the runtime's back between its read and its write — the service's counters are its
    // own, and a stop must not speak for them.
    await updateAutopilotState(root, AT, (current) => ({ ...current, iteration: 13 }));
    await runtime.softStop('Enough for today.');
    expect(await readAutopilotState(root, AT)).toMatchObject({ state: 'stopped', iteration: 13 });
  });

  // The kill must not be able to leave the app looking healthy over a project whose agents are gone.
  it('records the halt even when the kill throws', async () => {
    const root = await tempDir();
    const { runtime } = build(root, {
      onKill: () => {
        throw new Error('the reaper exploded');
      },
    });
    await runtime.load();
    await runtime.emergencyStop();
    expect((await readAutopilotState(root, AT)).state).toBe('halted');
    expect(runtime.isHalted()).toBe(true);
  });

  // The mirror is what the synchronous halt gate reads — the one the lazy backend spawn consults.
  it('halts the in-memory mirror even when the disk write fails', async () => {
    const { runtime } = build('/nonexistent/definitely-not-a-project');
    await runtime.emergencyStop();
    expect(runtime.isHalted()).toBe(true);
  });
});

// The Restart button is the way back from a halt. It is not a way to raise a cap.
describe('restarting', () => {
  it('drops everything the halt held', async () => {
    const root = await tempDir();
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'halted',
      reason: 'killed',
      iteration: 40,
      servicePgid: 999,
      dispatchesSinceCheckup: 7,
    });
    const { runtime } = build(root);
    const result = await runtime.restart();
    expect(result.ok).toBe(true);
    // `needsCheckup` is SET, not cleared: after a halt the board is in a state nobody has looked at.
    expect(await readAutopilotState(root, AT)).toEqual({
      state: 'idle',
      iteration: 0,
      dispatchesSinceCheckup: 0,
      needsCheckup: true,
      at: AT,
    });
  });

  // The finding: resetting the counters from `idle` meant a soft stop AT the cap followed by Restart
  // bought a fresh cap, with nobody raising it. The plan asked for a no-op and this was not one.
  it('changes nothing on a project that is already idle', async () => {
    const root = await tempDir();
    await writeAutopilotState(root, { ...IDLE_STATE, iteration: 250, dispatchesSinceCheckup: 4 });
    const { runtime, changes } = build(root);
    const result = await runtime.restart();
    expect(result.ok).toBe(true);
    expect(await readAutopilotState(root, AT)).toMatchObject({ iteration: 250 });
    // And nothing is announced, because nothing happened.
    expect(changes).toEqual([]);
  });

  it('refuses while auto-pilot is running', async () => {
    const root = await tempDir();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 3 });
    const { runtime } = build(root);
    const result = await runtime.restart();
    expect(result.ok).toBe(false);
    expect(await readAutopilotState(root, AT)).toMatchObject({ state: 'running', iteration: 3 });
  });
});

describe('the runtime’s view of a project', () => {
  it('announces every change once', async () => {
    const root = await tempDir();
    const { runtime, changes } = build(root);
    await runtime.load();
    await runtime.softStop();
    await runtime.emergencyStop();
    await runtime.restart();
    expect(changes).toHaveLength(3);
  });

  it('refuses a soft stop while halted, and does not touch the file', async () => {
    const root = await tempDir();
    const { runtime } = build(root);
    await runtime.emergencyStop('gone');
    const before = await readAutopilotState(root, AT);
    const result = await runtime.softStop();
    expect(result.ok).toBe(false);
    expect(await readAutopilotState(root, AT)).toEqual(before);
  });
});
