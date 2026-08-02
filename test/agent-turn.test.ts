import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The OpenCode half talks HTTP to a spawned server; the client is the seam, so it is mocked and
// every assertion about that backend is about what agent-turn ASKS of it.
const client = vi.hoisted(() => ({ opencodeTurn: vi.fn() }));
vi.mock('../src/server/opencode-client.js', () => client);

const { runAgentTurn } = await import('../src/server/agent-turn.js');

import { INSTRUCTIONS_FILE } from '../src/core/layout.js';
import type { AgentTurnOptions, AgentTurnResult } from '../src/server/agent-turn.js';
import type { CopilotEvent } from '../src/server/copilot-events.js';

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-cli.mjs');
// Stryker copies the repo into a sandbox that does not carry the executable bit, so the shim could
// not be spawned there and every turn failed — which failed the dry run before any mutant existed.
chmodSync(SHIM, 0o755);

// A fresh log and cwd per test, outside the repo: the suite runs with heavy concurrency and a fixed
// path silently interleaves two tests' argv.
let dir: string;
let log: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibeboard-turn-'));
  log = join(dir, 'args.log');
  client.opencodeTurn.mockReset();
});

// The instructions document lives in a folder now, so writing it means creating that folder first.
function writeInstructions(body: string): void {
  mkdirSync(dirname(join(dir, INSTRUCTIONS_FILE)), { recursive: true });
  writeFileSync(join(dir, INSTRUCTIONS_FILE), body, 'utf8');
}

interface Turn {
  result: AgentTurnResult;
  events: CopilotEvent[];
  argv: string[];
}

// Run one claude turn against the shim and return everything observable about it.
async function claudeTurn(over: Partial<AgentTurnOptions> = {}, marks = ''): Promise<Turn> {
  const events: CopilotEvent[] = [];
  const turn = runAgentTurn({
    cwd: dir,
    text: `hello [[log:${log}]]${marks}`,
    mode: 'bypassPermissions',
    backend: 'claude-code',
    model: 'opus',
    effort: 'high',
    timeoutMs: 10_000,
    bin: SHIM,
    onEvent: (e) => events.push(e),
    ...over,
  });
  const result = await turn.done;
  return { result, events, argv: argvFromLog() };
}

function lastInvocation(): { argv: string[]; cwd: string; prompt: string } {
  return JSON.parse(readFileSync(log, 'utf8').trim().split('\n').at(-1) as string);
}

function argvFromLog(): string[] {
  return lastInvocation().argv;
}

// The value of --append-system-prompt, which is where all three prompt sources land.
function appended(argv: string[]): string {
  const at = argv.indexOf('--append-system-prompt');
  return at === -1 ? '' : argv[at + 1];
}

describe('the claude command', () => {
  it('is built in full, in order, and carries no prompt at all', async () => {
    // The EXACT flags: every one of them is a string a mutant can quietly change, and the CLI fails
    // silently on a wrong flag rather than loudly. The prompt is NOT among them — it goes in on
    // stdin, because it carries the run's credential and argv is world readable through /proc.
    const { argv } = await claudeTurn();
    const withoutPrompt = argv.filter((a) => a !== appended(argv));
    expect(withoutPrompt).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
      '--append-system-prompt',
      '--model',
      'opus',
      '--effort',
      'high',
    ]);
    // And it really did arrive — on stdin. Asserting only its absence from argv would pass if the
    // prompt were never delivered at all.
    const { prompt } = lastInvocation();
    expect(prompt).toContain('hello');
    expect(argv.join(' ')).not.toContain('hello');
  });

  it.each([
    ['bypassPermissions', 'bypassPermissions', false],
    ['acceptEdits', 'acceptEdits', false],
    ['plan', 'plan', false],
    ['research', 'plan', true],
    ['nonsense-from-an-older-ui', 'bypassPermissions', false],
  ])('maps mode %s to --permission-mode %s', async (mode, permission, hasPersona) => {
    // Research is plan-mode PLUS a persona; plan is the same permission WITHOUT it. Asserting both
    // halves is what tells those two apart — the permission alone cannot.
    const { argv } = await claudeTurn({ mode });
    expect(argv[argv.indexOf('--permission-mode') + 1]).toBe(permission);
    expect(appended(argv).includes('# Research mode')).toBe(hasPersona);
  });

  it('omits a flag it has no value for, rather than passing an empty one', async () => {
    // `--model ''` is not the same as no --model: the CLI would take the empty string as a choice.
    const { argv } = await claudeTurn({ model: '', effort: '' });
    expect(argv).not.toContain('--model');
    expect(argv).not.toContain('--effort');
    expect(argv).not.toContain('--resume');
  });

  it('resumes only when given a session to resume', async () => {
    expect((await claudeTurn({ sessionId: 'abc-123' })).argv).toContain('--resume');
    const resumed = await claudeTurn({ sessionId: 'abc-123' });
    expect(resumed.argv[resumed.argv.indexOf('--resume') + 1]).toBe('abc-123');
    expect((await claudeTurn()).argv).not.toContain('--resume');
  });

  it('carries VibeBoard’s own instructions on every turn', async () => {
    expect(appended((await claudeTurn()).argv)).toContain('VibeBoard');
  });

  it('appends the bundled instructions and NOTHING else when the project adds none', async () => {
    // Exact equality, not `toContain`: this is the assembly — an absent INSTRUCTIONS.md must
    // contribute no section and no separator. A substring match accepts stray text and blank
    // sections either side of it.
    const bundled = readFileSync(join(here, '..', 'src', 'server', 'copilot-system-prompt.md'), 'utf8');
    expect(appended((await claudeTurn()).argv)).toBe(bundled);
  });

  it('treats an empty INSTRUCTIONS.md exactly like no file at all', async () => {
    // Both paths return an empty section, and the difference between "no section" and "an empty
    // section joined in" is two blank lines nobody can see in a substring assertion.
    const none = appended((await claudeTurn()).argv);
    writeInstructions('   \n\n');
    expect(appended((await claudeTurn()).argv)).toBe(none);
  });

  it('joins the project’s section on with exactly one blank line', async () => {
    const bundled = readFileSync(join(here, '..', 'src', 'server', 'copilot-system-prompt.md'), 'utf8');
    writeInstructions('Prefer small cards.');
    expect(appended((await claudeTurn()).argv)).toBe(
      `${bundled}\n\n# Project instructions (from ${INSTRUCTIONS_FILE})\n\nPrefer small cards.`,
    );
  });

  it('reads INSTRUCTIONS.md fresh each turn, so an edit needs no restart', async () => {
    // The bundled instructions are cached; the project's are deliberately not. A turn before the
    // file exists and one after it must differ, or an edit would need a server restart.
    const before = appended((await claudeTurn()).argv);
    expect(before).not.toContain('Project instructions');
    writeInstructions('Always ask about the schema.');
    const after = appended((await claudeTurn()).argv);
    expect(after).toContain(`# Project instructions (from ${INSTRUCTIONS_FILE})`);
    expect(after).toContain('Always ask about the schema.');
  });

  it('says nothing about project instructions when the file is empty', async () => {
    writeInstructions('   \n\n');
    expect(appended((await claudeTurn()).argv)).not.toContain('Project instructions');
  });

  it('runs in the project directory, so relative paths mean what the card means', async () => {
    // Asserted from the shim's own working directory, not from the init event: the parser drops the
    // cwd the CLI reports, so the event cannot answer this.
    await claudeTurn();
    expect(lastInvocation().cwd).toBe(dir);
  });
});

describe('the claude stream', () => {
  it('forwards every event and reports the session and model the CLI chose', async () => {
    const { result, events } = await claudeTurn();
    expect(events.map((e) => e.kind)).toEqual(['init', 'text', 'result']);
    expect(result).toEqual({
      sessionId: 'shim-session',
      model: 'shim-model',
      exitCode: 0,
      timedOut: false,
      // Carried out of the turn, not merely forwarded to onEvent: this is what the run record bills
      // from. Exact equality, so a field silently dropped from the mapping fails here.
      stats: {
        ok: true,
        text: 'done',
        costUsd: 0.0125,
        durationMs: 5,
        turns: 1,
        contextTokens: 5,
        outputTokens: 7,
      },
    });
  });

  it('reports no stats when the CLI never sent a result line', async () => {
    // A killed or crashed turn spent something, but nothing said how much — inventing zeros would
    // read as "this run was free".
    const { result } = await claudeTurn({}, '[[behaviour:notail]]');
    expect(result.stats).toBeUndefined();
  });

  it('takes the session id from the result when there was no init', async () => {
    // Both branches write `sessionId`, and a resumed turn may never see an init line.
    const { result } = await claudeTurn({}, '[[behaviour:noinit]]');
    expect(result.sessionId).toBe('shim-session');
    expect(result.model).toBeUndefined();
  });

  it('keeps the caller’s session id when the CLI reports none', async () => {
    const { result } = await claudeTurn({ sessionId: 'mine' }, '[[behaviour:tail]]');
    expect(result.sessionId).toBe('shim-session');
    expect((await claudeTurn({ sessionId: 'mine' }, '[[behaviour:hangless]]')).result.sessionId).toBe(
      'shim-session',
    );
  });

  it('keeps the session id when the last event does not carry one', async () => {
    // A stream that ends on a text event must not blank the id the init gave us — the caller uses it
    // to resume, and undefined means "start a new conversation".
    const { result } = await claudeTurn({}, '[[behaviour:notail]]');
    expect(result.sessionId).toBe('shim-session');
    expect(result.model).toBe('shim-model');
  });

  it('reassembles a line split across two chunks', async () => {
    // stdout arrives in arbitrary pieces. Without the buffer, half a JSON line is parsed as garbage
    // and the init event — and with it the session id — is lost.
    const { result, events } = await claudeTurn({}, '[[behaviour:split]]');
    expect(events.map((e) => e.kind)).toEqual(['init', 'result']);
    expect(result.sessionId).toBe('shim-session');
  });

  it('emits a final line that arrived without a trailing newline', async () => {
    // A CLI that exits mid-line would otherwise lose its last event — usually the result.
    const { events } = await claudeTurn({}, '[[behaviour:tail]]');
    expect(events.map((e) => e.kind)).toEqual(['init', 'result']);
  });

  it('reports a non-zero exit with the stderr tail, so a broken CLI says why', async () => {
    // The exact message, not a substring: the code, the stderr and the separator between them are
    // all things a mutant can change while still "containing" the words.
    const { result, events } = await claudeTurn({}, '[[behaviour:fail]]');
    expect(result.exitCode).toBe(2);
    const text = events.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    expect(text.join('')).toBe('\n[copilot exited (2)]\nsomething went very wrong\n');
  });

  it('reports a failure that said nothing, without a dangling separator', async () => {
    const { result, events } = await claudeTurn({}, '[[behaviour:failquiet]]');
    expect(result.exitCode).toBe(3);
    const text = events.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    expect(text.join('')).toBe('\n[copilot exited (3)]');
  });

  it('truncates a huge stderr rather than pasting it all into the panel', async () => {
    const { events } = await claudeTurn({}, '[[behaviour:bigerr]]');
    const text = events.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    const stderr = text.join('').split(']\n')[1] ?? '';
    expect(stderr).toHaveLength(800);
  });

  it('says nothing extra about a clean exit', async () => {
    const { events } = await claudeTurn();
    const text = events.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    expect(text.join('')).not.toContain('copilot exited');
  });

  it('reports a CLI that cannot start at all, rather than hanging', async () => {
    const events: CopilotEvent[] = [];
    const turn = runAgentTurn({
      cwd: dir,
      text: 'hello',
      mode: 'bypassPermissions',
      backend: 'claude-code',
      model: '',
      effort: '',
      timeoutMs: 5_000,
      bin: join(dir, 'no-such-executable'),
      onEvent: (e) => events.push(e),
    });
    const result = await turn.done;
    expect(result.exitCode).toBeNull();
    expect(events.some((e) => e.kind === 'text' && e.text.includes('failed to start'))).toBe(true);
  });

  it('stops a turn that never answers, and says how long it waited', async () => {
    const events: CopilotEvent[] = [];
    const turn = runAgentTurn({
      cwd: dir,
      text: `hang [[log:${log}]][[behaviour:hang]]`,
      mode: 'bypassPermissions',
      backend: 'claude-code',
      model: '',
      effort: '',
      timeoutMs: 400,
      bin: SHIM,
      onEvent: (e) => events.push(e),
    });
    const result = await turn.done;
    expect(result.timedOut).toBe(true);
    const text = events.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    expect(text.join('')).toContain('No response after 0s');
    // The kill is ours, so the non-zero exit it causes must not be reported as the CLI failing.
    expect(text.join('')).not.toContain('copilot exited');
  });

  it('rounds the wait to whole seconds, because a person reads it', async () => {
    const events: CopilotEvent[] = [];
    await runAgentTurn({
      cwd: dir,
      text: `hang [[log:${log}]][[behaviour:hang]]`,
      mode: 'bypassPermissions',
      backend: 'claude-code',
      model: '',
      effort: '',
      timeoutMs: 1_600,
      bin: SHIM,
      onEvent: (e) => events.push(e),
    }).done;
    const text = events.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    expect(text.join('')).toContain('No response after 2s');
  });

  it('can be cancelled, and settles rather than leaving the caller waiting', async () => {
    const turn = runAgentTurn({
      cwd: dir,
      text: `hang [[log:${log}]][[behaviour:hang]]`,
      mode: 'bypassPermissions',
      backend: 'claude-code',
      model: '',
      effort: '',
      timeoutMs: 30_000,
      bin: SHIM,
      onEvent: () => {},
    });
    turn.cancel();
    const result = await turn.done;
    // Killed by signal: no exit code, and NOT a timeout — the caller distinguishes the two.
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(false);
  });
});

describe('the opencode backend', () => {
  const opencodeTurn = async (over: Partial<AgentTurnOptions> = {}): Promise<Turn> => {
    const events: CopilotEvent[] = [];
    const turn = runAgentTurn({
      cwd: dir,
      text: 'do it',
      mode: 'build',
      backend: 'opencode',
      model: 'opencode/nemotron',
      effort: 'max',
      timeoutMs: 10_000,
      onEvent: (e) => events.push(e),
      ...over,
    });
    return { result: await turn.done, events, argv: [] };
  };

  it('asks the client for exactly what it was given', async () => {
    client.opencodeTurn.mockResolvedValue('oc-session');
    const { result } = await opencodeTurn({ sessionId: 'previous' });
    const call = client.opencodeTurn.mock.calls[0][0];
    expect(call.cwd).toBe(dir);
    expect(call.text).toBe('do it');
    expect(call.model).toBe('opencode/nemotron');
    // OpenCode calls it a variant, not an effort — the rename is this module's job.
    expect(call.variant).toBe('max');
    expect(call.sessionId).toBe('previous');
    expect(call.system).toContain('VibeBoard');
    expect(result).toEqual({
      sessionId: 'oc-session',
      model: 'opencode/nemotron',
      exitCode: 0,
      timedOut: false,
    });
  });

  it('taps the result event on its way through, so the run can be billed', async () => {
    // The client returns only a session id — the stats arrive as one of the events it forwards, so
    // this module has to watch them go past rather than read them off a return value.
    const stats = {
      ok: true,
      text: 'done',
      costUsd: 0.004,
      durationMs: 900,
      turns: 2,
      contextTokens: 1200,
      outputTokens: 34,
    };
    client.opencodeTurn.mockImplementation(async (opts: { onEvent: (e: CopilotEvent) => void }) => {
      opts.onEvent({ kind: 'result', sessionId: 'oc-session', stats });
      return 'oc-session';
    });

    const { result, events } = await opencodeTurn();
    expect(result.stats).toEqual(stats);
    // Tapping must not swallow it: the chat renders from these events.
    expect(events).toEqual([{ kind: 'result', sessionId: 'oc-session', stats }]);
  });

  it('still reports what a failed turn spent', async () => {
    // The stats arrive before the failure, and a turn that burned tokens and then broke is exactly
    // the one worth accounting for.
    const stats = {
      ok: false,
      text: '',
      costUsd: 0.002,
      durationMs: 100,
      turns: 1,
      contextTokens: 10,
      outputTokens: 0,
    };
    client.opencodeTurn.mockImplementation(async (opts: { onEvent: (e: CopilotEvent) => void }) => {
      opts.onEvent({ kind: 'result', sessionId: 'oc-session', stats });
      throw new Error('provider exploded');
    });

    const { result } = await opencodeTurn();
    expect(result.exitCode).toBe(1);
    expect(result.stats).toEqual(stats);
  });

  it('adds the research persona only in research mode, and nothing else', async () => {
    // `startsWith`, not just "does not contain Research": the non-research branch passes an empty
    // string, and asserting only the absence of the persona would accept ANY other text landing
    // there instead.
    client.opencodeTurn.mockResolvedValue('s');
    await opencodeTurn({ mode: 'research' });
    const research = client.opencodeTurn.mock.calls[0][0].system as string;
    await opencodeTurn({ mode: 'build' });
    const build = client.opencodeTurn.mock.calls[1][0].system as string;
    expect(research).toContain('# Research mode');
    expect(build).not.toContain('# Research mode');
    expect(research.startsWith(build)).toBe(true);
    expect(research.length).toBeGreaterThan(build.length);
  });

  it('stops its timer when the turn succeeds, so no late message arrives', async () => {
    // Without clearing it, the timeout fires after a finished turn and tells the user a completed
    // run was abandoned. Real time, not fake: the timer is the thing under test.
    client.opencodeTurn.mockResolvedValue('oc-session');
    const { events } = await opencodeTurn({ timeoutMs: 150 });
    expect(events).toEqual([]);
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toEqual([]);
  });

  it('carries the project’s own instructions too', async () => {
    writeInstructions('Prefer small cards.');
    client.opencodeTurn.mockResolvedValue('s');
    await opencodeTurn();
    expect(client.opencodeTurn.mock.calls[0][0].system).toContain('Prefer small cards.');
  });

  it('reports a failure as text and a non-zero exit', async () => {
    client.opencodeTurn.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const { result, events } = await opencodeTurn();
    expect(result).toEqual({ model: 'opencode/nemotron', exitCode: 1, timedOut: false });
    expect(events.some((e) => e.kind === 'text' && e.text.includes('[opencode failed:'))).toBe(true);
    expect(events.some((e) => e.kind === 'text' && e.text.includes('ECONNREFUSED'))).toBe(true);
  });

  it('describes a rejection that is not an Error', async () => {
    client.opencodeTurn.mockRejectedValueOnce('the server went away');
    const { events } = await opencodeTurn();
    expect(events.some((e) => e.kind === 'text' && e.text.includes('the server went away'))).toBe(true);
  });

  it('times out by aborting the request, and does not also blame the client', async () => {
    // The abort makes the client reject. Reporting that as "[opencode failed]" on top of the timeout
    // message would tell the user two different stories about one event.
    client.opencodeTurn.mockImplementationOnce(
      (opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const { result, events } = await opencodeTurn({ timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
    const text = events.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    expect(text.join('')).toContain('No response after 0s');
    expect(text.join('')).not.toContain('[opencode failed:');
  });

  it('cancels by aborting the request', async () => {
    let signal: AbortSignal | undefined;
    client.opencodeTurn.mockImplementationOnce(
      (opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal = opts.signal;
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const events: CopilotEvent[] = [];
    const turn = runAgentTurn({
      cwd: dir,
      text: 'do it',
      mode: 'build',
      backend: 'opencode',
      model: 'm',
      effort: '',
      timeoutMs: 30_000,
      onEvent: (e) => events.push(e),
    });
    turn.cancel();
    const result = await turn.done;
    expect(signal?.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

describe('runAgentTurn', () => {
  it('routes by backend, and treats anything unknown as claude', async () => {
    // The record's backend is a string from disk; an old or hand-edited one must not silently reach
    // the opencode client with claude arguments.
    client.opencodeTurn.mockResolvedValue('s');
    await claudeTurn({ backend: 'nonsense' as AgentTurnOptions['backend'] });
    expect(client.opencodeTurn).not.toHaveBeenCalled();
    expect(argvFromLog()).toContain('-p');
  });
});
