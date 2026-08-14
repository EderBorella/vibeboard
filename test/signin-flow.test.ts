import { describe, expect, it } from 'vitest';
import { ApiError, type SigninCollected } from '../web/src/api.js';
import { POLL_LIMIT, runSignin, type SigninDeps, type SigninPhase } from '../web/src/signin/driver.js';

// The browser's half of signing in, driven directly. Its calls and its clock are injected, so the
// whole flow is exercised without a DOM and without waiting two minutes for a TTL.

interface Harness {
  deps: SigninDeps;
  phases: SigninPhase[];
  // How many times the driver said "a credential now exists". There is no token to record any more:
  // the server sets an HttpOnly cookie as it answers, so the driver's only job is to say so.
  arrivals: number;
  adopted: string[];
  forgotten: number;
  slept: number[];
  polls: number;
}

function harness(opts: {
  claim?: () => Promise<{ token: string }>;
  request?: () => Promise<{ id: string; label: string; address: string }>;
  answers?: SigninCollected[];
  collect?: () => Promise<SigninCollected>;
  // A credential this browser already holds: a `?token=` launch URL, or localStorage from before the
  // cookie transport. Absent for every ordinary load.
  legacy?: string;
  adopt?: (token: string) => Promise<void>;
}): Harness {
  const phases: SigninPhase[] = [];
  const slept: number[] = [];
  const answers = [...(opts.answers ?? [])];
  const h: Harness = {
    phases,
    arrivals: 0,
    adopted: [],
    forgotten: 0,
    slept,
    polls: 0,
    deps: {
      legacyToken: () => opts.legacy ?? '',
      adopt:
        opts.adopt ??
        (async (t) => {
          h.adopted.push(t);
        }),
      forgetLegacy: () => {
        h.forgotten += 1;
      },
      claim: opts.claim ?? (async () => ({ token: 'claimed-token' })),
      request: opts.request ?? (async () => ({ id: 'req-1', label: 'Firefox', address: '192.168.0.31' })),
      collect:
        opts.collect ??
        (async () => {
          h.polls += 1;
          return answers.shift() ?? { state: 'pending' };
        }),
      onCredential: () => {
        h.arrivals += 1;
      },
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

    expect(h.arrivals).toBe(1);
    expect(h.phases).toEqual([{ phase: 'claiming' }, { phase: 'in' }]);
    // Nothing was asked of anybody: no request opened, so no prompt was raised on another browser.
    expect(h.polls).toBe(0);
  });

  // And it does not offer a credential it does not have. `/auth/adopt` is for a browser that was already
  // signed in, and calling it with nothing would 401 and delay the claim for no reason.
  it('adopts nothing when it holds nothing', async () => {
    const h = harness({});
    await runSignin(h.deps);
    expect(h.adopted).toEqual([]);
  });
});

// A browser that already holds a credential — from the `?token=` recovery route, or from localStorage
// where the pre-cookie release left it. THIS RUNS BEFORE THE CLAIM, and it has to: the claim would be
// refused because a device already exists (its own), and it would then sit waiting for an approval that
// only it could give. That was the upgrade path locking the user out of their own board.
describe('a browser that already holds a credential', () => {
  it('hands it to the server and is in, without claiming or asking anyone', async () => {
    let claimed = 0;
    const h = harness({
      legacy: 'held-already',
      claim: async () => {
        claimed += 1;
        return { token: 'should-not-happen' };
      },
    });

    expect(await runSignin(h.deps)).toBe(true);

    expect(h.adopted).toEqual(['held-already']);
    expect(claimed).toBe(0);
    expect(h.polls).toBe(0);
    expect(h.phases).toEqual([{ phase: 'claiming' }, { phase: 'in' }]);
  });

  it('forgets it once adopted, so it is not offered again', async () => {
    const h = harness({ legacy: 'held-already' });
    await runSignin(h.deps);
    expect(h.forgotten).toBe(1);
  });

  // A credential that has been revoked since it was stored is not a reason to stop: the ordinary flow is
  // the answer, and keeping the dead value would mean retrying it on every load for ever.
  it('falls through to the claim when the server refuses it, and forgets it', async () => {
    const h = harness({
      legacy: 'revoked-months-ago',
      adopt: async () => {
        throw new ApiError(401, 'That credential is not valid.');
      },
    });

    expect(await runSignin(h.deps)).toBe(true);

    expect(h.forgotten).toBe(1);
    expect(h.arrivals).toBe(1); // from the claim
    expect(h.phases).toEqual([{ phase: 'claiming' }, { phase: 'in' }]);
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
    expect(h.arrivals).toBe(1);
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
    expect(h.arrivals).toBe(0);
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
    expect(h.arrivals).toBe(1);
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
  it('claims no credential arrived unless one did', async () => {
    const h = harness({
      claim: async () => {
        throw refused('busy');
      },
    });
    await runSignin(h.deps);
    expect(h.arrivals).toBe(0);
  });

  it('reports `in` exactly once, and only after the credential is announced', async () => {
    const order: string[] = [];
    const h = harness({});
    const deps: SigninDeps = {
      ...h.deps,
      onCredential: () => order.push('credential'),
      onPhase: (p) => order.push(p.phase),
    };

    await runSignin(deps);

    // The order matters, and not only cosmetically: the announcement is what wakes the socket, and it
    // must find the cookie set rather than waiting on the React render that `in` triggers.
    expect(order).toEqual(['claiming', 'credential', 'in']);
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
