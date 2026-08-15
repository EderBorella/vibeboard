import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { runAgentTurn } from '../src/server/agent-turn.js';
import type { CopilotEvent } from '../src/server/copilot-events.js';

// A stand-in for `opencode serve`: a real HTTP server, so the client's own fetch, abort and JSON
// handling are exercised rather than stubbed. `VIBEBOARD_OPENCODE_URL` is how opencodeBaseUrl is
// pointed at it — the same variable a person uses to attach an external server.
let server: Server | undefined;
let created = 0;

interface StubOpts {
  // Milliseconds before the message endpoint answers. The window a cancel has to land in.
  delayMs?: number;
  // Answer the message with an HTTP error instead of a body.
  failMessage?: boolean;
}

async function stub(opts: StubOpts = {}): Promise<string> {
  created = 0;
  server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/session?') || url === '/session') {
      created += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: `oc-session-${created}` }));
      return;
    }
    if (url.includes('/message')) {
      const answer = (): void => {
        if (opts.failMessage) {
          res.statusCode = 500;
          res.end('{"error":"boom"}');
          return;
        }
        res.setHeader('content-type', 'application/json');
        // The shape opencode-client parses: parts, plus `info` carrying the session id back.
        res.end(
          JSON.stringify({
            parts: [{ type: 'text', text: 'hello from opencode' }],
            info: { sessionID: 'oc-session-1', tokens: { input: 1, output: 1 }, time: {} },
          }),
        );
      };
      if (opts.delayMs) setTimeout(answer, opts.delayMs);
      else answer();
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;
  process.env.VIBEBOARD_OPENCODE_URL = url;
  return url;
}

afterEach(async () => {
  delete process.env.VIBEBOARD_OPENCODE_URL;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const turnOpts = (onEvent: (e: CopilotEvent) => void, sessionId?: string) => ({
  cwd: process.cwd(),
  text: 'hello',
  mode: 'bypassPermissions' as const,
  backend: 'opencode' as const,
  model: 'anthropic/claude-opus-5',
  effort: 'high',
  timeoutMs: 10_000,
  onEvent,
  ...(sessionId ? { sessionId } : {}),
});

describe('an OpenCode turn that is cancelled', () => {
  // THE OPEN QUESTION from the Claude fix. There, `cancel()` kills a process, so nothing can speak
  // afterwards and the event path needs no guard. OpenCode has no process — cancel only aborts a
  // fetch — so this asks whether a `result` event, which carries a sessionId, can still arrive after
  // the turn was cancelled. If it can, the event path must be guarded too.
  it('emits no events once it has been cancelled', async () => {
    await stub({ delayMs: 400 });
    const after: CopilotEvent[] = [];
    let cancelled = false;
    const turn = runAgentTurn(
      turnOpts((e) => {
        if (cancelled) after.push(e);
      }),
    );

    await new Promise((r) => setTimeout(r, 100));
    cancelled = true;
    turn.cancel();
    await turn.done;
    await new Promise((r) => setTimeout(r, 600));

    const withSession = after.filter((e) => e.kind === 'result' && e.sessionId);
    expect(withSession, 'a cancelled turn must not report a session id').toEqual([]);
  }, 20_000);

  // The OpenCode-only defect. A turn that fails AFTER creating a session never reports the id, so on
  // a chat's first turn the session is orphaned on the server and the next message starts another
  // one — the conversation is lost rather than continued. The mirror image of the Claude bug: there
  // the id survived when it should not have, here it vanishes when it should not.
  it('still reports the session it created when the turn fails', async () => {
    await stub({ failMessage: true });
    const result = await runAgentTurn(turnOpts(() => {})).done;

    expect(result.exitCode, 'the turn did fail').toBe(1);
    expect(created, 'a session was created before the failure').toBe(1);
    expect(result.sessionId, 'the created session must not be lost').toBe('oc-session-1');
  }, 20_000);

  // And the consequence, stated as its own assertion: given the id back, the next turn continues that
  // conversation instead of opening a third one.
  it('lets the next turn continue the session the failed one created', async () => {
    await stub({ failMessage: true });
    const first = await runAgentTurn(turnOpts(() => {})).done;
    await runAgentTurn(turnOpts(() => {}, first.sessionId)).done;

    expect(created, 'the second turn must reuse the first session, not create another').toBe(1);
  }, 20_000);
});
