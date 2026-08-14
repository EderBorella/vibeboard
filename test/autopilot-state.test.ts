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

  it('defaults the counter when a valid record omits it', () => {
    expect(parseState('{"state":"running"}')).toEqual({ state: 'running', iteration: 0 });
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

  // A BEHAVIOUR CHANGE, made deliberately when the four copies of trim-to-undefined became one.
  //
  // This module's copy tested `value.trim() !== ''` and then returned the UNTRIMMED value, so a
  // `detail` with padding reached the halt overlay carrying it while every other reader of an optional
  // string field in the codebase stripped it. `core/parse.ts`'s `asText` is the other three's
  // behaviour, and it is now this one's. Exact strings rather than `toContain`, because the padding IS
  // the behaviour under test.
  it('trims a detail and a timestamp rather than carrying the padding into the overlay', () => {
    expect(
      parseState('{"state":"halted","detail":"  everything stopped  ","at":" 2026-08-03T09:00:00.000Z "}'),
    ).toMatchObject({ detail: 'everything stopped', at: '2026-08-03T09:00:00.000Z' });
  });

  // The half of the rule that did not change: blank is the same answer as absent, so a field somebody
  // started and did not finish is dropped rather than carried as ''.
  it('drops a detail that is nothing but whitespace', () => {
    const parsed = parseState('{"state":"halted","detail":"   "}');
    expect(parsed === 'unreadable' || 'detail' in parsed).toBe(false);
  });
});

describe('reconciling a state found on disk at startup', () => {
  const at = '2026-08-03T12:00:00.000Z';

  // A server restart can find `running` with no live processes: its children died with it. Auto-pilot
  // must come back STOPPED rather than resuming dispatch on the assumption those runs went fine. It no
  // longer sets a checkup flag with it (decision 47): the position is re-derived every tick, a task left
  // in review is re-judged or re-stamped, and an in-flight run is interrupted and burns no attempt.
  it('turns a running project with no live process into a stopped one', () => {
    const next = reconcile({ ...IDLE_STATE, state: 'running', iteration: 7 }, at);
    expect(next).toMatchObject({
      state: 'stopped',
      reason: 'interrupted',
      iteration: 7,
      at,
    });
    expect('needsCheckup' in next).toBe(false);
  });

  // The half that was NOT true, and the comment claiming it was is now corrected in the source: the loop is
  // spawned detached, in its own session, so it survives a terminal's Ctrl-C, a SIGHUP and its parent's
  // death. 275 orphans accumulated on one machine before the shutdown path took it down. So `running` with a
  // group that is genuinely still alive is TRUE, and declaring it stopped is what put a live loop and a
  // panel showing `stopped` in the same project — reachable just by reopening the project that is open.
  it('leaves a running project alone when its loop is genuinely still alive', () => {
    const running = { ...IDLE_STATE, state: 'running' as const, servicePgid: 4242, servicePgstart: 99 };
    expect(reconcile(running, at, () => true)).toEqual(running);
  });

  it('and stops it when the recorded group is not the one recorded', () => {
    const running = { ...IDLE_STATE, state: 'running' as const, servicePgid: 4242, servicePgstart: 99 };
    expect(reconcile(running, at, () => false)).toMatchObject({ state: 'stopped', reason: 'interrupted' });
  });

  // FAIL CLOSED, which is why the parameter has a default at all: a caller that cannot tell whether the
  // group is alive gets the conservative answer rather than a project left claiming to be running.
  it('stops it when nothing can say whether the loop is alive', () => {
    const running = { ...IDLE_STATE, state: 'running' as const, servicePgid: 4242, servicePgstart: 99 };
    expect(reconcile(running, at)).toMatchObject({ state: 'stopped' });
    // And a recorded pgid with no start time is not identifiable, so it cannot be trusted either — the same
    // rule the reaper follows for a run record.
    const noStart = { ...IDLE_STATE, state: 'running' as const, servicePgid: 4242 };
    expect(reconcile(noStart, at, () => true)).toMatchObject({ state: 'stopped' });
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
