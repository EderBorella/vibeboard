import { describe, expect, it } from 'vitest';
import { backendCheck } from '../src/server/boxes/backend-liveness.js';

// WHETHER THE THING AN AGENT TALKS TO IS ANSWERING — the third fault in `SandboxStatus`.
//
// Docker being up and the credential being current says the machine COULD run an agent. Neither says the
// backend is alive. Measured 2026-08-16: an OpenCode server was destroyed under a live URL, and every
// dispatch died in 449ms with `[opencode failed: fetch failed]` — three attempts spent in five seconds, with
// auto-pilot reporting that the README was too thin to derive features from. Both lights were green the whole
// time, because nothing was refusing and nothing had asked.
//
// Injected `fetch` and `url` throughout: this is a decision about an answer, and it needs no network.

const asking = (over: Partial<Parameters<typeof backendCheck>[0]> = {}) =>
  backendCheck({
    backend: () => 'opencode',
    url: () => 'http://127.0.0.1:32776',
    fetch: async () => new Response('{}', { status: 200 }),
    ...over,
  });

describe('the backend liveness check', () => {
  it('says live when the server answers', async () => {
    expect(await asking()()).toEqual({ live: true });
  });

  it('accepts any answer at all, because a 404 is still a server', async () => {
    // The question is "is something there", not "does it like this path". `waitForServer` takes the same
    // view for the same reason, and a check stricter than the thing it is checking would refuse a healthy
    // server on the day OpenCode renames a route.
    const check = asking({ fetch: async () => new Response('nope', { status: 404 }) });
    expect(await check()).toEqual({ live: true });
  });

  it('reports a dead server with a sentence naming the way back', async () => {
    const check = asking({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });

    const answer = await check();

    expect(answer.live).toBe(false);
    // The remedy is part of the refusal, as every sentence in sandbox.ts is: a status with no action reads
    // as a broken app rather than a restartable server.
    expect(answer.live === false && answer.reason).toMatch(/not answering/i);
    expect(answer.live === false && answer.reason).toMatch(/Sandbox/);
  });

  it('says nothing is wrong when no server has been started yet', async () => {
    // `undefined` is "nobody has needed one", which is the ordinary state of a project nobody has dispatched
    // in. Reporting a fault would put the board into a refusal on every fresh start — and this check must
    // never START one, because it runs on a timer.
    let asked = 0;
    const check = asking({
      url: () => undefined,
      fetch: async () => {
        asked += 1;
        return new Response('{}');
      },
    });

    expect(await check()).toEqual({ live: true });
    expect(asked).toBe(0);
  });

  it('asks nothing at all for the Claude backend', async () => {
    // There is no equivalent question: Claude Code is spawned per turn, so the only way to know it works is
    // to run one, which costs money. Its forward-looking gate is the credential check.
    let asked = 0;
    const check = asking({
      backend: () => 'claude-code',
      fetch: async () => {
        asked += 1;
        return new Response('{}');
      },
    });

    expect(await check()).toEqual({ live: true });
    expect(asked).toBe(0);
  });

  it('gives up quickly rather than holding the probe open', async () => {
    // The sandbox status is behind a 1s TTL and three gates ask for it per dispatch, so a hanging check would
    // stall the dispatch it is meant to protect. The signal is passed to `fetch`, and a check that ignored it
    // would look identical until something actually hung.
    let signalled: AbortSignal | undefined;
    const check = asking({
      fetch: async (_url, init) => {
        signalled = init?.signal ?? undefined;
        return new Response('{}');
      },
    });

    await check();

    expect(signalled).toBeInstanceOf(AbortSignal);
  });
});
