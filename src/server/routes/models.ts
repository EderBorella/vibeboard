import type { FastifyInstance } from 'fastify';
import { DEFAULT_BACKEND } from '../../core/backends.js';
import { listBackendModels, modelStatus } from '../models.js';
import type { AppCtx } from '../route-context.js';

export async function registerModelRoutes(api: FastifyInstance, _ctx: AppCtx): Promise<void> {
  // Available models for a backend as {id, free}. claude → aliases; opencode → its own
  // models + OpenRouter's free tier, free ones flagged and listed first.
  api.get('/models', async (req) => {
    const { backend } = req.query as { backend?: string };
    // req.log, so a failed catalogue fetch is recorded against the request that asked for it.
    return listBackendModels(backend ?? DEFAULT_BACKEND, req.log);
  });

  // Live status/uptime for one model (OpenRouter endpoints route); null if no source.
  api.get('/model-status', async (req) => {
    const { id } = req.query as { id?: string };
    return { status: id ? await modelStatus(id, req.log) : null };
  });
}
