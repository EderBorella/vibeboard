import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import {
  autopilotStatePath,
  readAutopilotState,
  updateAutopilotState,
  writeAutopilotState,
} from '../src/server/autopilot-store.js';
import { tempDir } from './helpers.js';

const AT = '2026-08-03T12:00:00.000Z';

describe('auto-pilot state on disk', () => {
  it('is idle for a project that has never run it', async () => {
    expect(await readAutopilotState(await tempDir(), AT)).toEqual(IDLE_STATE);
  });

  it('reads back what was written', async () => {
    const root = await tempDir();
    const state = { ...IDLE_STATE, state: 'running' as const, iteration: 3, servicePgid: 77 };
    await writeAutopilotState(root, state);
    expect(await readAutopilotState(root, AT)).toEqual(state);
  });

  // S13, and the point of the whole test file. Absent means start fresh; UNREADABLE means halt. The
  // two are opposites, and collapsing them either way is a bug: one would halt every new project, the
  // other would un-halt a stopped one by damaging a file.
  describe('when the file cannot be read', () => {
    it('halts on damaged JSON, naming the reason', async () => {
      const root = await tempDir();
      await mkdir(autopilotStatePath(root).replace(/\/[^/]+$/, ''), { recursive: true });
      await writeFile(autopilotStatePath(root), '{"state":"running",', 'utf8');
      const state = await readAutopilotState(root, AT);
      expect(state).toMatchObject({ state: 'halted', reason: 'unreadable', at: AT });
      expect(state.detail).toContain('could not read');
    });

    // A parse failure and an IO failure are different failures, and the fail-closed rule has to cover
    // both — the guard is written against `ENOENT` specifically, so anything else must halt.
    it('halts when the file exists but cannot be opened', async () => {
      const root = await tempDir();
      await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
      await chmod(autopilotStatePath(root), 0o000);
      expect(await readAutopilotState(root, AT)).toMatchObject({ state: 'halted', reason: 'unreadable' });
      await chmod(autopilotStatePath(root), 0o600); // so the suite's own teardown can remove it
    });

    it('leaves the damaged file alone, so there is still something to look at', async () => {
      const root = await tempDir();
      await mkdir(autopilotStatePath(root).replace(/\/[^/]+$/, ''), { recursive: true });
      await writeFile(autopilotStatePath(root), 'not json', 'utf8');
      await readAutopilotState(root, AT);
      const { readFile } = await import('node:fs/promises');
      expect(await readFile(autopilotStatePath(root), 'utf8')).toBe('not json');
    });
  });

  describe('updating it', () => {
    // Two writers, one file: the service owns the counters, the main server owns the state. A blind
    // write from either would lose the other's fields.
    it('preserves the fields the caller did not touch', async () => {
      const root = await tempDir();
      await writeAutopilotState(root, {
        ...IDLE_STATE,
        state: 'running',
        iteration: 9,
        dispatchesSinceCheckup: 4,
        servicePgid: 55,
      });
      const next = await updateAutopilotState(root, AT, (current) => ({
        ...current,
        state: 'stopped',
        reason: 'stopped',
      }));
      expect(next).toMatchObject({
        state: 'stopped',
        reason: 'stopped',
        iteration: 9,
        dispatchesSinceCheckup: 4,
        servicePgid: 55,
      });
      expect(await readAutopilotState(root, AT)).toEqual(next);
    });

    // The only writer that may leave `halted` is `restart`, and it writes the whole state because it is
    // dropping everything deliberately. A merge is always ADDING to what is there, and a counter update
    // carrying a stale `state: running` would silently lift the overlay, re-open dispatch and let the
    // backend respawn — with nobody having decided any of it.
    it('refuses to lift a halt, however the change is written', async () => {
      const root = await tempDir();
      await writeAutopilotState(root, {
        ...IDLE_STATE,
        state: 'halted',
        reason: 'killed',
        detail: 'You stopped everything.',
        at: '2026-08-03T09:00:00.000Z',
      });
      const next = await updateAutopilotState(root, AT, (current) => ({
        ...current,
        state: 'running',
        iteration: 42,
      }));
      expect(next).toMatchObject({
        state: 'halted',
        reason: 'killed',
        detail: 'You stopped everything.',
        at: '2026-08-03T09:00:00.000Z',
      });
      // And nothing was written: the refusal leaves the halt exactly as it was found.
      expect(await readAutopilotState(root, AT)).toMatchObject({ state: 'halted', iteration: 0 });
    });

    it('still allows a merge that keeps the halt, so counters can be recorded', async () => {
      const root = await tempDir();
      await writeAutopilotState(root, { ...IDLE_STATE, state: 'halted', reason: 'killed' });
      const next = await updateAutopilotState(root, AT, (current) => ({ ...current, iteration: 9 }));
      expect(next).toMatchObject({ state: 'halted', iteration: 9 });
    });

    it('starts from idle when there is no file yet', async () => {
      const root = await tempDir();
      const next = await updateAutopilotState(root, AT, (current) => ({ ...current, iteration: 1 }));
      expect(next).toMatchObject({ state: 'idle', iteration: 1 });
    });
  });
});
