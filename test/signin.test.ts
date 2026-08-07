import { describe, expect, it } from 'vitest';
import {
  MAX_OUTSTANDING,
  MAX_PER_HOUR,
  MIN_GAP_MS,
  PendingRequests,
  REQUEST_TTL_MS,
  signinClosed,
} from '../src/server/signin.js';

// The state machine behind "a browser already signed in allows this one". Its limits are not tidiness:
// the attack on this path is PROMPT FATIGUE — a caller that can raise a dialog as often as it likes
// eventually catches an absent-minded Allow — so the cap, the gap and the TTL are the mitigation.

function harness(opts: { mintFails?: boolean } = {}): {
  requests: PendingRequests;
  minted: string[];
  changes: number;
  advance: (ms: number) => void;
} {
  const state = { ms: Date.parse('2026-08-07T09:00:00.000Z'), changes: 0 };
  const minted: string[] = [];
  const requests = new PendingRequests({
    mint: async (label) => {
      if (opts.mintFails) throw new Error('the disk went away');
      minted.push(label);
      return `dev_${minted.length}.secret-${minted.length}`;
    },
    now: () => new Date(state.ms),
    onChange: () => {
      state.changes += 1;
    },
  });
  return {
    requests,
    minted,
    get changes() {
      return state.changes;
    },
    advance: (ms: number) => {
      state.ms += ms;
    },
  };
}

// Every `open` after the first has to clear the ten-second gap, so tests that need several requests
// step the clock rather than fighting the rate limit they are not testing.
function opened(h: ReturnType<typeof harness>, count: number, agent = 'Firefox'): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i > 0) h.advance(MIN_GAP_MS);
    const result = h.requests.open(`${agent} ${i}`, '127.0.0.1');
    if (typeof result === 'string') throw new Error(`open ${i} was ${result}`);
    ids.push(result.id);
  }
  return ids;
}

describe('opening a request', () => {
  it('gives an unguessable id and lists it for the browsers that can approve it', () => {
    const h = harness();
    const [id] = opened(h, 1);

    // 32 bytes of base64url. Guessable ids would let a second caller collect the token a person
    // approved for the first, which no amount of prompt copy could mitigate.
    expect(id).toHaveLength(43);
    expect(h.requests.list()).toEqual([
      { id, label: 'Firefox 0', address: '127.0.0.1', at: '2026-08-07T09:00:00.000Z' },
    ]);
  });

  it('sanitises the label it was handed, because that label is rendered in a prompt', () => {
    const h = harness();
    h.requests.open(undefined, '127.0.0.1');
    expect(h.requests.list()[0].label).toBe('Unknown browser');
  });

  it('tells the signed-in browsers as soon as anything changes', () => {
    const h = harness();
    expect(h.changes).toBe(0);
    opened(h, 1);
    expect(h.changes).toBe(1);
  });
});

describe('the limits', () => {
  it('refuses a second request inside the gap and allows one after it', () => {
    const h = harness();
    opened(h, 1);

    expect(h.requests.open('Firefox', '127.0.0.1')).toBe('rate-limited');

    h.advance(MIN_GAP_MS);
    expect(h.requests.open('Firefox', '127.0.0.1')).not.toBe('rate-limited');
  });

  it('refuses more than the outstanding cap', () => {
    const h = harness();
    opened(h, MAX_OUTSTANDING);
    h.advance(MIN_GAP_MS);

    expect(h.requests.open('Firefox', '127.0.0.1')).toBe('too-many');
  });

  // The cap counts what is WAITING, not what has ever been asked. Otherwise three refusals would
  // lock the user out of their own board until the process restarted.
  it('counts only what is still pending against the cap', () => {
    const h = harness();
    const ids = opened(h, MAX_OUTSTANDING);
    h.requests.refuse(ids[0]);
    h.advance(MIN_GAP_MS);

    expect(h.requests.open('Firefox', '127.0.0.1')).not.toBe('too-many');
  });

  it('refuses more than the hourly allowance even when nothing is outstanding', () => {
    const h = harness();
    for (let i = 0; i < MAX_PER_HOUR; i += 1) {
      if (i > 0) h.advance(MIN_GAP_MS);
      const result = h.requests.open('Firefox', '127.0.0.1');
      expect(typeof result, `request ${i}`).toBe('object');
      if (typeof result !== 'string') h.requests.refuse(result.id); // keep the outstanding cap clear
    }

    h.advance(MIN_GAP_MS);
    expect(h.requests.open('Firefox', '127.0.0.1')).toBe('rate-limited');

    // And the hour is a sliding window, not a permanent lock.
    h.advance(3_600_000);
    expect(h.requests.open('Firefox', '127.0.0.1')).not.toBe('rate-limited');
  });

  it('forgets a request nobody dealt with', () => {
    const h = harness();
    const [id] = opened(h, 1);

    h.advance(REQUEST_TTL_MS + 1);

    expect(h.requests.list()).toEqual([]);
    expect(h.requests.collect(id)).toEqual({ state: 'expired' });
    // And a prompt someone clicks after it timed out says so rather than appearing to do nothing.
    expect(h.requests.refuse(id)).toBe(false);
  });
});

describe('approving', () => {
  it('mints a credential and hands it over exactly once', async () => {
    const h = harness();
    const [id] = opened(h, 1);

    expect(await h.requests.approve(id)).toBe('ok');

    expect(h.minted).toEqual(['Firefox 0']);
    expect(h.requests.collect(id)).toEqual({ state: 'approved', token: 'dev_1.secret-1' });
    expect(h.requests.collect(id)).toEqual({ state: 'expired' });
  });

  it('takes it off the list the moment it is approved, so the prompt disappears', async () => {
    const h = harness();
    const [id] = opened(h, 1);
    await h.requests.approve(id);
    expect(h.requests.list()).toEqual([]);
  });

  // Two clicks on one prompt. `minting` is set synchronously before the await for this: without it
  // both calls mint, and the second device exists with nobody holding its credential — a phantom row
  // in the device list forever.
  it('mints once for two simultaneous approvals of the same request', async () => {
    const h = harness();
    const [id] = opened(h, 1);

    const [a, b] = await Promise.all([h.requests.approve(id), h.requests.approve(id)]);

    expect([a, b].sort()).toEqual(['ok', 'unknown']);
    expect(h.minted).toHaveLength(1);
  });

  it('cannot approve one that was refused, or one that never existed', async () => {
    const h = harness();
    const [id] = opened(h, 1);
    h.requests.refuse(id);

    expect(await h.requests.approve(id)).toBe('unknown');
    expect(await h.requests.approve('made-up')).toBe('unknown');
    expect(h.minted).toEqual([]);
  });

  it('leaves the request approvable when minting fails', async () => {
    // A disk error must not consume the request: the person clicked Allow, and a second click has to
    // be able to work.
    const h = harness({ mintFails: true });
    const [id] = opened(h, 1);

    await expect(h.requests.approve(id)).rejects.toThrow('the disk went away');

    expect(h.requests.list()).toHaveLength(1);
    expect(h.requests.collect(id)).toEqual({ state: 'pending' });
  });
});

describe('refusing', () => {
  it('keeps telling the refused browser why, rather than flipping back to pending', () => {
    const h = harness();
    const [id] = opened(h, 1);

    expect(h.requests.refuse(id)).toBe(true);

    expect(h.requests.collect(id)).toEqual({ state: 'refused' });
    expect(h.requests.collect(id)).toEqual({ state: 'refused' });
    expect(h.requests.list()).toEqual([]);
  });

  it('is not repeatable and does not touch its neighbours', () => {
    const h = harness();
    const [first, second] = opened(h, 2);

    expect(h.requests.refuse(first)).toBe(true);
    expect(h.requests.refuse(first)).toBe(false);
    expect(h.requests.collect(second)).toEqual({ state: 'pending' });
  });
});

describe('the sentence the sign-in screen shows', () => {
  // A screen that says only "refused" is the bug this whole feature exists to fix, so the reason is
  // data rather than a shrug.
  it('is null when nothing is running', () => {
    expect(signinClosed({ runs: 0, autopilot: 'idle' })).toBeNull();
    expect(signinClosed({ runs: 0, autopilot: 'stopped' })).toBeNull();
  });

  it('names auto-pilot first, because that is the bigger fact about the project', () => {
    expect(signinClosed({ runs: 3, autopilot: 'running' })).toContain('Auto-pilot is running');
  });

  it('counts the agents, and agrees with itself about number', () => {
    expect(signinClosed({ runs: 1, autopilot: 'idle' })).toBe(
      '1 agent is running on this project, so signing in a new browser is closed until they finish.',
    );
    expect(signinClosed({ runs: 2, autopilot: 'idle' })).toBe(
      '2 agents are running on this project, so signing in a new browser is closed until they finish.',
    );
  });

  // A halted project has had every agent killed, so there is nothing to protect against — and it is
  // the state a person is most likely to be trying to get into the board to look at.
  it('stays open while a project is halted', () => {
    expect(signinClosed({ runs: 0, autopilot: 'halted' })).toBeNull();
  });
});
