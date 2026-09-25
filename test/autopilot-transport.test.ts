import { describe, expect, it } from 'vitest';
import type { AutopilotState, Readiness, RunList, RunRecord } from '../web/src/lib/api.js';
import { transportModel } from '../web/src/organisms/autopilot/transport.js';

// The decisions behind the transport strip, asserted directly. The alternative is mocking four hooks to
// check a sentence, and every defect in this feature so far has hidden behind exactly that.

const IDLE: AutopilotState = { state: 'idle', iteration: 0 };
const NO_RUNS: RunList = { runs: [], active: [], queued: [] };

const run = (over: Partial<RunRecord>): RunRecord =>
  ({
    run: 'r1',
    skill: 'implement',
    status: 'running',
    started: '2026-08-07T09:00:00.000Z',
    backend: 'claude-code',
    model: 'opus',
    effort: 'medium',
    mode: 'default',
    report: '',
    ...over,
  }) as RunRecord;

const ready: Readiness = {
  ok: true,
  blockers: [],
  readme: { ok: true },
  foundation: { present: [], missing: [], ok: true },
  gates: { ok: true, count: 2 },
  smoke: { ok: true },
  phases: { problems: [], count: 3 },
  unreviewedGates: [],
};
const unready: Readiness = { ...ready, ok: false, blockers: ['README is empty', 'no gate commands'] };

const model = (over: Partial<Parameters<typeof transportModel>[0]> = {}) =>
  transportModel({ state: IDLE, runs: NO_RUNS, readiness: null, starting: false, ...over });

describe('which control is offered', () => {
  it('offers play when idle', () => {
    const m = model();
    expect(m.control.kind).toBe('play');
    expect(m.control.disabled).toBe(false);
  });

  it('offers stop while running, and says it is the reversible one', () => {
    const m = model({ state: { ...IDLE, state: 'running', iteration: 3 } });
    expect(m.control.kind).toBe('stop');
    expect(m.control.disabled).toBe(false);
    expect(m.control.title).toMatch(/nothing is killed/i);
  });

  // Pressing it is how you learn what is missing — the server refuses with a sentence naming the
  // blockers. A greyed-out button says only "no", which is the thing this whole strip replaces.
  it('leaves play PRESSABLE on a project that is not ready', () => {
    const m = model({ readiness: unready });
    expect(m.control.kind).toBe('play');
    expect(m.control.disabled).toBe(false);
  });

  // The one exception, because it would refuse every time and the way back is a decision on the overlay.
  it('disables play on a halted project and says where to go', () => {
    const m = model({ state: { ...IDLE, state: 'halted', reason: 'killed' } });
    expect(m.control.disabled).toBe(true);
    expect(m.control.title).toMatch(/restart it from the overlay/i);
  });

  it('disables play between the click and the answer, so it cannot be pressed twice', () => {
    const m = model({ starting: true });
    expect(m.control.disabled).toBe(true);
    expect(m.control.label).toBe('Starting…');
  });
});

describe('the status line', () => {
  // `status` MAY NOW BE BLANK, AND `word` IS WHAT MUST NOT BE. This was *is never blank* — "a strip that
  // says nothing is a strip nobody trusts" — and it was right while this string was the row's only
  // statement of the state. The chip beside it carries the state now, so for these three the row was the
  // chip's own word again with a full stop after it. The claim moves rather than being dropped: the SAME
  // three states, asserted on the field that is now the one carrying them.
  it('always says what state it is in, even where the row says nothing', () => {
    for (const state of [null, IDLE, { ...IDLE, state: 'stopped' as const }]) {
      const m = model({ state });
      expect(m.word.length, 'the chip must always have a word').toBeGreaterThan(0);
      expect(m.status, 'and these three are exactly the states whose row is empty').toBe('');
      // The balloon is the third statement, and it is never empty either — a chip that opens onto
      // nothing teaches people that opening it is not worth it.
      expect(m.advice.heading.length).toBeGreaterThan(0);
      expect(m.advice.detail.length).toBeGreaterThan(0);
    }
  });

  it('counts dispatches and names the card being worked on', () => {
    const m = model({
      state: { ...IDLE, state: 'running', iteration: 3 },
      runs: { runs: [run({ run: 'r1', card: 'E-004', skill: 'implement' })], active: ['r1'], queued: [] },
    });
    expect(m.status).toBe('3 dispatches · E-004 · implement');
  });

  it('agrees with itself about one dispatch', () => {
    expect(model({ state: { ...IDLE, state: 'running', iteration: 1 } }).status).toContain('1 dispatch ·');
  });

  // Between dispatches there is genuinely nothing running. Saying so beats a line that reads as stalled.
  it('says it is choosing when running with nothing in flight', () => {
    const m = model({ state: { ...IDLE, state: 'running', iteration: 2 } });
    expect(m.status).toBe('2 dispatches · choosing the next card');
  });

  // The loop's own sentence names WHICH cards are stuck. It used to be reachable only by hovering a chip.
  it('shows the stop’s own explanation rather than the one-word reason', () => {
    const m = model({
      state: {
        ...IDLE,
        state: 'stopped',
        reason: 'stalled',
        detail: 'E-002 and E-005 are blocked on their gates',
      },
    });
    // The row stays a row; the explanation moves to `detail`, which the bar renders in its own wrapping
    // block. It used to BE the status — one line, ellipsised — so these sentences, which quote git and
    // name several cards, were cut exactly where they got useful.
    // AND THE ONE-WORD REASON IS THE CHIP'S. `status` was `Stopped.` here, which is the word `stopped`
    // with a full stop, beside a chip that already says `stalled` — so the row says nothing and the
    // reason is asserted where it now lives.
    expect(m.word).toBe('stalled');
    expect(m.status).toBe('');
    expect(m.detail).toBe('E-002 and E-005 are blocked on their gates');
  });

  it('says COMPLETE rather than stopped for the one reason that is a success', () => {
    const m = model({ state: { ...IDLE, state: 'stopped', reason: 'complete' } });
    // The word was `Finished.` in the row; it is the reason itself in the chip, and `complete` is the
    // only reason `isSuccessReason` admits. `state` is the tone's route and is checked beside it, because
    // the word alone would pass on a chip painted like a failure.
    expect(m.word).toBe('complete');
    expect(m.state).toBe('complete');
  });

  it('carries no detail while running or idle — there is nothing to explain', () => {
    expect(model({ state: { ...IDLE, state: 'running', iteration: 1 } }).detail).toBeNull();
    expect(model({ state: IDLE }).detail).toBeNull();
  });

  it('counts what is missing when nothing has run yet', () => {
    expect(model({ readiness: unready }).status).toBe('2 things to fix before it can start');
    expect(model({ readiness: { ...unready, blockers: ['one thing'] } }).status).toBe(
      '1 thing to fix before it can start',
    );
  });

  it('explains a halt, with the reason below rather than truncated into the row', () => {
    const m = model({ state: { ...IDLE, state: 'halted', detail: 'Killed at your request.' } });
    // The word `Halted` came off the front of this sentence when the chip started carrying it. What is
    // left is the part the chip cannot fit and a person does not expect — a halt stops the chat and the
    // manual runs too — so the row is NOT empty for this state, unlike the two above.
    expect(m.word).toBe('halted');
    expect(m.status).toBe('Everything in this project was stopped.');
    expect(m.detail).toBe('Killed at your request.');
  });
});

describe('what it is doing', () => {
  it('names the card and skill of each active run, and marks the queued ones', () => {
    const m = model({
      runs: {
        runs: [
          run({ run: 'r1', card: 'E-004', skill: 'implement' }),
          run({ run: 'r2', card: 'E-009', skill: 'test' }),
        ],
        active: ['r1'],
        queued: ['r2'],
      },
    });
    expect(m.doing).toEqual([
      { run: 'r1', label: 'E-004', skill: 'implement', waiting: false },
      { run: 'r2', label: 'E-009', skill: 'test', waiting: true },
    ]);
  });

  // A checkup or a pre-flight belongs to the project, not to a card. A bare run id would tell a person
  // nothing.
  it('says "this project" for a run with no card', () => {
    const m = model({ runs: { runs: [run({ run: 'r1', skill: 'checkup' })], active: ['r1'], queued: [] } });
    expect(m.doing[0]).toMatchObject({ label: 'this project', skill: 'checkup' });
  });

  it('survives an active id whose record has not arrived yet', () => {
    // The active list comes from the server's own memory and the records from disk, so they can be one
    // fetch apart. Rendering nothing at all for a run that IS working would be the wrong answer.
    const m = model({ runs: { runs: [], active: ['r-unknown'], queued: [] } });
    expect(m.doing).toEqual([{ run: 'r-unknown', label: 'this project', skill: 'a skill', waiting: false }]);
  });
});

describe('what is missing', () => {
  it('lists the blockers when the project is not ready', () => {
    expect(model({ readiness: unready }).missing).toEqual(['README is empty', 'no gate commands']);
  });

  it('lists nothing when it is ready', () => {
    expect(model({ readiness: ready }).missing).toEqual([]);
  });

  // NOT ASKED is not the same as NOTHING MISSING. Inventing reassurance for the length of a round trip
  // is the same class of lie as a board that renders while every call fails.
  it('claims nothing before the answer has arrived', () => {
    const m = model({ readiness: null });
    expect(m.missing).toEqual([]);
    expect(m.word).toBe('not started');
    expect(m.status).toBe('');
    // AND THE BALLOON MUST NOT INVENT A BLOCKER IT HAS NOT BEEN TOLD ABOUT. `missing` is empty because
    // nothing has answered yet, which is not the same as "nothing is wrong" — the advice for an idle
    // project splits on that list, so this is the branch that must take the no-blockers side.
    expect(m.advice.detail).toBe('Nothing has been dispatched on this project yet.');
  });
});

describe('whether the drawer is worth opening', () => {
  // A disclosure arrow that reveals emptiness is worse than no arrow.
  it('is not expandable with nothing to show', () => {
    expect(model({ readiness: ready }).expandable).toBe(false);
  });

  it('is expandable when something is running', () => {
    const m = model({ runs: { runs: [run({ card: 'E-1' })], active: ['r1'], queued: [] } });
    expect(m.expandable).toBe(true);
  });

  it('is expandable when something is missing', () => {
    expect(model({ readiness: unready }).expandable).toBe(true);
  });
});

// `state` AND NOT `tone`, and the values are unchanged: Phase 13 renamed the FIELD because these five
// are state names — a tone is one of the five colours in web/src/design/state-tones.ts, and calling the
// state a tone is what let three surfaces each hold their own translation of it.
describe('the transport state', () => {
  it.each([
    ['idle', IDLE, 'idle'],
    ['running', { ...IDLE, state: 'running' as const }, 'running'],
    ['halted', { ...IDLE, state: 'halted' as const }, 'halted'],
    // `complete` is the ONLY stop that reads as a success: an exhausted budget and a reached cap both
    // end tidily, and neither means the work is done.
    ['a completed run', { ...IDLE, state: 'stopped' as const, reason: 'complete' as const }, 'complete'],
    ['an exhausted budget', { ...IDLE, state: 'stopped' as const, reason: 'exhausted' as const }, 'stopped'],
    ['a reached cap', { ...IDLE, state: 'stopped' as const, reason: 'capped' as const }, 'stopped'],
    ['a stall', { ...IDLE, state: 'stopped' as const, reason: 'stalled' as const }, 'stopped'],
  ])('reads %s as %s', (_name, state, expected) => {
    expect(model({ state }).state).toBe(expected);
  });

  it('is idle before the first answer', () => {
    expect(model({ state: null }).state).toBe('idle');
  });
});

// FIX BOARD'S BUTTON (decision 88), disabled exactly where the server refuses it and saying which refusal.
describe('whether Fix board can be pressed', () => {
  it('can be pressed on a stopped board with nothing in flight, and says what it hands over', () => {
    const repair = model({ state: { state: 'stopped', iteration: 3, reason: 'stalled' } }).repair;
    expect(repair.disabled).toBe(false);
    expect(repair.title).toMatch(/elevated powers over the board for one conversation/);
  });

  it.each([
    ['a running loop', { state: { state: 'running', iteration: 2 } as AutopilotState }, /Soft-stop it/],
    ['a halt', { state: { state: 'halted', iteration: 2 } as AutopilotState }, /halted/],
    ['a run in flight', { runs: { runs: [run({})], active: ['r1'], queued: [] } }, /still working/],
    ['a queued run', { runs: { runs: [run({})], active: [], queued: ['r1'] } }, /still working/],
  ])('is disabled under %s, and says so', (_what, over, why) => {
    const repair = model(over).repair;
    expect(repair.disabled).toBe(true);
    expect(repair.title).toMatch(why);
  });
});
