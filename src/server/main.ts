import { networkInterfaces } from 'node:os';
import { ProjectSession } from './session.js';
import { buildApp } from './app.js';
import { registerStatic } from './static.js';

const port = Number(process.env.VIBEBOARD_PORT ?? 4610);
const session = new ProjectSession();
const app = buildApp(session);

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
  await app.listen({ port, host: '0.0.0.0' });
  const lan = lanAddress();
  console.log(`\n  VibeBoard running`);
  console.log(`  → http://localhost:${port}${lan ? `\n  → http://${lan}:${port}  (LAN)` : ''}`);
  if (!served) {
    console.log('\n  UI build not found — run `npm run build`, or `npm run web:dev` for hot reload.');
  }
  console.log('');
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
