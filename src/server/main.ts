import { networkInterfaces } from 'node:os';
import { buildApp } from './app.js';
import { adminToken, CredentialStore } from './auth/credentials.js';
import { DeviceStore } from './auth/devices.js';
import { installBreakGlass, signinBanner } from './auth/signin-terminal.js';
import { ProjectSession } from './boards/session.js';
import { listenOnApiSocket, removeApiSocketFile } from './boxes/api-socket.js';
import { BoxService } from './boxes/box-service.js';
import { DEFAULT_IMAGE } from './boxes/containers.js';
import { claudeCredentialCheck } from './boxes/credential-freshness.js';
import { stopOpencodeServer } from './boxes/opencode-server.js';
import { liveSandbox, probeSandbox } from './boxes/sandbox.js';
import { installCrashHandlers, serverLogger } from './logging.js';
import { restoreLastProject } from './settings/app-state.js';
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
// Every agent box this server makes or adopts. One service, because a box is keyed by project and
// backend and outlives any single request.
const boxes = new BoxService();
// Probed once, here, because the answer cannot change while the process runs and every agent this
// server starts is confined identically. The banner says which mode we are in: a sandbox nobody can
// see the state of is a sandbox nobody trusts.
// One shot for the BANNER, which is a statement about this moment and is printed once.
const sandbox = await probeSandbox(boxes, DEFAULT_IMAGE);
// And a live one for the app, because an image can be built or removed while the server runs and the
// startup answer then gates every dispatch with something that stopped being true.
//
// The credential check is composed in HERE and nowhere else, for the same reason: it is the only place
// that holds both the box layer and the open project. `() => session.root` and not `session.root` —
// this is built once at startup and the open project changes under it on every switch, so a captured
// root would go on answering about a box nobody is using. The banner probe above deliberately does not
// get it: at that moment no project is open, so there is no box to be stale.
const sandboxNow = liveSandbox(boxes, DEFAULT_IMAGE, {
  credential: claudeCredentialCheck(() => session.root),
});
const app = buildApp(session, {
  logger: logging.options,
  credentials: new CredentialStore(admin, devices),
  devices,
  sandbox: sandboxNow,
  boxes,
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
    // The CHAT's turn too, which was missing from this list for as long as the list existed. It is the
    // same kind of process as a run — spawned into its own group, so nothing else takes it down — and
    // a three-minute reasoning turn is very often what is in flight when somebody presses Ctrl-C.
    app.copilot.cancel();
    // And the auto-pilot loop. It is spawned DETACHED, so it is in its own session: a terminal's Ctrl-C
    // never reaches it, SIGHUP never reaches it, and losing its parent only reparents it to init. Without
    // this line it goes on ticking against a port nothing is listening on, and the next server finds a
    // state file naming a live group it does not own.
    if (app.service.stop()) console.log('  stopped the auto-pilot loop');
    stopOpencodeServer();
    removeApiSocketFile();
    // AWAITED, unlike everything above it, because removing a container is a round trip to the daemon
    // and `process.exit` does not wait for a promise. A box left running is not merely untidy: it
    // holds the project's bind mounts and an idle CLI for as long as the machine is up. Capped, so a
    // wedged daemon delays a Ctrl-C by seconds rather than hanging it — the startup sweep is the
    // backstop for whatever this misses.
    void Promise.race([
      boxes.stopAll().then((n) => {
        if (n > 0) console.log(`  stopped ${n} agent box${n === 1 ? '' : 'es'}`);
      }),
      new Promise((r) => setTimeout(r, 15_000)),
    ]).finally(() => process.exit(0));
  });
}
process.once('exit', () => {
  app.runner.cancelAll();
  app.copilot.cancel();
  app.service.stop();
  stopOpencodeServer();
  removeApiSocketFile();
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

// Boxes left by a VibeBoard that did not get to shut down — a SIGKILL, an OOM kill, a crashed host.
//
// ONLY once this process holds the API socket, which is what makes it the single VibeBoard on this
// machine. `stopAll` removes every box carrying our label and cannot tell one instance's from
// another's, so running it unguarded meant starting a second copy destroyed the FIRST one's boxes —
// killing a run mid-write — before failing to bind the port and exiting. It used to run before the
// socket was even attempted, justified by a comment claiming the socket refused a second instance:
// it does, but not until later, and the bind failure is deliberately not fatal.
async function sweepOldBoxes(ownsSocket: boolean): Promise<void> {
  if (!ownsSocket) {
    app.log.warn('did not sweep old agent boxes: another VibeBoard may hold the API socket');
    return;
  }
  const swept = await boxes.stopAll().catch(() => 0);
  if (swept > 0) console.log(`  swept ${swept} agent box${swept === 1 ? '' : 'es'} left by a previous run`);
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
  // The same API on a unix socket, for agent boxes. Not fatal if it cannot bind: the board, the browser
  // and every host-side agent still work without it, and refusing to start the whole server because a
  // container transport is unavailable would be a worse failure than the one it guards.
  let apiSocket: string | undefined;
  try {
    apiSocket = (await listenOnApiSocket(app)).path;
  } catch (err) {
    app.log.error({ err }, 'could not open the API socket; agents in containers will not reach the API');
  }

  await sweepOldBoxes(apiSocket !== undefined);
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
  if (apiSocket) console.log(`  → API socket ${apiSocket} (how agent boxes reach this server)`);
  // Stated either way. Silence about an absent sandbox is how "best-effort" quietly becomes "none".
  console.log(
    sandbox.ok
      ? `  → agents run in containers (${sandbox.image}): they cannot write cards, config, skills or instructions`
      : `  → agents DISABLED — ${sandbox.reason}`,
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
