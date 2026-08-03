import { describe, expect, it } from 'vitest';
import {
  AUTOPILOT_STATES,
  IDLE_STATE,
  parseState,
  reconcile,
  serializeState,
} from '../src/core/autopilot-state.js';

// Decision 15: auto-pilot's state is PERSISTED, because it must behave consistently. If `running`
// survives a page reload then `halted` must too — otherwise a reload would bypass the overlay, which
// is the one piece of UI whose whole job is to say the project has been stopped.

const state = (over: Partial<ReturnType<typeof parseState>> = {}) => ({
  ...IDLE_STATE,
  ...(over as object),
});

describe('the state record', () => {
  it('round-trips', () => {
    const running = {
      state: 'running' as const,
      iteration: 12,
      dispatchesSinceCheckup: 2,
      needsCheckup: false,
      servicePgid: 4242,
      at: '2026-08-03T10:00:00.000Z',
    };
    expect(parseState(serializeState(running))).toEqual(running);
  });

  it('accepts every state it defines', () => {
    for (const name of AUTOPILOT_STATES) {
      expect(parseState(serializeState(state({ state: name })))).toMatchObject({ state: name });
    }
  });

  it('defaults the counters when a valid record omits them', () => {
    expect(parseState('{"state":"running"}')).toEqual({
      state: 'running',
      iteration: 0,
      dispatchesSinceCheckup: 0,
      needsCheckup: false,
    });
  });

  it('refuses a state it does not know', () => {
    expect(parseState('{"state":"cruising"}')).toBe('unreadable');
  });

  it('refuses anything that is not an object', () => {
    expect(parseState('null')).toBe('unreadable');
    expect(parseState('[]')).toBe('unreadable');
    expect(parseState('not json at all')).toBe('unreadable');
  });

  // The counter is compared with `>=` against maxIterations. A fractional one is a threshold the
  // comparison would step straight over, and a negative one buys extra dispatches.
  it('refuses a counter that is not a whole number at or above zero', () => {
    expect(parseState('{"state":"running","iteration":2.5}')).toBe('unreadable');
    expect(parseState('{"state":"running","iteration":-1}')).toBe('unreadable');
    expect(parseState('{"state":"running","dispatchesSinceCheckup":-3}')).toBe('unreadable');
  });

  // Dropped rather than refused: a reason is what the overlay SHOWS, and refusing the record over it
  // would be a worse outcome than showing the halt without its label — the state itself is the thing
  // that must survive.
  it('drops a reason it does not recognise but keeps the state', () => {
    const parsed = parseState('{"state":"halted","reason":"vibes"}');
    expect(parsed).toMatchObject({ state: 'halted' });
    expect(parsed === 'unreadable' || 'reason' in parsed).toBe(false);
  });

  it('drops a service pgid that could not be one', () => {
    expect(parseState('{"state":"running","servicePgid":0}')).toMatchObject({ state: 'running' });
    expect(parseState('{"state":"running","servicePgid":-9}')).not.toMatchObject({ servicePgid: -9 });
  });
});

describe('reconciling a state found on disk at startup', () => {
  const at = '2026-08-03T12:00:00.000Z';

  // A server restart can find `running` with no live processes: its children died with it. Auto-pilot
  // must come back needing a checkup rather than resuming dispatch on the assumption those runs are
  // still going.
  it('turns a running project into one that owes a checkup', () => {
    const next = reconcile({ ...IDLE_STATE, state: 'running', iteration: 7 }, at);
    expect(next).toMatchObject({
      state: 'stopped',
      reason: 'interrupted',
      needsCheckup: true,
      iteration: 7,
      at,
    });
  });

  // The reason persistence exists. A restart must not be a way out of `halted`.
  it('leaves a halted project halted, with its reason and timestamp intact', () => {
    const halted = {
      ...IDLE_STATE,
      state: 'halted' as const,
      reason: 'killed' as const,
      detail: 'You stopped everything.',
      at: '2026-08-03T09:00:00.000Z',
    };
    expect(reconcile(halted, at)).toEqual(halted);
  });

  it('leaves idle and stopped alone', () => {
    expect(reconcile(IDLE_STATE, at)).toEqual(IDLE_STATE);
    const stopped = { ...IDLE_STATE, state: 'stopped' as const, reason: 'complete' as const };
    expect(reconcile(stopped, at)).toEqual(stopped);
  });

  // The reaper runs after the reconcile and needs somewhere to look.
  it('keeps the service pgid, which is what the reaper is about to use', () => {
    const next = reconcile({ ...IDLE_STATE, state: 'running', servicePgid: 991 }, at);
    expect(next).toMatchObject({ servicePgid: 991 });
  });
});
