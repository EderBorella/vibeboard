import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTRUCTIONS_FILE } from '../core/layout.js';
import { groupStartTime, terminateGroup } from '../exec/process-group.js';
import { boxEnvFor } from './boxes/containers.js';
import { claudeConfigDir, isolationEnabled } from './boxes/copilot-env.js';
import { neverConnected, OpencodeTurnFailed, opencodeTurn } from './boxes/opencode-client.js';
import { NOT_REQUESTED, type SandboxStatus, wrapCommand } from './boxes/sandbox.js';
import { type CopilotEvent, parseCopilotLine, type ResultStats } from './copilot-events.js';
import { errorText } from './errors.js';

// ONE agent turn: build the command, run it, stream its events, report how it ended.
//
// Extracted from CopilotSession so the chat copilot and the skill runner share exactly one copy of
// the command building and stream parsing. What is NOT here is everything about *identity*: no
// session id is remembered, no chat is written, nothing is queued. A turn takes what it is given
// and returns what happened, which is why one runner can have many in flight while the chat
// singleton has one.

// Modes/efforts are backend-specific (see BACKEND_CAPS on the web side). They're plain strings
// here; each backend's command builder interprets its own values.
export type CopilotMode = string;
export type EffortLevel = string;
export type Backend = 'claude-code' | 'opencode';

export interface AgentTurnOptions {
  cwd: string;
  text: string;
  mode: CopilotMode;
  backend: Backend;
  model: string;
  effort: EffortLevel;
  // Resume a previous CLI conversation. The chat passes one; a skill run never does — a run is one
  // prompt in, one report out.
  sessionId?: string;
  timeoutMs: number;
  // Which executable to spawn. Passed explicitly by callers that must not depend on process-wide
  // state: a test setting VIBEBOARD_CLAUDE_BIN in a beforeEach races any sibling test file sharing
  // the process, which is how Stryker's dry run started failing where `npm test` passed.
  bin?: string;
  // Whether to confine this turn, and to what. Absent means unconfined — the same shape as `bin`,
  // and for the same reason: a test must be able to state it rather than inherit process state.
  // Probed once per server, not per turn: it cannot change while the process runs.
  sandbox?: SandboxStatus;
  // WHICH box to run in. Required whenever `sandbox` is ok — `wrapCommand` throws without it rather
  // than returning an unconfined command, because "confined" stopped being a property of the status
  // alone the moment containment became a resource something has to create.
  box?: string;
  onEvent: (event: CopilotEvent) => void;
}

export interface AgentTurnResult {
  // The CLI session this turn belonged to, when the backend reports one. The caller decides
  // whether to remember it.
  sessionId?: string;
  model?: string;
  exitCode: number | null;
  timedOut: boolean;
  // What the turn cost, from the backend's own result event — both backends report one, normalised
  // by copilot-events. Absent when the turn died before saying (failed to start, killed, timed out).
  stats?: ResultStats;
}

export interface RunningTurn {
  done: Promise<AgentTurnResult>;
  cancel: () => void;
  // The turn's own process group, and when its leader started. Recorded on the run so a LATER server
  // can reap what this one leaves behind, and paired because pids are reused — see exec/process-group.ts.
  //
  // Absent for OpenCode: that backend is an HTTP request to a managed server, so a turn has no process
  // of its own. The server itself is covered by its pid file.
  pgid?: number;
  pgstart?: number;
}

const RESEARCH_PERSONA = [
  '# Research mode',
  'You are brainstorming and researching, not building. Do NOT create or edit cards or',
  'files. Use web search and web fetch to gather current information, explore options and',
  'trade-offs, and think broadly. End with a concise summary of findings and a clear',
  'recommendation the user can act on.',
].join('\n');

// Claude Code mode → --permission-mode + optional persona. Unknown values fall back to a
// safe permission mode (this only receives Claude modes; OpenCode routes elsewhere).
function resolveMode(mode: CopilotMode): { permission: string; persona?: string } {
  switch (mode) {
    case 'research':
      return { permission: 'plan', persona: RESEARCH_PERSONA };
    case 'plan':
      return { permission: 'plan' };
    case 'acceptEdits':
      return { permission: 'acceptEdits' };
    case 'bypassPermissions':
      return { permission: 'bypassPermissions' };
    default:
      return { permission: 'bypassPermissions' };
  }
}

// An explicit bin wins; otherwise the env var, resolved per spawn so import order cannot matter.
function claudeBin(bin: string | undefined): string {
  return bin ?? process.env.VIBEBOARD_CLAUDE_BIN ?? 'claude';
}

// The bundled VibeBoard instructions, appended to every turn's system prompt so the copilot
// knows the model/conventions without spending tokens rediscovering them. Cached after first
// read; resolved next to this module (copied into dist by the build).
let cachedInstructions: string | undefined;
function vibeboardInstructions(): string {
  if (cachedInstructions !== undefined) return cachedInstructions;
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), 'copilot-system-prompt.md');
    cachedInstructions = readFileSync(path, 'utf8');
  } catch {
    cachedInstructions = '';
  }
  return cachedInstructions;
}

// The user's own project instructions, read FRESH each turn — no cache — so edits (by the user or
// the copilot) take effect on the next message with no restart. Injected into the system prompt for
// both backends. Absent/empty file → no-op.
function projectInstructions(cwd: string): string {
  try {
    const body = readFileSync(resolve(cwd, INSTRUCTIONS_FILE), 'utf8').trim();
    return body ? `# Project instructions (from ${INSTRUCTIONS_FILE})\n\n${body}` : '';
  } catch {
    return '';
  }
}

function systemPrompt(cwd: string, persona: string | undefined): string {
  return [vibeboardInstructions(), projectInstructions(cwd), persona].filter(Boolean).join('\n\n');
}

function claudeCommand(opts: AgentTurnOptions): { bin: string; args: string[] } {
  const { permission, persona } = resolveMode(opts.mode);
  const appendPrompt = systemPrompt(opts.cwd, persona);
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--permission-mode',
    permission,
  ];
  if (appendPrompt) args.push('--append-system-prompt', appendPrompt);
  if (opts.model) args.push('--model', opts.model);
  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.sessionId) args.push('--resume', opts.sessionId);
  // The prompt is NOT an argument. It carries the run's credential, and a command line is world
  // readable through /proc/<pid>/cmdline for as long as the process lives — so any other agent on
  // the machine, or the chat copilot, could lift another run's token with `ps`. It goes in on
  // stdin instead, which nothing outside this process can see. `claude -p` reads it from there.
  return { bin: claudeBin(opts.bin), args };
}

// OpenCode: talk to a persistent `opencode serve` over HTTP (per-turn message, session reused
// across turns when the caller supplies one). The VibeBoard instructions go in the `system` field.
// WHAT A TURN THAT NEVER REACHED THE SERVER SPENT: nothing, and we know it rather than assume it.
//
// `fault.ts` will only call a dead run the machine's fault from usage the backend REPORTED being zero
// in both directions — absent usage says nothing at all — so an OpenCode turn that could not open a
// connection was indistinguishable on disk from an agent that tried and gave up. Three such runs on
// 2026-08-16 burned every attempt `derive-features` had and produced a stop blaming a README that
// nothing had opened.
//
// `costUsd: 0` is a measurement for the same reason the tokens are: nobody was billed for a request
// nobody received. `durationMs` is real wall clock and is carried because it is what made these
// recognisable by eye — 449ms against a healthy run's two minutes — even though `fault.ts` refuses to
// classify on duration and says why.
function unreachableStats(startedAt: number): ResultStats {
  return {
    ok: false,
    text: '',
    costUsd: 0,
    durationMs: Date.now() - startedAt,
    contextTokens: 0,
    outputTokens: 0,
  };
}

// How an OpenCode turn that threw is reported. Lifted out of the closure it used to sit in, which the
// complexity gate refused once this decision joined the two already there — and the three are about
// different things, which is the better argument for separating them.
function failedTurn(
  err: unknown,
  ctx: { opts: AgentTurnOptions; timedOut: boolean; startedAt: number; stats?: ResultStats },
): AgentTurnResult {
  // The session THIS TURN was working in, carried out of the failure. A turn that created a session and
  // then failed used to report none, so the chat forgot a conversation that exists on the server and
  // its next message opened another — losing the thread instead of continuing it.
  const sessionId = err instanceof OpencodeTurnFailed ? err.sessionId : ctx.opts.sessionId;
  // `ctx.stats ?? …` and never an overwrite: a turn that streamed real numbers and then lost the
  // connection spent what it spent, and replacing those with zeroes would erase it.
  const stats = ctx.stats ?? (neverConnected(err) ? unreachableStats(ctx.startedAt) : undefined);
  return {
    ...(sessionId ? { sessionId } : {}),
    model: ctx.opts.model,
    exitCode: 1,
    timedOut: ctx.timedOut,
    ...(stats ? { stats } : {}),
  };
}

function startOpencode(opts: AgentTurnOptions): RunningTurn {
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    opts.onEvent({
      kind: 'text',
      text: `\n[No response after ${Math.round(opts.timeoutMs / 1000)}s — stopping. The provider may be slow or the model unavailable.]`,
    });
    abort.abort();
  }, opts.timeoutMs);

  // Measured around the whole turn, and only ever read on the failure path: a turn that reached the
  // server reports the server's own timing, which is the better number. This one exists so a turn that
  // reached nothing can still say how long it took to find that out.
  const startedAt = Date.now();

  // Tapped on the way through rather than returned by the client: the result event is one of the
  // events the caller is already being sent, and a failed turn still reports what it spent.
  let stats: ResultStats | undefined;
  const onEvent = (event: CopilotEvent): void => {
    if (event.kind === 'result') stats = event.stats;
    opts.onEvent(event);
  };

  const done = (async (): Promise<AgentTurnResult> => {
    try {
      const sessionId = await opencodeTurn({
        cwd: opts.cwd,
        text: opts.text,
        model: opts.model,
        variant: opts.effort,
        system: systemPrompt(opts.cwd, opts.mode === 'research' ? RESEARCH_PERSONA : ''),
        sessionId: opts.sessionId,
        signal: abort.signal,
        onEvent,
      });
      return { sessionId, model: opts.model, exitCode: 0, timedOut, stats };
    } catch (err) {
      if (!timedOut) opts.onEvent({ kind: 'text', text: `\n[opencode failed: ${errorText(err)}]` });
      return failedTurn(err, { opts, timedOut, startedAt, ...(stats ? { stats } : {}) });
    } finally {
      clearTimeout(timer);
    }
  })();

  return { done, cancel: () => abort.abort() };
}

// Claude Code: spawn `claude -p` and stream its stdout.
function startClaude(opts: AgentTurnOptions): RunningTurn {
  const { bin, args } = claudeCommand(opts);
  const sandbox = opts.sandbox ?? NOT_REQUESTED;
  // The config dir has to be named on the side of the boundary the CLI actually runs on. Boxed, that
  // is a path INSIDE the container (`/state/claude`), passed to `docker exec -e`; the host path is a
  // digest directory that means nothing in there. Unboxed — tests only, now that docker is required —
  // it is the host path in the spawn's own environment.
  const boxEnv = isolationEnabled() ? boxEnvFor('claude-code') : {};
  const env =
    !sandbox.ok && isolationEnabled()
      ? { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDir() }
      : process.env;
  // Confinement is applied here because one Claude turn is one process. This THROWS rather than
  // silently running unconfined when the sandbox is available but no box was resolved.
  const spawned = wrapCommand(bin, args, sandbox, opts.box, boxEnv);
  // `detached` makes this child a process-group LEADER, so everything it starts — compilers, test
  // runners, servers — belongs to one group we can signal as a unit. Without it a stop reached the
  // direct child only and its grandchildren were reparented to init, still working and still spending.
  // Deliberately NOT `unref`ed: we keep the handle, and the stdio pipes below are how the turn is read.
  const child: ChildProcess = spawn(spawned.bin, spawned.args, { cwd: opts.cwd, env, detached: true });
  const pgid = child.pid;
  // Written and closed immediately: `claude -p` waits for EOF before it begins, so leaving the pipe
  // open hangs the turn until the timeout.
  child.stdin?.end(opts.text, 'utf8');

  let sessionId = opts.sessionId;
  let model: string | undefined;
  let stats: ResultStats | undefined;
  let buf = '';
  let stderr = '';
  const emitLine = (line: string): void => {
    for (const event of parseCopilotLine(line)) {
      if (event.kind === 'init') {
        sessionId = event.sessionId;
        model = event.model;
      } else if (event.kind === 'result') {
        // The session id is conditional (it is not always present); the stats are not.
        if (event.sessionId) sessionId = event.sessionId;
        stats = event.stats;
      }
      opts.onEvent(event);
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    // Last piece is the incomplete tail; it stays buffered until the next chunk.
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) emitLine(line);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  // One way to stop this turn, used by both the timeout and an explicit cancel. Falls back to the
  // child alone when the spawn produced no pid, which means it never started.
  const stop = (): void => {
    if (pgid === undefined) child.kill('SIGTERM');
    else terminateGroup(pgid);
  };

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    opts.onEvent({
      kind: 'text',
      text: `\n[No response after ${Math.round(opts.timeoutMs / 1000)}s — stopping. The model/provider may be slow or rate-limited; try a different model.]`,
    });
    stop();
  }, opts.timeoutMs);

  const done = new Promise<AgentTurnResult>((settle) => {
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) emitLine(buf);
      if (!timedOut && code && code !== 0) {
        opts.onEvent({
          kind: 'text',
          text: `\n[copilot exited (${code})]${stderr ? `\n${stderr.slice(0, 800)}` : ''}`,
        });
      }
      settle({ sessionId, model, exitCode: code, timedOut, stats });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      opts.onEvent({ kind: 'text', text: `[copilot failed to start: ${err.message}]` });
      // No stats: a process that never started never reported any.
      settle({ sessionId, model, exitCode: null, timedOut });
    });
  });

  // Read immediately rather than at cancel time: by then the process may be gone, and the pair is
  // recorded on the run for a future server to identify the group with.
  return {
    done,
    cancel: stop,
    ...(pgid === undefined ? {} : { pgid, pgstart: groupStartTime(pgid) }),
  };
}

// Start a turn. Returns immediately with a handle: await `done` for how it ended, call `cancel` to
// stop it. Which backend runs is the caller's decision — nothing here reads config.
export function runAgentTurn(opts: AgentTurnOptions): RunningTurn {
  return opts.backend === 'opencode' ? startOpencode(opts) : startClaude(opts);
}
