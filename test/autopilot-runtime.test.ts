import { describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { AutopilotRuntime, type AutopilotRuntimeOptions } from '../src/server/autopilot/autopilot-runtime.js';
import {
  readAutopilotState,
  updateAutopilotState,
  writeAutopilotState,
} from '../src/store/autopilot-store.js';
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
  // The other direction, and it is not symmetrical. A soft stop kills NOTHING, so the loop may still be
  // alive and mid-tick when Restart is pressed — dropping its group left the next emergency stop with no
  // target for it, which is the orphan class decision 13 exists for. From `halted` the group is already
  // dead and keeping the pgid would aim a later reaper at whatever inherited the number.
  it('keeps the service group when restarting from a soft stop, since nothing killed it', async () => {
    const root = await tempDir();
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'stopped',
      reason: 'stopped',
      iteration: 12,
      servicePgid: 4242,
      servicePgstart: 987,
    });
    const { runtime } = build(root);
    expect((await runtime.restart()).ok).toBe(true);
    expect(await readAutopilotState(root, AT)).toEqual({
      state: 'idle',
      iteration: 0,
      at: AT,
      servicePgid: 4242,
      servicePgstart: 987,
    });
  });

  it('drops everything the halt held', async () => {
    const root = await tempDir();
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'halted',
      reason: 'killed',
      iteration: 40,
      servicePgid: 999,
    });
    const { runtime } = build(root);
    const result = await runtime.restart();
    expect(result.ok).toBe(true);
    // Everything the halt held is dropped: the reason, the detail, the counter and the process group.
    expect(await readAutopilotState(root, AT)).toEqual({
      state: 'idle',
      iteration: 0,
      at: AT,
    });
  });

  // The finding: resetting the counters from `idle` meant a soft stop AT the cap followed by Restart
  // bought a fresh cap, with nobody raising it. The plan asked for a no-op and this was not one.
  it('changes nothing on a project that is already idle', async () => {
    const root = await tempDir();
    await writeAutopilotState(root, { ...IDLE_STATE, iteration: 250 });
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
  it('announces every change once, and a no-op is not a change', async () => {
    const root = await tempDir();
    const { runtime, changes } = build(root);
    await runtime.load();
    // Soft-stopping an IDLE project writes nothing now, so it announces nothing. This used to expect
    // three: the entry that reverted the no-op claimed four tests soft-stopped an idle project
    // deliberately, and by 2026-08-31 it was this one.
    await runtime.softStop();
    await runtime.emergencyStop();
    await runtime.restart();
    expect(changes).toHaveLength(2);
  });

  // THE NO-OP ITSELF, which nothing covered — the reverted fix had no test either way.
  it('does not write `stopped` over a project that never ran', async () => {
    const root = await tempDir();
    const { runtime } = build(root);
    await runtime.load();
    const before = await readAutopilotState(root, AT);
    const result = await runtime.softStop('never mind');
    // `ok`, not a refusal: asking an idle project to stop is a request that is already satisfied, and
    // a red message on a button press that did what the user wanted would be worse than nothing.
    expect(result.ok).toBe(true);
    expect(await readAutopilotState(root, AT)).toEqual(before);
    expect((await readAutopilotState(root, AT)).state).toBe('idle');
  });

  // THE SIBLING OF THE NO-OP ABOVE, and it is about the SENTENCE rather than the state. A loop that
  // ended by itself records why — `complete`, `capped`, `stalled` — and that detail is the only thing on
  // screen telling the user what was left undone. A soft stop arriving afterwards used to overwrite both
  // with "you asked it to", which is then untrue of the very field it wrote. Found by the smoke test
  // 2026-09-17, on a project whose `complete` detail named the feature it had deliberately left alone.
  it('does not write `stopped` over a stop the loop has already explained', async () => {
    const root = await tempDir();
    const { runtime } = build(root);
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'stopped',
      reason: 'complete',
      detail: 'Auto-pilot finished F-001. F-002 is untouched.',
      iteration: 23,
    });
    await runtime.load();
    const before = await readAutopilotState(root, AT);
    const result = await runtime.softStop('never mind');
    expect(result.ok).toBe(true);
    expect(await readAutopilotState(root, AT)).toEqual(before);
    expect((await readAutopilotState(root, AT)).reason).toBe('complete');
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
