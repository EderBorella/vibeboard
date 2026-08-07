import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AutopilotStateName } from '../../core/autopilot-state.js';
import type { AppCtx } from '../route-context.js';
import { signinClosed } from '../signin.js';

// Signing a browser in. TWO SURFACES, and the split is the whole design:
//
//   /auth/*        on the ROOT app, unauthenticated. A browser with no credential cannot send one.
//   /api/signin/*  inside /api, admin-only BY ABSENCE from auth.ts's scope table — which is what
//                  that default is for, and why it is worth not making an exception to it.
//
// The unauthenticated routes are deliberately NOT under /api. Putting them there would mean an
// exception inside `registerAuth`'s preHandler, and that hook having no exceptions is exactly what
// makes "a route absent from the scope table is admin-only" mean anything. After this there are two
// unauthenticated surfaces on this server, adjacent and commented in app.ts: the static shell, which
// carries no secret, and this, which is open only by being first or by being approved.

const NO_ONE_TO_ASK =
  'No browser is signed in to this board yet, so reload the page — this one can sign itself in.';
const ALREADY_CLAIMED = 'A browser has already signed in to this board, so this one needs approving.';
const TOO_MANY = 'Too many browsers are waiting to be approved. Deal with those first, or try again shortly.';
const TOO_OFTEN = 'Sign-in was asked for too recently. Try again in a moment.';

// What "agents are running" means, asked of the two places that know. `current()` reads the state file
// rather than the mirror: this decides whether to open an unauthenticated door, so it asks the
// authority and not a cache that is allowed to lag.
async function activity(ctx: AppCtx): Promise<{ runs: number; autopilot: AutopilotStateName }> {
  const state = await ctx.autopilot.current();
  // Queued counts as running. A run waiting for a slot is a dispatch already decided, and it will
  // start on its own with nobody watching.
  return { runs: ctx.runner.activeIds.length + ctx.runner.queuedIds.length, autopilot: state.state };
}

const agentOf = (req: FastifyRequest): string | undefined => req.headers['user-agent'];

// Registered on the root app, beside /ws.
export function registerAuthRoutes(root: FastifyInstance, ctx: AppCtx): void {
  // BEING FIRST is the authority here, and it is available exactly once: before any browser has
  // signed in, no agent can exist, because dispatching one requires a credential nobody holds.
  //
  // The residual risk is stated rather than hidden: on VIBEBOARD_HOST=0.0.0.0 "first" means whoever
  // reaches the port first after a fresh install or a Sign-everything-out. In practice that is the
  // user, seconds after starting the server. It is narrow and it happens once — not closed.
  root.post('/auth/claim', async (req, reply) => {
    const closed = signinClosed(await activity(ctx));
    if (closed) return reply.code(409).send({ error: closed });
    const claimed = await ctx.devices.claim(agentOf(req), req.ip);
    if (claimed === 'closed') return reply.code(409).send({ error: ALREADY_CLAIMED });
    // At WARN, because this is the one moment a credential is handed to an unauthenticated caller and
    // it should be visible in the log without anyone raising the level to find it. The token is not
    // logged; the device id is not a secret.
    ctx.log.warn(
      { device: claimed.id, address: req.ip },
      'a browser signed itself in: no device had ever signed in to this board',
    );
    return { token: claimed.token };
  });

  // BEING APPROVED is the other authority. The label and address come from the request and are shown
  // to the person deciding — as a label, never as a check: every header a browser sends is
  // reproducible with one curl flag by a process on the same machine.
  root.post('/auth/request', async (req, reply) => {
    const closed = signinClosed(await activity(ctx));
    if (closed) return reply.code(409).send({ error: closed });
    // Nobody to ask. Answered rather than left to time out, because the browser's next move is to
    // claim instead, and a two-minute wait for an approval that can never come is not a wait.
    if (ctx.devices.empty) return reply.code(409).send({ error: NO_ONE_TO_ASK });
    const opened = ctx.signin.open(agentOf(req), req.ip);
    if (opened === 'too-many') return reply.code(429).send({ error: TOO_MANY });
    if (opened === 'rate-limited') return reply.code(429).send({ error: TOO_OFTEN });
    ctx.log.info({ address: req.ip }, 'a browser asked to be signed in');
    return { id: opened.id };
  });

  // Polled by the waiting browser. 200 for every answer including a refusal: this is the state of a
  // request, and "you were refused" is an answer, not a failure of the call.
  root.get('/auth/request/:id', async (req) => {
    const { id } = req.params as { id: string };
    return ctx.signin.collect(id);
  });
}

// Inside /api. Admin-only because auth.ts's RULES does not name these, which is the point of that
// default — there is no table change in this feature.
export function registerSigninRoutes(api: FastifyInstance, ctx: AppCtx): void {
  api.get('/signin', async (req) => ({
    devices: ctx.devices.list(),
    // Which row is "this browser", so the panel can label it and refuse to offer Revoke on itself —
    // a self-revoke is Sign everything out with an extra step and a confusing name.
    thisDevice: req.credential?.device ?? null,
    pending: ctx.signin.list(),
  }));

  api.post('/signin/approve/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await ctx.signin.approve(id);
    if (result === 'unknown') {
      return reply.code(404).send({ error: 'That sign-in request has expired or was already dealt with.' });
    }
    ctx.log.warn({ by: req.credential?.device ?? 'the admin token' }, 'a browser was approved to sign in');
    return { ok: true };
  });

  api.post('/signin/refuse/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.signin.refuse(id)) {
      return reply.code(404).send({ error: 'That sign-in request has expired or was already dealt with.' });
    }
    return { ok: true };
  });

  api.delete('/signin/devices/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ctx.devices.revoke(id))) return reply.code(404).send({ error: 'No such device.' });
    // The socket goes with the credential. A revoked device whose socket keeps streaming the board is
    // a revocation that only looks like one — and that socket carries the copilot channel, whose tools
    // write files.
    ctx.closeDevice(id);
    ctx.log.warn({ device: id }, 'a device was revoked');
    return { ok: true };
  });

  // Sign everything out. Also the answer to "how do I regenerate?", because an empty store re-opens
  // the silent first claim — no restart, no command, and the next page load is a first visit again.
  api.post('/signin/clear', async () => {
    await ctx.devices.clear();
    ctx.log.warn({ closed: ctx.closeDevice(null) }, 'every device was signed out');
    return { ok: true };
  });
}
