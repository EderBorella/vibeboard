import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeConfigDir, isolationEnabled } from './copilot-env.js';
import { type CopilotEvent, parseCopilotLine } from './copilot-events.js';
import { opencodeTurn } from './opencode-client.js';

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
  onEvent: (event: CopilotEvent) => void;
}

export interface AgentTurnResult {
  // The CLI session this turn belonged to, when the backend reports one. The caller decides
  // whether to remember it.
  sessionId?: string;
  model?: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface RunningTurn {
  done: Promise<AgentTurnResult>;
  cancel: () => void;
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

// The user's own project instructions (INSTRUCTIONS.md at the project root), read FRESH each
// turn — no cache — so edits (by the user or the copilot) take effect on the next message with
// no restart. Injected into the system prompt for both backends. Absent/empty file → no-op.
function projectInstructions(cwd: string): string {
  try {
    const body = readFileSync(resolve(cwd, 'INSTRUCTIONS.md'), 'utf8').trim();
    return body ? `# Project instructions (from INSTRUCTIONS.md)\n\n${body}` : '';
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
  args.push(opts.text);
  return { bin: claudeBin(opts.bin), args };
}

// OpenCode: talk to a persistent `opencode serve` over HTTP (per-turn message, session reused
// across turns when the caller supplies one). The VibeBoard instructions go in the `system` field.
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
        onEvent: opts.onEvent,
      });
      return { sessionId, model: opts.model, exitCode: 0, timedOut };
    } catch (err) {
      if (!timedOut)
        opts.onEvent({
          kind: 'text',
          text: `\n[opencode failed: ${err instanceof Error ? err.message : String(err)}]`,
        });
      return { model: opts.model, exitCode: 1, timedOut };
    } finally {
      clearTimeout(timer);
    }
  })();

  return { done, cancel: () => abort.abort() };
}

// Claude Code: spawn `claude -p` and stream its stdout.
function startClaude(opts: AgentTurnOptions): RunningTurn {
  const { bin, args } = claudeCommand(opts);
  // Isolated config dir so the personal ~/.claude/CLAUDE.md, plugins, and hooks don't load.
  const env = isolationEnabled() ? { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDir() } : process.env;
  const child: ChildProcess = spawn(bin, args, { cwd: opts.cwd, env });

  let sessionId = opts.sessionId;
  let model: string | undefined;
  let buf = '';
  let stderr = '';
  const emitLine = (line: string): void => {
    for (const event of parseCopilotLine(line)) {
      if (event.kind === 'init') {
        sessionId = event.sessionId;
        model = event.model;
      } else if (event.kind === 'result' && event.sessionId) {
        sessionId = event.sessionId;
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

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    opts.onEvent({
      kind: 'text',
      text: `\n[No response after ${Math.round(opts.timeoutMs / 1000)}s — stopping. The model/provider may be slow or rate-limited; try a different model.]`,
    });
    child.kill('SIGTERM');
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
      settle({ sessionId, model, exitCode: code, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      opts.onEvent({ kind: 'text', text: `[copilot failed to start: ${err.message}]` });
      settle({ sessionId, model, exitCode: null, timedOut });
    });
  });

  return { done, cancel: () => child.kill('SIGTERM') };
}

// Start a turn. Returns immediately with a handle: await `done` for how it ended, call `cancel` to
// stop it. Which backend runs is the caller's decision — nothing here reads config.
export function runAgentTurn(opts: AgentTurnOptions): RunningTurn {
  return opts.backend === 'opencode' ? startOpencode(opts) : startClaude(opts);
}
