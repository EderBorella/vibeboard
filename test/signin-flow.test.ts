import { describe, expect, it } from 'vitest';
import { ApiError, type SigninCollected } from '../web/src/api.js';
import { POLL_LIMIT, runSignin, type SigninDeps, type SigninPhase } from '../web/src/signin.js';

// The browser's half of signing in, driven directly. Its calls and its clock are injected, so the
// whole flow is exercised without a DOM and without waiting two minutes for a TTL.

interface Harness {
  deps: SigninDeps;
  phases: SigninPhase[];
  tokens: string[];
  slept: number[];
  polls: number;
}

function harness(opts: {
  claim?: () => Promise<{ token: string }>;
  request?: () => Promise<{ id: string; label: string; address: string }>;
  answers?: SigninCollected[];
  collect?: () => Promise<SigninCollected>;
}): Harness {
  const phases: SigninPhase[] = [];
  const tokens: string[] = [];
  const slept: number[] = [];
  const answers = [...(opts.answers ?? [])];
  const h: Harness = {
    phases,
    tokens,
    slept,
    polls: 0,
    deps: {
      claim: opts.claim ?? (async () => ({ token: 'claimed-token' })),
      request: opts.request ?? (async () => ({ id: 'req-1', label: 'Firefox', address: '192.168.0.31' })),
      collect:
        opts.collect ??
        (async () => {
          h.polls += 1;
          return answers.shift() ?? { state: 'pending' };
        }),
      setToken: (t) => tokens.push(t),
      sleep: async (ms) => {
        slept.push(ms);
      },
      onPhase: (p) => phases.push(p),
    },
  };
  return h;
}

const refused = (reason: string, status = 409): ApiError => new ApiError(status, 'refused', reason);

describe('the first browser', () => {
  // THE ENTIRE POINT: open the URL, and the credential is obtained with no interaction whatsoever.
  it('claims silently and is in', async () => {
    const h = harness({});

    expect(await runSignin(h.deps)).toBe(true);

    expect(h.tokens).toEqual(['claimed-token']);
    expect(h.phases).toEqual([{ phase: 'claiming' }, { phase: 'in' }]);
    // Nothing was asked of anybody: no request opened, so no prompt was raised on another browser.
    expect(h.polls).toBe(0);
  });
});

describe('a later browser', () => {
  it('asks to be approved when the claim is already taken', async () => {
    const h = harness({
      claim: async () => {
        throw refused('claimed');
      },
      answers: [{ state: 'pending' }, { state: 'approved', token: 'approved-token' }],
    });

    expect(await runSignin(h.deps)).toBe(true);

    expect(h.phases).toEqual([
      { phase: 'claiming' },
      // The label and address the SERVER saw, so this screen can be matched against the prompt on
      // the other browser. Made up here, they would be a screen telling the user a fiction.
      { phase: 'waiting', label: 'Firefox', address: '192.168.0.31' },
      { phase: 'in' },
    ]);
    expect(h.tokens).toEqual(['approved-token']);
  });

  it('stops, with the reason, when it is refused', async () => {
    const h = harness({
      claim: async () => {
        throw refused('claimed');
      },
      answers: [{ state: 'refused' }],
    });

    expect(await runSignin(h.deps)).toBe(false);

    const last = h.phases.at(-1);
    expect(last).toMatchObject({ phase: 'stopped', retry: false });
    // No "try again" after a refusal: a person decided, and offering a retry argues with them.
    expect(last).toHaveProperty('reason', expect.stringContaining('refused'));
    expect(h.tokens).toEqual([]);
  });

  it('offers a retry when the request timed out', async () => {
    const h = harness({
      claim: async () => {
        throw refused('claimed');
      },
      answers: [{ state: 'expired' }],
    });

    await runSignin(h.deps);

    expect(h.phases.at(-1)).toMatchObject({ phase: 'stopped', retry: true });
  });

  it('gives up after a bounded number of polls rather than for ever', async () => {
    const h = harness({
      claim: async () => {
        throw refused('claimed');
      },
      answers: [], // always pending
    });

    await runSignin(h.deps);

    expect(h.polls).toBe(POLL_LIMIT);
    expect(h.phases.at(-1)).toMatchObject({ phase: 'stopped', retry: true });
  });

  // A dropped connection mid-wait is not a decision. Giving up here would put "refused" on screen
  // for a network blip, which is the same class of lie this whole feature removes.
  it('keeps polling through a failed poll', async () => {
    let calls = 0;
    const h = harness({
      claim: async () => {
        throw refused('claimed');
      },
      collect: async () => {
        calls += 1;
        if (calls < 3) throw new TypeError('Failed to fetch');
        return { state: 'approved', token: 'late-token' };
      },
    });

    expect(await runSignin(h.deps)).toBe(true);

    expect(calls).toBe(3);
    expect(h.tokens).toEqual(['late-token']);
  });
});

describe('when signing in is closed', () => {
  // The sentence comes from the SERVER, which knows what is running. Inventing one here would mean
  // the screen guessing at a reason it cannot see.
  it('shows the server’s own explanation and offers a retry', async () => {
    const h = harness({
      claim: async () => {
        throw new ApiError(409, '2 agents are running on this project, so signing in is closed.', 'busy');
      },
    });

    expect(await runSignin(h.deps)).toBe(false);

    expect(h.phases.at(-1)).toEqual({
      phase: 'stopped',
      reason: '2 agents are running on this project, so signing in is closed.',
      retry: true,
    });
  });

  it('does not go on to ask for approval when the claim was refused for any other reason', async () => {
    // Only `claimed` means "ask instead". Treating every refusal as that would raise a prompt on the
    // user's browser every time the project happened to be busy.
    const h = harness({
      claim: async () => {
        throw new ApiError(409, 'busy', 'busy');
      },
      request: async () => {
        throw new Error('should never be called');
      },
    });

    await expect(runSignin(h.deps)).resolves.toBe(false);
  });

  it('says the server could not be reached when nothing answered at all', async () => {
    const h = harness({
      claim: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await runSignin(h.deps);

    expect(h.phases.at(-1)).toMatchObject({
      phase: 'stopped',
      reason: expect.stringContaining('could not be reached'),
      retry: true,
    });
  });

  it('reports the rate limit rather than looking broken', async () => {
    const h = harness({
      claim: async () => {
        throw refused('claimed');
      },
      request: async () => {
        throw new ApiError(429, 'Sign-in was asked for too recently. Try again in a moment.', 'too-often');
      },
    });

    await runSignin(h.deps);

    expect(h.phases.at(-1)).toEqual({
      phase: 'stopped',
      reason: 'Sign-in was asked for too recently. Try again in a moment.',
      retry: true,
    });
  });
});

describe('the poll interval', () => {
  it('waits between polls rather than spinning', async () => {
    const h = harness({
      claim: async () => {
        throw refused('claimed');
      },
      answers: [{ state: 'pending' }, { state: 'pending' }, { state: 'approved', token: 't' }],
    });

    await runSignin(h.deps);

    // A sleep BEFORE each poll, so the first one does not fire in the same tick the request was
    // opened in — the person being asked has not seen the prompt yet.
    expect(h.slept).toEqual([2000, 2000, 2000]);
  });

  it('does not sleep at all on the silent path', async () => {
    const h = harness({});
    await runSignin(h.deps);
    expect(h.slept).toEqual([]);
  });
});

describe('what the driver never does', () => {
  it('stores no token unless it got one', async () => {
    const h = harness({
      claim: async () => {
        throw refused('busy');
      },
    });
    await runSignin(h.deps);
    expect(h.tokens).toEqual([]);
  });

  it('reports `in` exactly once, and only after the token is stored', async () => {
    const order: string[] = [];
    const h = harness({});
    const deps: SigninDeps = {
      ...h.deps,
      setToken: () => order.push('token'),
      onPhase: (p) => order.push(p.phase),
    };

    await runSignin(deps);

    // The order matters: `in` is what flips the app to the board, and the board's first request
    // carries the credential.
    expect(order).toEqual(['claiming', 'token', 'in']);
  });
});

// Not a behaviour of the driver, but of the thing that calls it. React StrictMode invokes effects
// twice in development, and a second flow would find the claim taken by the first and drop this
// browser into "waiting for approval" — for a request nobody made, needing an approval nobody can give.
describe('the once-per-page guard', () => {
  it('runs the flow a single time for two overlapping starts', async () => {
    const { once } = await import('../web/src/useSignin.js');
    let started = 0;
    let settle: (v: boolean) => void = () => {};
    const run = (): Promise<boolean> => {
      started += 1;
      return new Promise<boolean>((r) => {
        settle = r;
      });
    };

    const first = once(run);
    const second = once(run); // the StrictMode remount, while the first is still in flight

    expect(started).toBe(1);
    settle(true);
    expect(await Promise.all([first, second])).toEqual([true, true]);
  });

  it('lets a later start run, so Try again works', async () => {
    const { once } = await import('../web/src/useSignin.js');
    let started = 0;
    const run = async (): Promise<boolean> => {
      started += 1;
      return false;
    };

    await once(run);
    await once(run);

    expect(started).toBe(2);
  });

  // A rejected flow must clear the guard too, or one network failure would leave sign-in permanently
  // unable to start again for the life of the page.
  it('clears itself when the flow throws', async () => {
    const { once } = await import('../web/src/useSignin.js');
    await expect(
      once(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(once(async () => true)).resolves.toBe(true);
  });
});
