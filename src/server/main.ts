import { networkInterfaces } from 'node:os';
import { buildApp } from './app.js';
import { restoreLastProject } from './app-state.js';
import { adminToken, CredentialStore } from './credentials.js';
import { DeviceStore } from './devices.js';
import { installCrashHandlers, serverLogger } from './logging.js';
import { stopOpencodeServer } from './opencode-server.js';
import { probeSandbox } from './sandbox.js';
import { ProjectSession } from './session.js';
import { installBreakGlass, signinBanner } from './signin-terminal.js';
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
// The server's own credential, persisted so it survives a restart. It is NO LONGER PRINTED and no
// longer reaches the browser: browsers sign themselves in per device (see signin.ts). It remains a
// valid credential, and `?token=` remains an accepted ingestion path, as the documented recovery route
// for a machine where the loopback claim cannot be reached.
const admin = await adminToken();
// Read before the app is built, because `buildApp` is synchronous. `devices.empty` is what decides
// whether the unauthenticated first claim is open, so this file is the authority on it.
const devices = await DeviceStore.load();
// Probed once, here, because the answer cannot change while the process runs and every agent this
// server starts is confined identically. The banner says which mode we are in: a sandbox nobody can
// see the state of is a sandbox nobody trusts.
const sandbox = await probeSandbox();
const app = buildApp(session, {
  logger: logging.options,
  credentials: new CredentialStore(admin, devices),
  devices,
  sandbox,
});
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
    // And the auto-pilot loop. It is spawned DETACHED, so it is in its own session: a terminal's Ctrl-C
    // never reaches it, SIGHUP never reaches it, and losing its parent only reparents it to init. Without
    // this line it goes on ticking against a port nothing is listening on, and the next server finds a
    // state file naming a live group it does not own.
    if (app.service.stop()) console.log('  stopped the auto-pilot loop');
    stopOpencodeServer();
    process.exit(0);
  });
}
process.once('exit', () => {
  app.runner.cancelAll();
  app.service.stop();
  stopOpencodeServer();
});

// The way back in when every signed-in browser is gone — a lost phone, a reimaged laptop, a wiped
// profile. `on` rather than `once`: needing it twice is not a reason to have to restart the server.
installBreakGlass({
  on: (signal, handler) => {
    process.on(signal, handler);
  },
  out: (line) => console.log(line),
  clear: () => devices.clear(),
  closeSockets: () => app.closeDevice(null),
  onError: (err) => app.log.error({ err }, 'could not sign every browser out'),
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
  // A `running` state on disk belongs to the process that died: its children went with it, so
  // auto-pilot comes back owing this project a checkup rather than resuming dispatch. `halted`
  // survives, which is why the state is persisted at all.
  if (reopened) await app.autopilot.load();
  await app.listen({ port, host });
  const lan = isLoopback ? undefined : lanAddress();
  // A PLAIN URL. It used to carry `?token=<admin>`, which put a credential that never expires into
  // terminal scrollback, screen shares and every screenshot of a first run — and left it in bookmarks
  // and history at the other end. The browser signs itself in instead; nothing has to be copied.
  console.log(`\n  VibeBoard running`);
  console.log(`  → http://localhost:${port}/${lan ? `\n  → http://${lan}:${port}/  (LAN)` : ''}`);
  for (const line of signinBanner({
    empty: devices.empty,
    devices: devices.size,
    pid: process.pid,
    relocated: process.env.VIBEBOARD_TOKEN_FILE !== undefined,
    sandboxOk: sandbox.ok,
  })) {
    console.log(line);
  }
  if (reopened) console.log(`  → reopened ${reopened}`);
  if (logging.file) console.log(`  → logging to ${logging.file}`);
  // Stated either way. Silence about an absent sandbox is how "best-effort" quietly becomes "none".
  console.log(
    sandbox.ok
      ? `  → agents sandboxed (${sandbox.profile}): they cannot write cards, config, skills or instructions`
      : `  → agents NOT sandboxed — ${sandbox.reason}`,
  );
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
