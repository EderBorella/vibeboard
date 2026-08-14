import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../route-context.js';
import { attachedOpencodeUrl, restartOpencodeServer, takeOverOpencodeServer } from './opencode-server.js';
import { agentRefusal } from './sandbox.js';

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
    // Re-probed per request, not read from a value captured at startup. The whole point of this
    // endpoint is to answer "can this project run anything RIGHT NOW", and it used to answer
    // "could it, when the server booted" — which stayed `ok: true` after the image was deleted.
    const sandbox = await ctx.sandbox();
    return {
      ok: sandbox.ok,
      // The image, where this used to be the AppArmor profile name. Same job — name the thing that
      // is doing the confining, so the UI can show it and a person can check it.
      profile: sandbox.ok ? sandbox.image : undefined,
      reason: sandbox.ok ? undefined : sandbox.reason,
      // Reported even when the sandbox is fine, because it is the other half of whether auto-pilot
      // may start — and the UI shows a different action for each.
      backend: attached ? ('attached' as const) : ('managed' as const),
      attachedUrl: attached,
      // Computed here, once, so the UI never has to re-derive the rule and drift from the loop.
      // The same gate dispatch uses, not a second opinion about it.
      agentRefusal: agentRefusal(sandbox, attached),
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
