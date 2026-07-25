import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// Resolve the built UI relative to this compiled module: dist/server/static.js -> dist/web.
function webRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../web');
}

// Serve the built React UI as static files with an SPA fallback. Only registers when the
// build exists (production `npm start`); in dev the Vite server serves the UI instead.
export async function registerStatic(app: FastifyInstance): Promise<boolean> {
  const root = webRoot();
  if (!existsSync(resolve(root, 'index.html'))) return false;

  await app.register(fastifyStatic, { root });

  // SPA fallback: any non-API/WS route that isn't a real file returns index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  return true;
}
