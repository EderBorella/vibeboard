import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { type AutopilotState, IDLE_STATE } from '../src/core/autopilot-state.js';
import {
  autopilotStatePath,
  readAutopilotState,
  updateAutopilotState,
  writeAutopilotState,
} from '../src/store/autopilot-store.js';
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

    // Two writers, one file, and read-modify-write is not atomic. The halt guard above is evaluated
    // against the value read at the START of the update, so a halt written between that read and the
    // write was simply overwritten — the guard never saw it. Whichever order these two run in, both
    // changes must survive: the halt because losing it re-opens dispatch on a project whose agents are
    // dead, and the counter because rolling it back re-runs work already paid for.
    //
    // Found by a load-sensitive failure in the HTTP-level test for the same pair, which passed on a quiet
    // machine and failed inside a full 151-file run. This is that race, stated so it cannot depend on
    // timing.
    it('loses neither change when two writers update it at once', async () => {
      const root = await tempDir();
      await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 41 });
      await Promise.all([
        updateAutopilotState(root, AT, (current) => ({
          ...current,
          state: 'halted',
          reason: 'killed',
        })),
        updateAutopilotState(root, AT, (current) => ({ ...current, iteration: 42 })),
      ]);
      expect(await readAutopilotState(root, AT)).toMatchObject({
        state: 'halted',
        reason: 'killed',
        iteration: 42,
      });
    });

    it('starts from idle when there is no file yet', async () => {
      const root = await tempDir();
      const next = await updateAutopilotState(root, AT, (current) => ({ ...current, iteration: 1 }));
      expect(next).toMatchObject({ state: 'idle', iteration: 1 });
    });
  });

  // Whole-file writes, which `load()` and `restart()` both make. `writeFile` TRUNCATES and then writes, so
  // two of them at once leave the longer one's tail past the shorter one's end — and the result does not
  // parse, so S13 fail-closes the project to `halted / unreadable`, blaming a corrupt file that VibeBoard
  // corrupted itself. Both calls report success while it happens.
  //
  // `load()` needs no user action to reach this: it writes precisely when it found `running` on disk, which
  // is exactly when a service is ticking counters through the other path.
  describe('writing the whole state', () => {
    it('never leaves a file that cannot be read', async () => {
      const root = await tempDir();
      // Long and short, so a surviving tail is detectable rather than coincidentally identical.
      const long: AutopilotState = {
        ...IDLE_STATE,
        state: 'halted',
        reason: 'killed',
        detail: 'A detail long enough that its tail would survive a shorter write over the top of it.',
        at: AT,
      };
      const short: AutopilotState = { ...IDLE_STATE, at: AT };

      // What this constrains, stated exactly: corruption needs BOTH defences gone. Planted separately,
      // each one alone keeps the file parseable — the rename because concurrent writes each land whole, the
      // queue because they never overlap. So this test goes red only when both are removed, which is the
      // honest description of a belt-and-braces pair. The queue's own unique property (ordering, and the
      // atomicity of read-modify-write) is pinned by the two tests above; the rename's is cross-process
      // safety, which no same-process test can show.
      for (let i = 0; i < 20; i += 1) {
        const dir = await tempDir();
        await Promise.all([writeAutopilotState(dir, long), writeAutopilotState(dir, short)]);
        const raw = await readFile(autopilotStatePath(dir), 'utf8');
        // The bytes, not the parsed result: `readAutopilotState` turns damage into a HALT, so asserting on
        // its answer would report the symptom the fail-closed rule produces rather than the corruption.
        expect(() => JSON.parse(raw), raw).not.toThrow();
        expect(await readAutopilotState(dir, AT), raw).not.toMatchObject({ reason: 'unreadable' });
      }
      expect(root).toBeTruthy();
    });

    // The two paths share one file, so they must share one queue. A whole-file write landing inside another
    // writer's read-modify-write is the same corruption by a different route.
    it('does not interleave with a read-modify-write', async () => {
      const root = await tempDir();
      await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 5 });
      await Promise.all([
        writeAutopilotState(root, { ...IDLE_STATE, state: 'halted', reason: 'killed', at: AT }),
        updateAutopilotState(root, AT, (current) => ({ ...current, iteration: 6 })),
      ]);
      const raw = await readFile(autopilotStatePath(root), 'utf8');
      expect(() => JSON.parse(raw), raw).not.toThrow();
    });
  });

  describe('the idle fallback', () => {
    it('starts from idle when there is no file yet, again', async () => {
      const root = await tempDir();
      const next = await updateAutopilotState(root, AT, (current) => ({ ...current, iteration: 1 }));
      expect(next).toMatchObject({ state: 'idle', iteration: 1 });
    });
  });
});
