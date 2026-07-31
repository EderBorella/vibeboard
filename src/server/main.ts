import { networkInterfaces } from 'node:os';
import { buildApp } from './app.js';
import { restoreLastProject } from './app-state.js';
import { serverLogger } from './logging.js';
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
// Loopback by default. VibeBoard has no authentication, and its copilot auto-approves tool
// calls — it can read and write files anywhere in the open project. Exposing that to a network
// must therefore be a deliberate act: set VIBEBOARD_HOST=0.0.0.0 to reach it from other devices.
const host = process.env.VIBEBOARD_HOST ?? '127.0.0.1';
const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
const session = new ProjectSession();
// Resolved here rather than inside buildApp so the file is opened once and the banner can say where
// it is — a log nobody can find is barely better than no log.
const logging = serverLogger();
const app = buildApp(session, { logger: logging.options });

// Don't leave the managed `opencode serve` orphaned when VibeBoard stops.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    stopOpencodeServer();
    process.exit(0);
  });
}
process.once('exit', stopOpencodeServer);

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
  console.log(`\n  VibeBoard running`);
  console.log(`  → http://localhost:${port}${lan ? `\n  → http://${lan}:${port}  (LAN)` : ''}`);
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
