import { spawn, type ChildProcess } from 'node:child_process';
import { opencodeConfigHome, isolationEnabled } from './copilot-env.js';

// A single managed `opencode serve` process, started lazily and reused for every turn.
// We talk to it over HTTP (see opencode-client) — `opencode run` per turn hangs at init on
// some setups, whereas the persistent server is fast and reliable. Set VIBEBOARD_OPENCODE_URL
// to attach to a server you run yourself instead of spawning one.

function opencodeBin(): string {
  return process.env.VIBEBOARD_OPENCODE_BIN ?? 'opencode';
}

let child: ChildProcess | undefined;
let urlPromise: Promise<string> | undefined;

function startServer(): Promise<string> {
  const port = Number(process.env.VIBEBOARD_OPENCODE_PORT ?? 4099);
  const args = ['serve', '--port', String(port), '--hostname', '127.0.0.1'];
  // Isolate from the user's personal opencode config: a clean XDG_CONFIG_HOME means
  // opencode finds no ~/.config/opencode AGENTS.md/config/plugins. Auth + db stay in the
  // default XDG_DATA_HOME (~/.local/share/opencode), so login is preserved.
  const env = isolationEnabled() ? { ...process.env, XDG_CONFIG_HOME: opencodeConfigHome() } : process.env;
  const proc = spawn(opencodeBin(), args, { env });
  child = proc;

  return new Promise<string>((resolve, reject) => {
    let out = '';
    let settled = false;
    const onData = (c: Buffer): void => {
      out += c.toString('utf8');
      const m = out.match(/listening on (http:\/\/\S+)/i);
      if (m && !settled) { settled = true; clearTimeout(timer); resolve(m[1].trim()); }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', (code) => {
      child = undefined; urlPromise = undefined;
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`opencode serve exited (${code}): ${out.slice(0, 300)}`)); }
    });
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('opencode serve did not report a listening URL in time')); }
    }, 20000);
  });
}

export function opencodeBaseUrl(): Promise<string> {
  const attach = process.env.VIBEBOARD_OPENCODE_URL;
  if (attach) return Promise.resolve(attach.replace(/\/$/, ''));
  if (!urlPromise) urlPromise = startServer();
  return urlPromise;
}

export function stopOpencodeServer(): void {
  if (child) { child.kill('SIGTERM'); child = undefined; urlPromise = undefined; }
}
