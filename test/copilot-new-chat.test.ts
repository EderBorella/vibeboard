import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { openTestProject, shimArgsLog, wsClient } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-claude.mjs');
const SLOW = join(here, 'fixtures', 'slow-claude.mjs');

beforeAll(() => {
  chmodSync(SHIM, 0o755);
  chmodSync(SLOW, 0o755);
  process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
});

interface Msg {
  type: string;
  currentChatId?: string;
  items?: unknown[];
  state?: { running?: boolean; sessionId?: string };
}

// Every argv the CLI was spawned with, one JSON array per line.
const spawns = (log: string): string[][] =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as string[]);

const spawned = async (log: string, n: number): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if (spawns(log).length >= n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`the CLI was spawned ${spawns(log).length} times, expected ${n}`);
};

// WAITS ON THE BROADCAST SESSION ID, counting matching broadcasts rather than looking for one.
//
// The first version of these tests waited for a `copilot:history` carrying no items, which the very
// first history — the one sent on connect — already satisfies. Every wait therefore returned
// immediately and the assertions ran against a state the server had not reached. Nothing else orders
// these steps: `copilot:new` and `copilot:open` are dispatched with `void` rather than awaited, so a
// `copilot:send` behind them can be handled first.
const sessionSeen = (
  c: { waitUntil: (p: (all: Msg[]) => boolean) => Promise<void> },
  pred: (id: string | undefined) => boolean,
  times = 1,
) =>
  c.waitUntil((m) => m.filter((x) => x.type === 'copilot:state' && pred(x.state?.sessionId)).length >= times);

const start = async (name: string, log: string) => {
  writeFileSync(log, '', 'utf8');
  process.env.VIBEBOARD_SHIM_ARGS = log;
  const { app } = await openTestProject({ name });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const c = wsClient<Msg>(address);
  await c.open;
  await c.waitUntil((m) => m.some((x) => x.type === 'copilot:history'));
  return c;
};

describe('starting a new chat', () => {
  it('does not resume the previous conversation', async () => {
    const log = shimArgsLog();
    const c = await start('Co', log);

    c.send({ type: 'copilot:send', text: 'first chat' });
    await spawned(log, 1);
    await sessionSeen(c, (id) => id === 'shim-session');

    c.send({ type: 'copilot:new' });
    await sessionSeen(c, (id) => id === undefined, 2);

    c.send({ type: 'copilot:send', text: 'second chat' });
    await spawned(log, 2);

    const calls = spawns(log);
    expect(calls[0]).not.toContain('--resume');
    expect(calls[1], 'the second chat must start its own conversation').not.toContain('--resume');
  }, 30_000);

  // The other half, and the reason the fix is a generation counter rather than "never write the
  // session id back": reopening a stored chat MUST resume, or switching back to a conversation
  // silently loses everything said in it. One field serves both, so one can break the other.
  it('does resume when an existing chat is reopened', async () => {
    const log = shimArgsLog();
    const c = await start('Co', log);

    c.send({ type: 'copilot:send', text: 'first chat' });
    await spawned(log, 1);
    await sessionSeen(c, (id) => id === 'shim-session');
    const first = [...c.messages].reverse().find((m) => m.type === 'copilot:history')?.currentChatId;
    expect(first).toBeTruthy();

    c.send({ type: 'copilot:new' });
    await sessionSeen(c, (id) => id === undefined, 2);

    c.send({ type: 'copilot:open', chatId: first, backend: 'claude-code' });
    await sessionSeen(c, (id) => id === 'shim-session', 2);

    c.send({ type: 'copilot:send', text: 'back to the first' });
    await spawned(log, 2);

    expect(spawns(log)[1], 'reopening a stored chat should continue it').toContain('--resume');
  }, 30_000);
});

describe('starting a new chat while the previous turn is still running', () => {
  // THE PRODUCTION BUG, reproduced. Two chats in one project both recorded cliSessionId
  // `7761313c-…`, and `docker top` caught the live process running with `--resume 7761313c-…`. The
  // second conversation was continuing the first, so it inherited every message, grew to 1.1 MB over
  // 404 events, and eventually died with "[No response after 180s]" while looking like a fresh chat.
  //
  // The trigger is timing, which is why the fast shim above cannot show it: chat 1's turn was STILL
  // ALIVE when New chat was pressed. `newSession()` clears the id correctly, and then the dying turn
  // puts it back — `send()` writes `#sessionId` from the turn's events and again from its resolved
  // result, and a cancelled turn still resolves, carrying the id it had seen.
  it('does not let the dying turn restore the session it just cleared', async () => {
    process.env.VIBEBOARD_CLAUDE_BIN = SLOW;
    try {
      const log = shimArgsLog();
      const c = await start('Race', log);

      // A turn that announces its session and then hangs, exactly like a long real one.
      c.send({ type: 'copilot:send', text: 'the long turn' });
      await spawned(log, 1);
      // The turn's own events, NOT a state broadcast: `copilotState()` is sent when a turn ENDS, and
      // this one deliberately never does. Waiting on the session id here would hang for the timeout.
      await c.waitUntil((m) => m.some((x) => x.type === 'copilot:event'));

      // New chat, pressed while that turn is still going.
      c.send({ type: 'copilot:new' });
      await sessionSeen(c, (id) => id === undefined, 2);
      // Give the cancelled turn time to settle and write back whatever it would write back.
      await new Promise((r) => setTimeout(r, 300));

      c.send({ type: 'copilot:send', text: 'the new chat' });
      await spawned(log, 2);

      expect(spawns(log)[1], 'a new chat must not inherit the cancelled turn’s session').not.toContain(
        '--resume',
      );
    } finally {
      process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
    }
  }, 30_000);
});

describe('a turn that outlives the chat it belongs to', () => {
  // The other half of the same race, and the reason the guard is on the EVENT path too. A dying turn
  // does not only restore the session id — its output is handed to `opts.onEvent`, which records it
  // into whatever chat is current by the time it arrives. That is the new chat.
  //
  // In production this is invisible: text from the previous conversation simply appears in a chat you
  // just opened, and reads as the model saying something unprompted.
  it('does not spill its late output into the chat that replaced it', async () => {
    process.env.VIBEBOARD_CLAUDE_BIN = SLOW;
    try {
      const log = shimArgsLog();
      const c = await start('Spill', log);

      c.send({ type: 'copilot:send', text: 'the long turn' });
      await spawned(log, 1);
      await c.waitUntil((m) => m.some((x) => x.type === 'copilot:event'));

      const before = c.messages.length;
      c.send({ type: 'copilot:new' });
      await sessionSeen(c, (id) => id === undefined, 2);

      // The shim speaks at 400ms; wait past it.
      await new Promise((r) => setTimeout(r, 700));

      const after = JSON.stringify(c.messages.slice(before));
      expect(after, 'the old turn’s text must not arrive in the new chat').not.toContain(
        'LATE OUTPUT FROM THE OLD TURN',
      );
    } finally {
      process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
    }
  }, 30_000);
});
