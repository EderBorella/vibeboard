import { describe, expect, it } from 'vitest';
import { BREAK_GLASS, installBreakGlass, signinBanner } from '../src/server/signin-terminal.js';

// main.ts is top-level-await script code — importing it starts a server — so the banner's words and the
// signal's effect live here, as plain functions of their inputs.

const state = {
  empty: true,
  devices: 0,
  pid: 4242,
  relocated: false,
  sandboxOk: true,
};

describe('the banner', () => {
  // THE CHANGE. It used to print `http://localhost:4610/?token=<admin>`, which put a credential with no
  // expiry into terminal scrollback, every screen share, and every screenshot of a first run — and then
  // into the browser's history and bookmarks at the other end.
  it('carries no credential of any kind', () => {
    const lines = signinBanner({ ...state, devices: 2, empty: false }).join('\n');
    expect(lines).not.toContain('token=');
    expect(lines).not.toMatch(/dev_[0-9a-f]/);
  });

  it('says nothing needs doing when no browser has signed in yet', () => {
    expect(signinBanner(state).join('\n')).toContain('the first one signs itself in');
  });

  it('counts the browsers that have, and says where to manage them', () => {
    const lines = signinBanner({ ...state, empty: false, devices: 1 }).join('\n');
    expect(lines).toContain('1 browser signed in');
    expect(lines).toContain('Settings');
    expect(signinBanner({ ...state, empty: false, devices: 3 }).join('\n')).toContain('3 browsers signed in');
  });

  // Printed every time, because the moment it is needed is the moment the UI cannot be reached to read
  // it — every device gone, and no way in.
  it('always names the break-glass, with this process’s own pid', () => {
    for (const empty of [true, false]) {
      const lines = signinBanner({ ...state, empty, devices: empty ? 0 : 2 }).join('\n');
      expect(lines).toContain(`kill -USR2 4242 ${BREAK_GLASS}`);
    }
  });

  // `probeSandbox` answers "ok" for a relocated token file, because it checks whether the profile is
  // loaded and not where the secrets went. Nothing else detects it, so silence here would mean a
  // machine reporting itself sandboxed while its credentials sat in a folder no rule covers.
  it('warns when VIBEBOARD_TOKEN_FILE has moved the credentials outside the profile', () => {
    const lines = signinBanner({ ...state, relocated: true }).join('\n');
    expect(lines).toContain('VIBEBOARD_TOKEN_FILE');
    expect(lines).toContain('agents on this machine can read them');
  });

  it('does not warn about it when there is no sandbox to be outside of', () => {
    // With no profile loaded the banner already says agents are unconfined, and a second warning about
    // one deny rule among many would be noise on top of a bigger statement.
    const lines = signinBanner({ ...state, relocated: true, sandboxOk: false }).join('\n');
    expect(lines).not.toContain('VIBEBOARD_TOKEN_FILE');
  });

  it('does not warn when the credentials are where the profile expects them', () => {
    expect(signinBanner(state).join('\n')).not.toContain('VIBEBOARD_TOKEN_FILE');
  });
});

describe('the break-glass', () => {
  function harness(opts: { clearFails?: boolean } = {}) {
    const out: string[] = [];
    const errors: unknown[] = [];
    let cleared = 0;
    let closed = 0;
    const handlers: Record<string, () => void> = {};
    installBreakGlass({
      on: (signal, handler) => {
        handlers[signal] = handler;
      },
      out: (line) => out.push(line),
      clear: async () => {
        if (opts.clearFails) throw new Error('the disk went away');
        cleared += 1;
      },
      closeSockets: () => {
        closed += 1;
        return 2;
      },
      onError: (e) => errors.push(e),
    });
    return {
      out,
      errors,
      fire: () => handlers.SIGUSR2?.(),
      get cleared() {
        return cleared;
      },
      get closed() {
        return closed;
      },
      listening: Object.keys(handlers),
    };
  }

  // SIGUSR2, not SIGUSR1: Node reserves USR1 for the inspector, and starting a debugger instead of
  // signing everybody out would be a memorable surprise.
  it('listens on SIGUSR2 and nothing else', () => {
    expect(harness().listening).toEqual(['SIGUSR2']);
  });

  it('empties the store and hangs up the sockets those credentials held', async () => {
    const h = harness();

    h.fire();
    await new Promise((r) => setImmediate(r));

    expect(h.cleared).toBe(1);
    // Without this an idle tab keeps its socket for ever: it never makes the HTTP call that would 401.
    expect(h.closed).toBe(1);
  });

  it('says what it did, and that the next load will sign itself in', async () => {
    const h = harness();

    h.fire();
    await new Promise((r) => setImmediate(r));

    expect(h.out.join('\n')).toContain('2 live connections closed');
    expect(h.out.join('\n')).toContain('sign itself in');
  });

  it('can be used twice, because needing it twice is not a reason to restart the server', async () => {
    const h = harness();

    h.fire();
    await new Promise((r) => setImmediate(r));
    h.fire();
    await new Promise((r) => setImmediate(r));

    expect(h.cleared).toBe(2);
  });

  // A signal handler has nobody to return a rejection to, and an unhandled one takes the process down.
  // Crashing the server as the answer to "let me back in" would be the worst possible outcome here.
  it('reports a failure instead of taking the process down', async () => {
    const h = harness({ clearFails: true });

    h.fire();
    await new Promise((r) => setImmediate(r));

    expect(h.errors).toHaveLength(1);
    expect(h.out).toEqual([]); // and it does NOT claim to have signed anyone out
  });
});
