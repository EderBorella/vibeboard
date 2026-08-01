import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_DIR, CONFIG_FILE } from '../src/core/layout.js';
import { buildApp } from '../src/server/app.js';
import { ChatStore } from '../src/server/chat-store.js';
import { installCrashHandlers, type Log } from '../src/server/logging.js';
import { modelStatus } from '../src/server/models.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject, tempDir, wsClient } from './helpers.js';

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
// emits them rather than as buildApp intends them.
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

describe('buildApp wiring', () => {
  it('hands the session a logger, which it has no other way to get', () => {
    // The session is constructed before the app that logs for it, so the composition root is the
    // only place this can happen.
    session = new ProjectSession();
    const attachLogger = vi.spyOn(session, 'attachLogger');
    buildApp(session, { logger: { level: 'silent' } });
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
