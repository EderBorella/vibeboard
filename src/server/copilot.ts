import { spawn, type ChildProcess } from 'node:child_process';
import { parseCopilotLine, type CopilotEvent } from './copilot-events.js';

// Maps to claude's --permission-mode. Default full-auto; the UI can pick per turn.
export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions';

export interface CopilotState {
  running: boolean;
  sessionId: string | undefined;
  model: string | undefined;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface SendOptions {
  cwd: string;
  text: string;
  mode: PermissionMode;
  model?: string;   // alias (opus/sonnet/haiku/fable) or full name; omit to inherit default
  effort?: EffortLevel;
  onEvent: (event: CopilotEvent) => void;
}

// Resolved per spawn so tests can point at a shim via env without import-order pitfalls.
function claudeBin(): string {
  return process.env.VIBEBOARD_CLAUDE_BIN ?? 'claude';
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

    const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--permission-mode', opts.mode];
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
    if (this.#sessionId) args.push('--resume', this.#sessionId);
    args.push(opts.text);

    const child = spawn(claudeBin(), args, { cwd: opts.cwd, env: process.env });
    this.#child = child;

    let buf = '';
    let stderr = '';
    const emitLine = (line: string): void => {
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
