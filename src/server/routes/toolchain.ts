import type { FastifyInstance } from 'fastify';
import { DEFAULT_BACKEND } from '../../core/backends.js';
import type { BoxBackend } from '../containers.js';
import { isPackageName } from '../containers.js';
import type { Credential } from '../credentials.js';
import type { AppCtx } from '../route-context.js';
import { readRun } from '../run-store.js';

// Installing a system package into the box the caller is running in.
//
// WHY THIS IS AN ENDPOINT AND NOT A COMMAND THE AGENT RUNS. Installing needs root; an agent must
// never hold it. The image ships no `sudo`, so this is not a route the agent is blocked from — it is
// one that does not exist for it. VibeBoard performs the escalation from outside, with
// `docker exec -u 0:0`, exactly as it holds every other capability an agent lacks: same principle as
// the board endpoints, where the API's power is that it is a separate process holding a privilege the
// caller does not have.
//
// The blast radius, stated: an agent that is talked into asking for something silly by a poisoned
// README gets a package installed into a container that is thrown away when VibeBoard stops.
//
// WHAT THE PRIVILEGED STEP MUST NEVER DO is write into the project. Root here is root on the host's
// bind mount, so a file it created would land root-owned in the user's own project and need `sudo` to
// remove. The helper only ever installs into the container's own filesystem; that is a rule on our
// side, asserted by test/box-integration.test.ts, not a hope about the agent's behaviour.

// A cap, because the failure this prevents is an agent pasting a dependency list. Twenty is far past
// anything a real setup needs and far short of "install the distribution".
const MAX_PACKAGES = 20;

// Why this request cannot be served, or null. Pure and separate from the handler: it is the only
// part with real branching, and it is the part worth reading on its own.
//
// Validated HERE as well as in the manager. Not redundant — this one produces the message the AGENT
// reads and can act on, while the manager's is the last line of defence for any other caller it
// might grow.
function rejectRequest(packages: unknown): string | null {
  if (!Array.isArray(packages) || packages.length === 0) {
    return 'Send `{ packages: ["name", …] }` with at least one name.';
  }
  if (packages.length > MAX_PACKAGES) {
    return `That is ${packages.length} packages; ${MAX_PACKAGES} is the most in one call.`;
  }
  const bad = packages.filter((p) => typeof p !== 'string' || !isPackageName(p));
  if (bad.length > 0) {
    return `Not package names: ${bad.map(String).join(', ')}. Lowercase letters, digits, +, - and . only.`;
  }
  return null;
}

export async function registerToolchainRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.post('/toolchain/install', async (req, reply) => {
    const { packages } = (req.body ?? {}) as { packages?: unknown };
    const rejection = rejectRequest(packages);
    if (rejection) return reply.code(400).send({ error: rejection });

    const root = ctx.session.root;
    if (!root) return reply.code(409).send({ error: 'No project is open.' });
    if (!ctx.boxes) {
      return reply
        .code(503)
        .send({ error: 'Agents are not running in containers, so there is nothing to install into.' });
    }

    // The caller's OWN box, derived from its credential rather than from the request body. Not for
    // isolation — installing into the wrong box leaks nothing, since what separates the two boxes is
    // which credential is mounted — but because installing into a container the caller is not running
    // in silently does nothing, and the agent would then report a tool as missing that it had just
    // been told was installed.
    const backend = await callerBackend(ctx, root, req.credential);
    const box = await ctx.boxes.ensure(root, backend);
    const res = await ctx.boxes.install(box.name, packages as string[]);

    if (res.code !== 0) {
      // apt's own last line, which names the package it could not find. A generic failure here sends
      // the agent looking for a VibeBoard problem instead of a typo.
      const detail = (res.stderr || res.stdout).trim().split('\n').filter(Boolean).slice(-3).join(' ');
      req.log.warn({ packages, code: res.code, detail }, 'a toolchain install failed');
      return reply.code(422).send({ error: `Could not install: ${detail || `apt exited ${res.code}`}` });
    }

    req.log.info({ packages, box: box.name }, 'installed packages into an agent box');
    return { ok: true, installed: packages };
  });
}

// Which backend the caller is running on. A run records its own; the copilot uses the project's
// configured one. Falls back rather than failing at every step: getting this wrong costs a wasted
// install into a box the caller is not in, and refusing the request over it would be the worse answer.
async function callerBackend(ctx: AppCtx, root: string, cred: Credential | undefined): Promise<BoxBackend> {
  if (cred?.run && cred.board && cred.card) {
    const record = await readRun(root, cred.board, cred.card, cred.run);
    if (record?.backend) return record.backend as BoxBackend;
  }
  return (ctx.session.config?.copilot?.backend ?? DEFAULT_BACKEND) as BoxBackend;
}
