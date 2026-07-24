import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopilotLine, type CopilotEvent } from './copilot-events.js';
import { parseOpencodeLine } from './copilot-opencode.js';

// UI-facing modes. 'research' shares plan permission but adds a research persona.
export type CopilotMode = 'research' | 'plan' | 'acceptEdits' | 'bypassPermissions';
export type Backend = 'claude-code' | 'opencode';

export interface CopilotState {
  running: boolean;
  sessionId: string | undefined;
  model: string | undefined;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface SendOptions {
  cwd: string;
  text: string;
  mode: CopilotMode;
  backend?: Backend; // default claude-code
  model?: string;    // claude: alias/full name · opencode: provider/model
  effort?: EffortLevel;
  onEvent: (event: CopilotEvent) => void;
}

// OpenCode's reasoning knob is --variant (minimal/high/max); map our effort scale onto it.
const EFFORT_TO_VARIANT: Record<EffortLevel, string | undefined> = {
  low: 'minimal', medium: undefined, high: 'high', xhigh: 'high', max: 'max',
};

function opencodeBin(): string {
  return process.env.VIBEBOARD_OPENCODE_BIN ?? 'opencode';
}

interface Command { bin: string; args: string[] }

function claudeCommand(opts: SendOptions, sessionId: string | undefined): Command {
  const { permission, persona } = resolveMode(opts.mode);
  const appendPrompt = [vibeboardInstructions(), persona].filter(Boolean).join('\n\n');
  const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--permission-mode', permission];
  if (appendPrompt) args.push('--append-system-prompt', appendPrompt);
  if (opts.model) args.push('--model', opts.model);
  if (opts.effort) args.push('--effort', opts.effort);
  if (sessionId) args.push('--resume', sessionId);
  args.push(opts.text);
  return { bin: claudeBin(), args };
}

function opencodeCommand(opts: SendOptions, sessionId: string | undefined): Command {
  const args = ['run', '--format', 'json', '--dir', opts.cwd];
  if (opts.model) args.push('-m', opts.model);
  if (opts.effort) { const v = EFFORT_TO_VARIANT[opts.effort]; if (v) args.push('--variant', v); }
  if (opts.mode === 'bypassPermissions') args.push('--auto');
  if (sessionId) args.push('-s', sessionId);
  // OpenCode has no --append-system-prompt; on the first turn of a session prepend the
  // VibeBoard instructions (+research directive) so it has the same context as Claude.
  let message = opts.text;
  if (!sessionId) {
    const persona = opts.mode === 'research' ? RESEARCH_PERSONA : '';
    const preamble = [vibeboardInstructions(), persona].filter(Boolean).join('\n\n');
    if (preamble) message = `${preamble}\n\n# Task\n${opts.text}`;
  }
  args.push(message);
  return { bin: opencodeBin(), args };
}

const RESEARCH_PERSONA = [
  '# Research mode',
  'You are brainstorming and researching, not building. Do NOT create or edit cards or',
  'files. Use web search and web fetch to gather current information, explore options and',
  'trade-offs, and think broadly. End with a concise summary of findings and a clear',
  'recommendation the user can act on.',
].join('\n');

// Each UI mode → the claude --permission-mode it runs under, plus any extra persona.
function resolveMode(mode: CopilotMode): { permission: string; persona?: string } {
  switch (mode) {
    case 'research': return { permission: 'plan', persona: RESEARCH_PERSONA };
    case 'plan': return { permission: 'plan' };
    case 'acceptEdits': return { permission: 'acceptEdits' };
    case 'bypassPermissions': return { permission: 'bypassPermissions' };
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

// One headless Claude Code turn at a time, resumed across turns by session id, run in the
// open project's directory so its file edits flow back through the board watcher.
export class CopilotSession {
  #sessionId: string | undefined;
  #model: string | undefined;
  #child: ChildProcess | undefined;

  get state(): CopilotState {
    return { running: this.#child !== undefined, sessionId: this.#sessionId, model: this.#model };
  }

  // Start a brand-new conversation on the next send (drops the resumable id).
  newSession(): void {
    this.cancel();
    this.#sessionId = undefined;
    this.#model = undefined;
  }

  cancel(): void {
    if (this.#child) {
      this.#child.kill('SIGTERM');
      this.#child = undefined;
    }
  }

  async send(opts: SendOptions): Promise<void> {
    if (this.#child) throw new Error('Copilot is busy');

    const backend: Backend = opts.backend ?? 'claude-code';
    if (backend === 'opencode') this.#model = opts.model; // opencode doesn't announce its model
    const { bin, args } = backend === 'opencode'
      ? opencodeCommand(opts, this.#sessionId)
      : claudeCommand(opts, this.#sessionId);

    const child = spawn(bin, args, { cwd: opts.cwd, env: process.env });
    this.#child = child;

    let buf = '';
    let stderr = '';
    const emitLine = (line: string): void => {
      if (backend === 'opencode') {
        const { events, sessionId } = parseOpencodeLine(line);
        if (sessionId) this.#sessionId = sessionId;
        for (const event of events) opts.onEvent(event);
        return;
      }
      for (const event of parseCopilotLine(line)) {
        if (event.kind === 'init') { this.#sessionId = event.sessionId; this.#model = event.model; }
        else if (event.kind === 'result' && event.sessionId) { this.#sessionId = event.sessionId; }
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
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    await new Promise<void>((resolve) => {
      child.on('close', (code) => {
        if (buf.trim()) emitLine(buf);
        this.#child = undefined;
        if (code && code !== 0) {
          opts.onEvent({ kind: 'text', text: `\n[copilot exited (${code})]${stderr ? `\n${stderr.slice(0, 800)}` : ''}` });
        }
        resolve();
      });
      child.on('error', (err) => {
        this.#child = undefined;
        opts.onEvent({ kind: 'text', text: `[copilot failed to start: ${err.message}]` });
        resolve();
      });
    });
  }
}
