import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { chmodSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CopilotSession, type CopilotMode } from '../src/server/copilot.js';
import type { CopilotEvent } from '../src/server/copilot-events.js';

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-claude.mjs');
const ARGS_LOG = join(here, 'fixtures', '.shim-args.log');

beforeAll(() => {
  chmodSync(SHIM, 0o755);
  process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
  process.env.VIBEBOARD_OPENCODE_BIN = SHIM;
  process.env.VIBEBOARD_SHIM_ARGS = ARGS_LOG;
});

afterEach(() => {
  if (existsSync(ARGS_LOG)) rmSync(ARGS_LOG);
});

async function run(
  session: CopilotSession,
  text: string,
  mode: CopilotMode = 'bypassPermissions',
): Promise<CopilotEvent[]> {
  const events: CopilotEvent[] = [];
  await session.send({ cwd: here, text, mode, onEvent: (e) => events.push(e) });
  return events;
}

function lastArgs(): string[][] {
  return readFileSync(ARGS_LOG, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
}

describe('CopilotSession', () => {
  it('streams events for a turn and captures the session id', async () => {
    const session = new CopilotSession();
    const events = await run(session, 'hello');
    expect(events.map((e) => e.kind)).toEqual(['init', 'text', 'result']);
    expect(session.state.sessionId).toBe('shim-session');
    expect(session.state.model).toBe('shim-model');
    expect(session.state.running).toBe(false);
  });

  it('resumes the session on the next turn', async () => {
    const session = new CopilotSession();
    await run(session, 'first');
    const events = await run(session, 'second');
    const textEvt = events.find((e) => e.kind === 'text');
    expect(textEvt).toEqual({ kind: 'text', text: 'resumed' });
    // second invocation carried --resume shim-session
    expect(lastArgs()[1]).toContain('--resume');
    expect(lastArgs()[1]).toContain('shim-session');
  });

  it('newSession() drops the id so the next turn is fresh', async () => {
    const session = new CopilotSession();
    await run(session, 'first');
    session.newSession();
    expect(session.state.sessionId).toBeUndefined();
    const events = await run(session, 'again');
    expect(events.find((e) => e.kind === 'text')).toEqual({ kind: 'text', text: 'fresh' });
    expect(lastArgs()[1]).not.toContain('--resume');
  });

  it('passes the chosen permission mode', async () => {
    const session = new CopilotSession();
    await run(session, 'x', 'plan');
    const args = lastArgs()[0];
    expect(args).toContain('--permission-mode');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
  });

  it('forwards model, effort, and requests partial-message streaming', async () => {
    const session = new CopilotSession();
    await session.send({
      cwd: here,
      text: 'x',
      mode: 'acceptEdits',
      model: 'haiku',
      effort: 'low',
      onEvent: () => {},
    });
    const args = lastArgs()[0];
    expect(args).toContain('--include-partial-messages');
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
  });

  it('spawns with a real model and effort when the caller names neither', async () => {
    // A blank model used to mean "let the CLI pick", which made the model in use invisible.
    const session = new CopilotSession();
    await run(session, 'x');
    const args = lastArgs()[0];
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('treats empty strings as unset rather than passing them through', async () => {
    const session = new CopilotSession();
    await session.send({ cwd: here, text: 'x', mode: 'plan', model: '', effort: '', onEvent: () => {} });
    const args = lastArgs()[0];
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('appends the VibeBoard instructions on every turn', async () => {
    const session = new CopilotSession();
    await run(session, 'x', 'bypassPermissions');
    const args = lastArgs()[0];
    const append = args[args.indexOf('--append-system-prompt') + 1];
    expect(append).toContain('VibeBoard copilot');
    expect(append).toContain('A column is a folder');
  });

  it('research mode uses plan permission and adds the research persona', async () => {
    const session = new CopilotSession();
    await run(session, 'x', 'research');
    const args = lastArgs()[0];
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
    const append = args[args.indexOf('--append-system-prompt') + 1];
    expect(append).toContain('Research mode');
    expect(append).toContain('web search');
  });
});
