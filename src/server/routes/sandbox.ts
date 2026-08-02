import type { FastifyInstance } from 'fastify';
import { attachedOpencodeUrl, restartOpencodeServer, takeOverOpencodeServer } from '../opencode-server.js';
import type { AppCtx } from '../route-context.js';
import { agentRefusal } from '../sandbox.js';

// What is enforced, and the two ways to change it. Its own module rather than a corner of
// control.ts, which is the file controller for documents that steer the models — a different
// concern that happens to share the word "control".
//
// All three are admin-only, and they are so by ABSENCE: a route missing from the scope table in
// auth.ts is admin-only, so an agent reaching any of these gets a 403 without anyone having to
// remember to deny it. A run restarting the server it is running inside is not an authority it has
// any business holding.
export async function registerSandboxRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/sandbox', async () => {
    const attached = attachedOpencodeUrl();
    return {
      ok: ctx.sandbox.ok,
      profile: ctx.sandbox.ok ? ctx.sandbox.profile : undefined,
      reason: ctx.sandbox.ok ? undefined : ctx.sandbox.reason,
      // Reported even when the sandbox is fine, because it is the other half of whether auto-pilot
      // may start — and the UI shows a different action for each.
      backend: attached ? ('attached' as const) : ('managed' as const),
      attachedUrl: attached,
      // Computed here, once, so the UI never has to re-derive the rule and drift from the loop.
      // The same gate dispatch uses, not a second opinion about it.
      agentRefusal: agentRefusal(ctx.sandbox, attached),
    };
  });

  api.post('/opencode/restart', async (req) => {
    const url = await restartOpencodeServer();
    req.log.info({ url }, 'opencode server restarted');
    return { ok: true, url };
  });

  api.post('/opencode/takeover', async (req) => {
    const previous = attachedOpencodeUrl();
    const url = await takeOverOpencodeServer();
    req.log.info({ previous, url }, 'took over from an external opencode server');
    return { ok: true, url };
  });
}
