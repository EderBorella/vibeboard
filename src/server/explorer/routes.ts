import type { FastifyInstance, FastifyReply } from 'fastify';
import { type AppCtx, ensureOpen } from '../route-context.js';
import { listDir, readFileNode } from './explorer-list.js';
import {
  createNode,
  deleteNode,
  deleteTree,
  type MoveResult,
  moveIntoDir,
  renameNode,
  writeFileNode,
} from './explorer-mutate.js';

// Rename and move differ only in what the client supplies; both fail the same three ways.
function sendMove(reply: FastifyReply, result: MoveResult): unknown {
  if (result === 'taken') return reply.code(409).send({ error: 'Something with that name is already there' });
  if (result === 'into-self')
    return reply.code(400).send({ error: 'A folder cannot be moved inside itself' });
  if (result === 'invalid') return reply.code(400).send({ error: 'Path not allowed' });
  return result;
}

// The Explorer tab: the project as it is on disk. Unlike the control routes there is no allow-list —
// every path under the root is reachable — so the project root is the only boundary, enforced in
// fs-sandbox.ts.
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

  api.put('/explorer/file', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path, content } = req.body as { path?: string; content?: string };
    const result = await writeFileNode(ctx.session.root, path, content ?? '');
    if (result === 'not-text') {
      return reply.code(400).send({ error: 'This file is not editable text — refusing to overwrite it' });
    }
    if (result === 'invalid') return reply.code(400).send({ error: 'Path not allowed' });
    return { ok: true };
  });

  // Created with a default, collision-free name; the client renames the row in place afterwards.
  api.post('/explorer/create', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { parent, kind } = req.body as { parent?: string; kind?: string };
    const node = await createNode(ctx.session.root, parent ?? '', kind);
    if (node === 'invalid') return reply.code(400).send({ error: 'Cannot create that here' });
    return node;
  });

  api.post('/explorer/rename', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path, name } = req.body as { path?: string; name?: string };
    return sendMove(reply, await renameNode(ctx.session.root, path, name));
  });

  api.post('/explorer/move', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path, to } = req.body as { path?: string; to?: string };
    return sendMove(reply, await moveIntoDir(ctx.session.root, path, to));
  });

  // One entry: a file, a symlink, or an empty folder. 409 on a folder with contents, which is the
  // client's cue to ask the typed question and come back to /explorer/tree.
  api.delete('/explorer/entry', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path } = req.query as { path?: string };
    const result = await deleteNode(ctx.session.root, path);
    if (result === 'not-empty') return reply.code(409).send({ error: 'This folder is not empty' });
    if (result !== 'ok') return reply.code(400).send({ error: 'Path not allowed' });
    return { ok: true };
  });

  // A folder and everything in it. `confirm` is the folder's own name as the user typed it, checked
  // again here: a guard that lives only in the dialog is a guard the server does not have.
  api.delete('/explorer/tree', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path, confirm } = req.query as { path?: string; confirm?: string };
    const result = await deleteTree(ctx.session.root, path, confirm);
    if (result === 'wrong-name') {
      return reply.code(400).send({ error: 'That is not the name of this folder' });
    }
    if (result !== 'ok') return reply.code(400).send({ error: 'Path not allowed' });
    return { ok: true };
  });
}
