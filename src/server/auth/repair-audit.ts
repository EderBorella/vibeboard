import type { FastifyInstance } from 'fastify';

// EVERY WRITE A REPAIR MAKES IS WRITTEN DOWN (decision 88), by the conversation that made it.
//
// `repair` is the widest authority an agent holds, and it acts on a board a person handed over because they
// could not see what was wrong. So when they later ask "why is this card here", the answer has to exist
// without the transcript: which route, which card, what it asked for, whether it was allowed, and under
// which Fix board conversation — the chat id is what finds the transcript that explains it.
//
// ONE HOOK FOR EVERY ROUTE, not a line in each handler, because the thing being recorded is the credential
// rather than the route: a row granted to `repair` tomorrow is audited by construction, and so is every
// request the scope table refused, which is the half an audit exists for. The attempt-clearing routes still
// write their own line with the count they cleared; this one says the request happened at all.

// WHAT A LINE CAN CARRY OF A BODY: every short scalar and every list of short strings — the column a card
// was sent to, the card it was placed before, the links it was given. Anything longer is somebody's prose, a
// card body or a description of any length, and its size is logged instead of it: the card's file already
// holds the words, and a log line is not where a card's text should be copied to.
const SHORT = 80;

export function bodyFacts(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  const facts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) facts[key] = fact(value);
  return facts;
}

function fact(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length <= SHORT ? value : `(${value.length} characters)`;
  const shortList = Array.isArray(value) && value.every((v) => typeof v === 'string' && v.length <= SHORT);
  return shortList ? value : '(not shown)';
}

// Registered inside the /api scope AFTER `registerAuth`, whose preHandler is what sets `req.credential` — on a
// refusal as well as a pass, which is why a 403 reaches this.
export function registerRepairAudit(api: FastifyInstance): void {
  api.addHook('onResponse', async (req, reply) => {
    const cred = req.credential;
    if (cred?.scope !== 'repair' || req.method === 'GET' || req.method === 'HEAD') return;
    const allowed = reply.statusCode < 400;
    req.log.info(
      {
        route: `${req.method} ${req.routeOptions.url ?? req.url}`,
        params: req.params,
        body: bodyFacts(req.body),
        status: reply.statusCode,
        by: 'repair',
        chat: cred.run,
      },
      allowed
        ? 'the copilot, repairing the board, changed it'
        : 'the copilot, repairing the board, was refused a change',
    );
  });
}
