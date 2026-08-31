import { rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_DIR, CONFIG_FILE } from '../src/core/layout.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { opencodeTurn } from '../src/server/boxes/opencode-client.js';
import {
  attachBoxes,
  capStartupLog,
  opencodeBaseUrl,
  stopOpencodeServer,
} from '../src/server/boxes/opencode-server.js';
import { modelStatus } from '../src/server/copilot/models.js';
import type { CopilotEvent } from '../src/server/copilot-events.js';
import { installCrashHandlers, type Log } from '../src/server/logging.js';
import { ChatStore } from '../src/store/chat-store.js';
import { openTestProject, tempDir, testApp, wsClient } from './helpers.js';

// Everything here is about failures that used to happen in silence: they are all deliberately
// non-fatal, so the ONLY way to know they happened is the line they now write.

function fakeLog(): Log & { calls: { level: string; obj: object; msg?: string }[] } {
  const calls: { level: string; obj: object; msg?: string }[] = [];
  const at =
    (level: string) =>
    (obj: object, msg?: string): void => {
      calls.push({ level, obj, msg });
    };
  const log = {
    calls,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: () => log,
  };
  return log;
}

describe('installCrashHandlers', () => {
  // Registration is captured off `process.on` rather than really installed: emitting a real
  // unhandledRejection inside the worker would reach vitest's own handler as well.
  function install(log: Log): {
    handlers: Record<string, (arg: unknown) => void>;
    exit: ReturnType<typeof vi.fn>;
  } {
    const handlers: Record<string, (arg: unknown) => void> = {};
    const on = vi.spyOn(process, 'on').mockImplementation(((event: string, fn: (arg: unknown) => void) => {
      handlers[event] = fn;
      return process;
    }) as unknown as typeof process.on);
    const exit = vi.fn();
    installCrashHandlers(log, exit);
    on.mockRestore();
    return { handlers, exit };
  }

  it('logs an unhandled rejection as fatal and exits non-zero', () => {
    const log = fakeLog();
    const { handlers, exit } = install(log);

    expect(Object.keys(handlers).sort()).toEqual(['uncaughtException', 'unhandledRejection']);

    const boom = new Error('nobody caught me');
    handlers.unhandledRejection(boom);
    expect(log.calls).toEqual([{ level: 'fatal', obj: { err: boom }, msg: 'unhandled rejection — exiting' }]);
    // Node already exits on these; the handler must not turn a crash into a zombie that keeps
    // serving from a state the code never expected.
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('logs an uncaught exception as fatal and exits non-zero', () => {
    const log = fakeLog();
    const { handlers, exit } = install(log);

    const boom = new Error('thrown from nowhere');
    handlers.uncaughtException(boom);
    expect(log.calls).toEqual([{ level: 'fatal', obj: { err: boom }, msg: 'uncaught exception — exiting' }]);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('ChatStore', () => {
  it('logs a failed write as an error, because a lost chat is lost data', async () => {
    // Root is a FILE, so creating .vibeboard/chat/ under it cannot work. Before this the write
    // failed, the promise was swallowed, and the conversation was simply gone at the next reload.
    const dir = await tempDir();
    const notADir = join(dir, 'root-is-a-file');
    await writeFile(notADir, 'x');
    const log = fakeLog();
    const chats = new ChatStore({ root: notADir, config: undefined }, log);

    await chats.recordUser('hello');
    await chats.flush();

    const failure = log.calls.find((c) => c.msg === 'chat write failed');
    expect(failure?.level).toBe('error');
    expect(failure?.obj).toHaveProperty('chat');
    expect(failure?.obj).toHaveProperty('err');
  });

  it('still works with no logger at all', async () => {
    // The parameter is optional, and every existing caller in the tests omits it.
    const dir = await tempDir();
    const notADir = join(dir, 'root-is-a-file');
    await writeFile(notADir, 'x');
    const chats = new ChatStore({ root: notADir, config: undefined });
    await chats.recordUser('hello');
    await expect(chats.flush()).resolves.toBeUndefined();
  });
});

describe('models', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('logs a failed status fetch instead of quietly reporting no status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const log = fakeLog();

    expect(await modelStatus('openrouter/some/model', log)).toBeNull();
    const failure = log.calls.find((c) => c.msg === 'model status fetch failed');
    expect(failure?.level).toBe('warn');
    expect(failure?.obj).toMatchObject({ id: 'openrouter/some/model' });
  });
});

// Reads the lines the whole app produces, so the `component` tags can be checked as pino really
// emits them rather than as testApp intends them.
function sink(): { lines: Record<string, unknown>[]; stream: Writable } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      cb();
    },
  });
  return { lines, stream };
}

// These failures arrive from a watcher event or a socket connect, so there is nothing to await.
// Real time with a generous margin, and a positive assertion afterwards — never a bare sleep.
async function waitForLine(
  lines: Record<string, unknown>[],
  msg: string,
  ms = 3000,
): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + ms;
  let found: Record<string, unknown> | undefined;
  while (!found && Date.now() < deadline) {
    found = lines.find((l) => l.msg === msg);
    if (!found) await new Promise((r) => setTimeout(r, 10));
  }
  return found;
}

let session: ProjectSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('testApp wiring', () => {
  it('hands the session a logger, which it has no other way to get', () => {
    // The session is constructed before the app that logs for it, so the composition root is the
    // only place this can happen.
    session = new ProjectSession();
    const attachLogger = vi.spyOn(session, 'attachLogger');
    testApp(session, { logger: { level: 'silent' } });
    expect(attachLogger).toHaveBeenCalledOnce();
  });

  it('records why the watcher stopped broadcasting, with the path that failed', async () => {
    // The failure mode this exists for: the boards quietly stop updating and everything else looks
    // fine. The line names the file it could not read, which is the whole diagnosis.
    const { lines, stream } = sink();
    const project = await openTestProject({ name: 'Watch', logger: { level: 'info', stream } });
    await rm(project.root, { recursive: true, force: true });

    const failure = await waitForLine(lines, 'snapshot broadcast failed');
    expect(failure?.component).toBe('watcher');
    expect(failure?.level).toBe(40); // warn — a later event may still recover
    expect((failure?.err as { path?: string })?.path).toBe(join(project.root, CONFIG_DIR, CONFIG_FILE));
  });

  it('tags the WS channel with its component, as pino actually emits it', async () => {
    // A real failure, not a stub: the project folder is deleted under the watcher, so the first
    // snapshot a new client asks for cannot be built. That used to be `.catch(() => {})` — a
    // browser showing an empty board with nothing written anywhere.
    const { lines, stream } = sink();
    const project = await openTestProject({ name: 'WS', logger: { level: 'info', stream } });
    await rm(project.root, { recursive: true, force: true });

    const address = await project.app.listen({ port: 0, host: '127.0.0.1' });
    const client = wsClient(address);
    await client.open;

    const failure = await waitForLine(lines, 'initial snapshot failed');
    client.close();

    expect(failure).toBeDefined();
    expect(failure?.component).toBe('ws');
    expect(failure?.level).toBe(40); // warn
  });
});

// The OpenCode backend is two module singletons — the spawned `opencode serve` and the turns that run
// through it — and neither had any way to say anything. A run that failed inside opencode left
// `[opencode: "Streaming response failed"]` in the transcript and nothing anywhere else.
describe('the OpenCode backend', () => {
  const SHIM = join(process.cwd(), 'test', 'fixtures', 'fake-opencode-serve.mjs');
  const savedUrl = process.env.VIBEBOARD_OPENCODE_URL;
  const savedBin = process.env.VIBEBOARD_OPENCODE_BIN;
  let http: Server | undefined;

  afterEach(async () => {
    stopOpencodeServer();
    await new Promise<void>((r) => (http ? http.close(() => r()) : r()));
    http = undefined;
    // Restored, not just unset: process.env survives into the next test FILE in the same worker.
    for (const [key, value] of [
      ['VIBEBOARD_OPENCODE_URL', savedUrl],
      ['VIBEBOARD_OPENCODE_BIN', savedBin],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // Builds the app only for its side effect: the composition root is where the OpenCode singletons
  // are handed the logger, so a real pino child with the real component tag is what gets tested.
  function wiredSink(): Record<string, unknown>[] {
    const { lines, stream } = sink();
    session = new ProjectSession();
    testApp(session, { logger: { level: 'debug', stream } });
    return lines;
  }

  // Stands in for `opencode serve` over HTTP, answering every message with one payload.
  async function fakeOpencode(payload: unknown): Promise<void> {
    http = createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify((req.url ?? '').includes('/message') ? payload : { id: 'ses_fake' }));
      });
    });
    await new Promise<void>((r) => http!.listen(0, '127.0.0.1', r));
    const { port } = http!.address() as { port: number };
    process.env.VIBEBOARD_OPENCODE_URL = `http://127.0.0.1:${port}`;
  }

  it('logs the whole error object when a turn fails, keeping the transcript line short', async () => {
    // Everything except `data.message` used to be dropped on the floor, which is why the real
    // failure could not be diagnosed at all: no provider, no status, no kind of fault.
    const error = {
      name: 'ProviderStreamError',
      data: { message: 'Streaming response failed', providerID: 'opencode', status: 502 },
      retryable: true,
    };
    const lines = wiredSink();
    await fakeOpencode({ info: { sessionID: 'ses_1', error }, parts: [] });
    const events: CopilotEvent[] = [];

    await opencodeTurn({ cwd: '/tmp', text: 'hi', onEvent: (e) => events.push(e) });

    const failure = await waitForLine(lines, 'opencode turn failed');
    expect(failure?.component).toBe('opencode');
    expect(failure?.level).toBe(50); // error: the turn produced nothing and nobody else will say why
    expect(failure?.err).toEqual(error);
    // The session the turn was POSTed to, so the failure can be looked up in opencode's own store.
    expect(failure?.sessionId).toBe('ses_fake');
    // THE SPLIT THIS TEST IS ABOUT IS UNCHANGED: the whole object goes to the log, one readable line
    // goes to the transcript. What changed on 2026-08-31 is that the line is an `error` event rather
    // than a `text` one — a failure is not something the model said — and it leads with a remedy
    // instead of a payload. The NAME still reaches the user, which is what "Streaming response
    // failed" on its own was missing, and a 502 classifies as a provider fault, so it offers a retry.
    const failureEvent = events.find((e) => e.kind === 'error');
    expect(failureEvent?.text).toContain('ProviderStreamError: Streaming response failed');
    expect(failureEvent?.retryable).toBe(true);
  });

  it('says nothing when the turn worked', async () => {
    const lines = wiredSink();
    await fakeOpencode({ info: { sessionID: 'ses_2' }, parts: [{ type: 'text', text: 'ok' }] });

    await opencodeTurn({ cwd: '/tmp', text: 'hi', onEvent: () => {} });

    expect(lines.filter((l) => l.msg === 'opencode turn failed')).toEqual([]);
  });

  it('forwards the spawned server’s output to the log once it is up', async () => {
    // Before this, everything the child said after the listening line went nowhere — including the
    // provider errors that explain a failed turn.
    //
    // This is the UNBOXED spawn, which now exists only for tests — production runs the server as its
    // box's main process, where the same output has to be followed with `docker logs` instead. That
    // path is covered in test/opencode-server.test.ts; what is asserted here is the forwarding rule
    // itself: which stream lands at which level, and that the banner and blank lines do not.
    const lines = wiredSink();
    // No box, deliberately: with one attached this would take the container route and never spawn.
    attachBoxes(undefined);
    delete process.env.VIBEBOARD_OPENCODE_URL; // so a server really is spawned
    process.env.VIBEBOARD_OPENCODE_BIN = SHIM;

    expect(await opencodeBaseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const provider = await waitForLine(lines, 'provider error: no credentials for anthropic');
    expect(provider?.component).toBe('opencode');
    expect(provider?.level).toBe(40); // warn: worth reading, but the server is still serving
    expect(provider?.stream).toBe('stderr');

    const routine = await waitForLine(lines, 'GET /session 200');
    expect(routine?.level).toBe(20); // debug: per-request chatter would bury the file at info
    expect(routine?.stream).toBe('stdout');

    // The banner arrived before the promise settled, so it was matched for the URL, not logged.
    expect(lines.some((l) => String(l.msg).includes('listening on'))).toBe(false);
    // A chunk that is only a newline must not become a blank line in the file.
    expect(lines.filter((l) => l.component === 'opencode' && l.msg === '')).toEqual([]);
  });

  it('stops growing the startup buffer once it holds enough to diagnose a startup failure', () => {
    // The leak is invisible from outside — memory, not output — so the cap is tested where it lives.
    const capped = capStartupLog('', 'x'.repeat(20_000));
    expect(capped.length).toBe(8192);
    expect(capStartupLog(capped, 'and more').length).toBe(8192);
    // The HEAD survives: the listening banner and any startup failure both come first, and the URL
    // is matched in this same string.
    expect(capStartupLog('listening on http://127.0.0.1:1234', 'y'.repeat(20_000))).toMatch(
      /^listening on http:\/\/127\.0\.0\.1:1234y+$/,
    );
  });
});
