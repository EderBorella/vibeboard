import { afterEach, describe, expect, it } from 'vitest';
import { attachHaltGate, opencodeBaseUrl } from '../src/server/opencode-server.js';

// The lazy respawn is what makes a halt real. Decision 12: while halted "nothing dispatches, NOTHING
// RESPAWNS LAZILY, and the chat says plainly that the project is halted" — without the second clause
// the Restart button is decorative, because the next chat message quietly brings `opencode serve`
// back and the project is running agents again.
//
// Its own file because the managed server is a module singleton: a test that let it spawn would leave
// a cached URL promise behind for everything else in the same worker. Only the refusal is exercised
// here, and the refusal is the whole behaviour.

afterEach(() => {
  attachHaltGate(() => false);
  delete process.env.VIBEBOARD_OPENCODE_URL;
});

describe('the lazy OpenCode spawn', () => {
  it('refuses to start a server for a halted project', async () => {
    attachHaltGate(() => true);
    await expect(opencodeBaseUrl()).rejects.toThrow(/halted/);
  });

  // A server somebody else started is not ours to refuse, and there is nothing to respawn: the gate is
  // about VibeBoard creating a process. Auto-pilot refuses this configuration outright for its own
  // reasons (it cannot confine a server it did not spawn), which is a different check in a different
  // place.
  it('still hands back an attached server, which it did not start', async () => {
    attachHaltGate(() => true);
    process.env.VIBEBOARD_OPENCODE_URL = 'http://127.0.0.1:4096/';
    await expect(opencodeBaseUrl()).resolves.toBe('http://127.0.0.1:4096');
  });
});
