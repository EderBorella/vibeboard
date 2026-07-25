import type { FastifyInstance } from 'fastify';
import {
  listControlFiles,
  readControlFile,
  writeControlFile,
  deleteControlFile,
  createControlFile,
  renameControlFile,
  readResources,
  writeResources,
} from '../control-files.js';
import { ensureOpen, type AppCtx } from '../route-context.js';

// Project Control: the file controller for documents that steer the models. Every path is
// sandboxed to the project root + an allow-list inside control-files.ts.
export async function registerControlRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/control/files', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return { groups: await listControlFiles(ctx.session.root) };
  });

  api.get('/control/file', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path } = req.query as { path?: string };
    const file = await readControlFile(ctx.session.root, path);
    if (!file) return reply.code(400).send({ error: 'Path not allowed' });
    return file;
  });

  api.put('/control/file', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path, content } = req.body as { path?: string; content?: string };
    const ok = await writeControlFile(ctx.session.root, path, content ?? '');
    if (!ok) return reply.code(400).send({ error: 'Path not allowed' });
    return { ok: true };
  });

  // Create with a default, collision-free name ("New doc", "New doc 2", …). The UI renames it
  // in place afterwards, so there is no browser dialog in the flow.
  api.post('/control/create', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { category } = req.body as { category?: string };
    const file = await createControlFile(ctx.session.root, category);
    if (!file) return reply.code(400).send({ error: 'Cannot create in that category' });
    return file;
  });

  api.post('/control/rename', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path, name } = req.body as { path?: string; name?: string };
    const result = await renameControlFile(ctx.session.root, path, name);
    if (result === 'taken') return reply.code(409).send({ error: 'That name is already used' });
    if (!result) return reply.code(400).send({ error: 'Cannot rename that file' });
    return result;
  });

  api.delete('/control/file', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path } = req.query as { path?: string };
    const result = await deleteControlFile(ctx.session.root, path);
    if (result === 'invalid') return reply.code(400).send({ error: 'Path not allowed' });
    if (result === 'not-allowed') return reply.code(400).send({ error: 'This file cannot be deleted' });
    return { ok: true };
  });

  api.get('/control/resources', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return { links: await readResources(ctx.session.root) };
  });

  api.put('/control/resources', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { links } = req.body as { links?: unknown[] };
    await writeResources(ctx.session.root, links ?? []);
    return { ok: true };
  });
}
