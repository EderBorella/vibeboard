import { networkInterfaces } from 'node:os';
import { ProjectSession } from './session.js';
import { buildApp } from './app.js';
import { registerStatic } from './static.js';
import { stopOpencodeServer } from './opencode-server.js';
import { restoreLastProject } from './app-state.js';

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
const app = buildApp(session);

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
  if (isLoopback) {
    console.log(`\n  This machine only. To reach it from other devices: VIBEBOARD_HOST=0.0.0.0`);
  }
  if (!served) {
    console.log('\n  UI build not found — run `npm run build`, or `npm run web:dev` for hot reload.');
  }
  console.log('');
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
