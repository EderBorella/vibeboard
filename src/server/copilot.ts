import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopilotLine, type CopilotEvent } from './copilot-events.js';
import { opencodeTurn } from './opencode-client.js';
import { claudeConfigDir, isolationEnabled } from './copilot-env.js';
import { DEFAULT_BACKEND, backendDefaults } from '../core/backends.js';

// Modes/efforts are backend-specific (see BACKEND_CAPS on the web side). They're plain
// strings here; each backend's command builder interprets its own values.
export type CopilotMode = string;
export type EffortLevel = string;
export type Backend = 'claude-code' | 'opencode';

interface CopilotState {
  running: boolean;
  sessionId: string | undefined;
  model: string | undefined;
}

interface SendOptions {
  cwd: string;
  text: string;
  mode: CopilotMode;
  backend?: Backend; // default claude-code
  model?: string; // claude: alias/full name · opencode: provider/model
  effort?: EffortLevel; // claude: --effort scale · opencode: --variant scale
  onEvent: (event: CopilotEvent) => void;
}

interface Command {
  bin: string;
  args: string[];
}

function claudeCommand(opts: SendOptions, sessionId: string | undefined): Command {
  const { permission, persona } = resolveMode(opts.mode);
  const appendPrompt = [vibeboardInstructions(), projectInstructions(opts.cwd), persona]
    .filter(Boolean)
    .join('\n\n');
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
  if (sessionId) args.push('--resume', sessionId);
  args.push(opts.text);
  return { bin: claudeBin(), args };
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

// Resolved per spawn so tests can point at a shim via env without import-order pitfalls.
function claudeBin(): string {
  return process.env.VIBEBOARD_CLAUDE_BIN ?? 'claude';
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

// One headless Claude Code turn at a time, resumed across turns by session id, run in the
// open project's directory so its file edits flow back through the board watcher.
export class CopilotSession {
  #sessionId: string | undefined;
  #model: string | undefined;
  #child: ChildProcess | undefined; // claude spawn
  #abort: AbortController | undefined; // opencode HTTP turn

  get state(): CopilotState {
    return {
      running: this.#child !== undefined || this.#abort !== undefined,
      sessionId: this.#sessionId,
      model: this.#model,
    };
  }

  // Start a brand-new conversation on the next send (drops the resumable session id).
  newSession(): void {
    this.cancel();
    this.#sessionId = undefined;
    this.#model = undefined;
  }

  // Point the next send at a previous conversation (used when reopening a stored chat whose
  // backend matches the current one). No-op while a turn is in flight.
  resume(sessionId: string | undefined, model: string | undefined): void {
    if (this.#child || this.#abort) return;
    this.#sessionId = sessionId;
    this.#model = model;
  }

  cancel(): void {
    if (this.#child) {
      this.#child.kill('SIGTERM');
      this.#child = undefined;
    }
    if (this.#abort) {
      this.#abort.abort();
      this.#abort = undefined;
    }
  }

  async send(opts: SendOptions): Promise<void> {
    if (this.#child || this.#abort) throw new Error('Copilot is busy');
    const backend: Backend = opts.backend ?? (DEFAULT_BACKEND as Backend);
    // Belt and braces, deliberately kept after resolveCopilotSelection landed: this guards a
    // caller that bypasses the route layer entirely (a raw WebSocket client, or an
    // unmigrated config), where nothing has resolved a default yet. Pinned by
    // test/copilot.test.ts ('spawns with a real model and effort when the caller names
    // neither') and test/opencode-variant.test.ts.
    const defaults = backendDefaults(backend);
    const resolved: SendOptions = {
      ...opts,
      backend,
      model: opts.model || defaults.model,
      effort: opts.effort || defaults.effort,
    };
    return backend === 'opencode' ? this.#sendOpencode(resolved) : this.#sendClaude(resolved);
  }

  // OpenCode: talk to a persistent `opencode serve` over HTTP (per-turn message, session
  // reused across turns). The VibeBoard instructions go in the `system` field.
  async #sendOpencode(opts: SendOptions): Promise<void> {
    this.#model = opts.model;
    const persona = opts.mode === 'research' ? RESEARCH_PERSONA : '';
    const system = [vibeboardInstructions(), projectInstructions(opts.cwd), persona]
      .filter(Boolean)
      .join('\n\n');
    const abort = new AbortController();
    this.#abort = abort;
    const timeoutMs = Number(process.env.VIBEBOARD_COPILOT_TIMEOUT_MS ?? 180000);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      opts.onEvent({
        kind: 'text',
        text: `\n[No response after ${Math.round(timeoutMs / 1000)}s — stopping. The provider may be slow or the model unavailable.]`,
      });
      abort.abort();
    }, timeoutMs);
    try {
      this.#sessionId = await opencodeTurn({
        cwd: opts.cwd,
        text: opts.text,
        model: opts.model,
        variant: opts.effort,
        system,
        sessionId: this.#sessionId,
        signal: abort.signal,
        onEvent: opts.onEvent,
      });
    } catch (err) {
      if (!timedOut)
        opts.onEvent({
          kind: 'text',
          text: `\n[opencode failed: ${err instanceof Error ? err.message : String(err)}]`,
        });
    } finally {
      clearTimeout(timer);
      this.#abort = undefined;
    }
  }

  // Claude Code: spawn `claude -p` per turn and stream its stdout.
  async #sendClaude(opts: SendOptions): Promise<void> {
    const { bin, args } = claudeCommand(opts, this.#sessionId);
    // Isolated config dir so the personal ~/.claude/CLAUDE.md, plugins, and hooks don't load.
    const env = isolationEnabled() ? { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDir() } : process.env;
    const child = spawn(bin, args, { cwd: opts.cwd, env });
    this.#child = child;

    let buf = '';
    let stderr = '';
    const emitLine = (line: string): void => {
      for (const event of parseCopilotLine(line)) {
        if (event.kind === 'init') {
          this.#sessionId = event.sessionId;
          this.#model = event.model;
        } else if (event.kind === 'result' && event.sessionId) {
          this.#sessionId = event.sessionId;
        }
        opts.onEvent(event);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        emitLine(line);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const timeoutMs = Number(process.env.VIBEBOARD_COPILOT_TIMEOUT_MS ?? 180000);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      opts.onEvent({
        kind: 'text',
        text: `\n[No response after ${Math.round(timeoutMs / 1000)}s — stopping. The model/provider may be slow or rate-limited; try a different model.]`,
      });
      child.kill('SIGTERM');
    }, timeoutMs);

    await new Promise<void>((resolve) => {
      child.on('close', (code) => {
        clearTimeout(timer);
        if (buf.trim()) emitLine(buf);
        this.#child = undefined;
        if (!timedOut && code && code !== 0) {
          opts.onEvent({
            kind: 'text',
            text: `\n[copilot exited (${code})]${stderr ? `\n${stderr.slice(0, 800)}` : ''}`,
          });
        }
        resolve();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        this.#child = undefined;
        opts.onEvent({ kind: 'text', text: `[copilot failed to start: ${err.message}]` });
        resolve();
      });
    });
  }
}
