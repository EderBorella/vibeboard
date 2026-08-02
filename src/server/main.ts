import { networkInterfaces } from 'node:os';
import { buildApp } from './app.js';
import { restoreLastProject } from './app-state.js';
import { adminToken, CredentialStore } from './credentials.js';
import { installCrashHandlers, serverLogger } from './logging.js';
import { stopOpencodeServer } from './opencode-server.js';
import { ProjectSession } from './session.js';
import { registerStatic } from './static.js';

// Load ./.env if the user has one, so `npm start` and `npm run dev` pick up local config with
// no wrapper script. Node's own loader — no dependency. A missing .env is the normal case and
// is silently ignored; anything already exported in the environment still wins.
try {
  process.loadEnvFile();
} catch {
  /* no .env — defaults and exported vars apply */
}

const port = Number(process.env.VIBEBOARD_PORT ?? 4610);
// Loopback by default. The copilot auto-approves tool calls — it can read and write files anywhere
// in the open project — so exposing that to a network must be a deliberate act: set
// VIBEBOARD_HOST=0.0.0.0 to reach it from other devices. The API is authenticated either way.
const host = process.env.VIBEBOARD_HOST ?? '127.0.0.1';
const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
const session = new ProjectSession();
// Resolved here rather than inside buildApp so the file is opened once and the banner can say where
// it is — a log nobody can find is barely better than no log.
const logging = serverLogger();
// The browser's credential, persisted so a restart does not log the open tab out. It reaches the
// page through the URL printed below and nowhere else: serving it over HTTP would hand it to any
// agent that can reach loopback, which is all of them.
const admin = await adminToken();
const app = buildApp(session, { logger: logging.options, credentials: new CredentialStore(admin) });
// Anything that rejects or throws outside a request used to end the process in silence. Node exits
// on both of these by default, so this only adds the record of why.
installCrashHandlers(app.log);

// Don't leave the managed `opencode serve` orphaned when VibeBoard stops. SIGHUP is here because a
// server started from a terminal gets it when that terminal closes, which is one of the ordinary
// ways this process dies. SIGKILL cannot be caught at all — the pid file in opencode-server.ts is
// what covers that, and every other way the process can die without reaching this line.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(sig, () => {
    // Runs first: these are real agent processes, and once this one exits nothing else will stop
    // them. They would go on working, and spending, on a board nobody is watching.
    const stopped = app.runner.cancelAll();
    if (stopped > 0) console.log(`\n  stopped ${stopped} run${stopped === 1 ? '' : 's'} still in flight`);
    stopOpencodeServer();
    process.exit(0);
  });
}
process.once('exit', () => {
  app.runner.cancelAll();
  stopOpencodeServer();
});

function lanAddress(): string | undefined {
  for (const iface of Object.values(networkInterfaces())) {
    for (const info of iface ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return undefined;
}

async function start(): Promise<void> {
  const served = await registerStatic(app);
  // Reopen whatever was open last, so a restart doesn't dump you back at the project gate.
  const reopened = await restoreLastProject(session);
  await app.listen({ port, host });
  const lan = isLoopback ? undefined : lanAddress();
  // The token is in the link on purpose: the browser trades it for a stored credential on first
  // visit, and the terminal is the one channel an agent has no way to read.
  //
  // That is the intended separation, not the current one. Until the sandbox lands, the token file
  // is readable by any agent — and the token is only kept out of the log because the request
  // serializer strips it (logging.ts). It was not, and it was found sitting in a log file.
  const q = `?token=${admin}`;
  console.log(`\n  VibeBoard running`);
  console.log(`  → http://localhost:${port}/${q}${lan ? `\n  → http://${lan}:${port}/${q}  (LAN)` : ''}`);
  if (reopened) console.log(`  → reopened ${reopened}`);
  if (logging.file) console.log(`  → logging to ${logging.file}`);
  if (isLoopback) {
    console.log(`\n  This machine only. To reach it from other devices: VIBEBOARD_HOST=0.0.0.0`);
  }
  if (!served) {
    console.log('\n  UI build not found — run `npm run build`, or `npm run web:dev` for hot reload.');
  }
  console.log('');
}

start().catch((err) => {
  app.log.fatal(err, 'VibeBoard failed to start');
  // Also on stderr: the log goes to a file by default, and a server that never started must say so
  // in the terminal that launched it rather than only somewhere you have not thought to look.
  console.error(err);
  process.exit(1);
});
