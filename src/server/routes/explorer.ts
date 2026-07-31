import type { FastifyInstance } from 'fastify';
import { listDir, readFileNode } from '../explorer-list.js';
import { type AppCtx, ensureOpen } from '../route-context.js';

// The Explorer tab: the project as it is on disk. Unlike the control routes there is no allow-list —
// every path under the root is reachable — so the project root is the only boundary, enforced in
// fs-sandbox.ts. Read-only for now; mutations land in their own phase.
export async function registerExplorerRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/explorer/list', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    // No path means the project root, which is what the tree asks for first.
    const { path } = req.query as { path?: string };
    const listing = await listDir(ctx.session.root, path ?? '');
    if (!listing) return reply.code(400).send({ error: 'Not a directory in this project' });
    return listing;
  });

  api.get('/explorer/file', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path } = req.query as { path?: string };
    const read = await readFileNode(ctx.session.root, path);
    if (read === null) return reply.code(400).send({ error: 'Path not allowed' });
    if (read === 'not-a-file') return reply.code(400).send({ error: 'Not a file' });
    return read;
  });
}
