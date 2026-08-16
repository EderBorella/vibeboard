import { describe, expect, it } from 'vitest';
import type { RunUsage } from '../src/core/runs.js';
import {
  agentErrorLine,
  infrastructureNote,
  neverReachedModel,
  type RunEnding,
} from '../src/server/runs/fault.js';

// WHOSE FAILURE A DEAD RUN WAS — src/server/runs/fault.ts, the decision `#endWithoutReport` takes about a
// run that ended with no report of its own.
//
// EVERY NUMBER BELOW IS OFF A REAL RECORD, both of them written by the same card hours apart on
// 2026-08-15. Inventing a plausible dead run is exactly how this would have been built on `turns: 0`,
// which no failure has ever produced: the CLI reports a turn for a run that never opened a connection.

// The healthy one: a break-down that ran for two minutes and delivered.
const HEALTHY: RunUsage = {
  costUsd: 0.805,
  durationMs: 126512,
  turns: 13,
  contextTokens: 56741,
  outputTokens: 9027,
};

// The dead one: a box holding a credential whose inode had been replaced on the host. Note `turns: 1`.
const DEAD_BOX: RunUsage = { costUsd: 0, durationMs: 57, turns: 1, contextTokens: 0, outputTokens: 0 };

// The transcript that run left, verbatim but for the session id, which is a real identifier off a real
// machine and proves nothing here — what this fixture is for is the SHAPE: an init frame, the harness's
// one line of prose, a usage frame, a result frame, and a closing marker that repeats the exit code.
const DEAD_TRANSCRIPT = [
  '{"kind":"init","sessionId":"session-under-test","model":"claude-opus-5","permissionMode":"bypassPermissions"}',
  '{"kind":"text","text":"Failed to authenticate: OAuth session expired and could not be refreshed"}',
  '{"kind":"usage","contextTokens":0}',
  '{"kind":"result","sessionId":"session-under-test","stats":{"ok":false,"text":"Failed to authenticate: OAuth session expired and could not be refreshed","costUsd":0,"durationMs":57,"turns":1,"contextTokens":0,"outputTokens":0}}',
  '{"kind":"text","text":"\\n[copilot exited (1)]"}',
].join('\n');

const AUTH_ERROR = 'Failed to authenticate: OAuth session expired and could not be refreshed';

const ending = (over: Partial<RunEnding> = {}): RunEnding => ({
  cancelled: false,
  timedOut: false,
  exitCode: 1,
  usage: DEAD_BOX,
  ...over,
});

describe('the model was never engaged', () => {
  it('classifies the run that died against a replaced credential', () => {
    expect(neverReachedModel(ending())).toBe(true);
  });

  // THE CASE THE CONSERVATIVE DIRECTION IS FOR. This run reached a model thirteen times and wrote nine
  // thousand tokens; whatever went wrong afterwards, the work had its chance and the card is answerable.
  it('does not classify a failure that reached a model', () => {
    expect(neverReachedModel(ending({ usage: HEALTHY }))).toBe(false);
  });

  // A TIMEOUT MUST KEEP BURNING — accounting.ts calls that mapping load-bearing, because a card that hangs
  // every time would otherwise retry until the iteration or budget cap took the whole run down. The usage is
  // the dead-box usage deliberately: the refusal must come from the timeout and not from the numbers.
  it('does not classify a timeout, whatever its usage says', () => {
    expect(neverReachedModel(ending({ timedOut: true }))).toBe(false);
  });

  // Already not-burning, and a decision a person took. Re-labelling it would put a run somebody stopped by
  // hand into the streak that halts the whole project.
  it('does not classify a run the user cancelled', () => {
    expect(neverReachedModel(ending({ cancelled: true }))).toBe(false);
  });

  // Absence and zero are different facts, which is what RunUsage is built on. A backend that reported nothing
  // has not said the model was never reached — it has said nothing.
  it('does not classify a run whose backend reported no usage at all', () => {
    const { usage: _dropped, ...withoutUsage } = ending();
    expect(neverReachedModel(withoutUsage)).toBe(false);
  });

  // Each token count on its own, because either one alone leaves the other free to be anything. A run that
  // sent a whole prompt and got nothing back is not a run that never reached a model.
  it('does not classify a run that accounted for context but no output', () => {
    expect(neverReachedModel(ending({ usage: { ...DEAD_BOX, contextTokens: 56741 } }))).toBe(false);
  });

  it('does not classify a run that produced output but reported no context', () => {
    expect(neverReachedModel(ending({ usage: { ...DEAD_BOX, outputTokens: 9027 } }))).toBe(false);
  });

  // A zero exit is not a failure at all — `#endWithoutReport` records it as `attention` — and `null` is death
  // by signal, where nothing on the record tells an OOM kill from a process somebody killed by hand.
  it('does not classify a clean exit or a death by signal', () => {
    expect(neverReachedModel(ending({ exitCode: 0 }))).toBe(false);
    expect(neverReachedModel(ending({ exitCode: null }))).toBe(false);
  });
});

describe('the error the run actually gave', () => {
  // THE POINT OF THE WHOLE HALF: "exited with code 1" sends a reader to the card, and this sends them to the
  // one place that can fix it.
  it('pulls the harness’s own line out of the transcript', () => {
    expect(agentErrorLine(DEAD_TRANSCRIPT)).toBe(AUTH_ERROR);
  });

  // The transcript's LAST text frame is `[copilot exited (1)]`, so a bare "last text wins" would quote the
  // exit code back at the reader in a second format and drop the only sentence that mattered.
  it('does not quote the closing marker', () => {
    expect(agentErrorLine(DEAD_TRANSCRIPT)).not.toContain('exited');
  });

  // The tail is JSONL. A reader shown a usage frame as the reason their run died is worse off than one shown
  // the exit code, so anything that is not an agent text frame answers nothing.
  it('answers nothing for a transcript with no text in it', () => {
    const quiet = ['{"kind":"usage","contextTokens":0}', 'not json at all', '{"kind":"init"}'].join('\n');
    expect(agentErrorLine(quiet)).toBeUndefined();
  });

  it('answers nothing for an empty transcript', () => {
    expect(agentErrorLine('')).toBeUndefined();
  });

  // A note is a line in a UI and a clause in a log sentence, so an agent that died mid-paragraph must not
  // push either off the screen.
  it('bounds what it quotes', () => {
    const long = JSON.stringify({ kind: 'text', text: 'x'.repeat(500) });
    const quoted = agentErrorLine(long) ?? '';
    expect(quoted.length).toBeLessThanOrEqual(201);
    expect(quoted.endsWith('…')).toBe(true);
  });
});

describe('the note that replaces “exited with code 1 and wrote no report”', () => {
  it('names the error and the exit code', () => {
    const note = infrastructureNote(ending(), DEAD_TRANSCRIPT);
    expect(note).toBe(`The agent never reached a model: ${AUTH_ERROR} (exit code 1).`);
  });

  // Never silently blank: a run that says nothing about why still has to say that it never reached a model,
  // or the stop above it quotes an empty string at a person.
  it('says so plainly when the transcript explains nothing', () => {
    const note = infrastructureNote(ending(), '{"kind":"usage","contextTokens":0}');
    expect(note).toBe('The agent never reached a model and its transcript does not say why (exit code 1).');
  });
});
