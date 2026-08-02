import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Credential, CredentialStore, Scope } from './credentials.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Set by the preHandler below, so a handler can ask who is calling without re-deriving it.
    credential?: Credential;
  }
}

const AGENT_SCOPES = ['work', 'checkup', 'service'] as const;

interface Rule {
  scopes: readonly Scope[];
  // Scopes additionally confined to the credential's own card, matched against the `:id` param.
  ownCard?: readonly Scope[];
}

// Decision 10's scope table, and the only place that answers "who may call this". A route absent
// from this map is **admin only**: a new endpoint has to opt into agent access deliberately,
// because the alternative — defaulting to reachable — grants authority by forgetting to think
// about it. Keys are `${method} ${the route's registered pattern}`, not the request path, so they
// cannot drift as ids change.
const RULES: Record<string, Rule> = {
  // Reads. An agent needs the board it is working on and the config that describes it.
  'GET /api/state': { scopes: AGENT_SCOPES },
  'GET /api/config': { scopes: AGENT_SCOPES },
  'GET /api/archive/:board': { scopes: AGENT_SCOPES },
  'GET /api/cards/:board/:id/raw': { scopes: AGENT_SCOPES },

  // Writes a work agent needs to do its job: create a card, edit the one it was given, and link.
  // `link` is not optional — break-down must attach children to their parent, and the hierarchy is
  // derived from those links, so without it every card it creates is an orphan.
  'POST /api/cards': { scopes: ['work', 'checkup'] },
  'PATCH /api/cards/:board/:id': { scopes: ['work', 'checkup'], ownCard: ['work'] },
  'PUT /api/cards/:board/:id/links': { scopes: ['work', 'checkup'] },

  // Moving is supervision, not work: a work agent must not be able to put its own card in done and
  // declare itself finished. `/place` is absent deliberately — it is the drag-and-drop verb, and
  // where in a column a card belongs is a person's judgement about a board they can see.
  'POST /api/cards/:board/:id/move': { scopes: ['checkup', 'service'] },
  'POST /api/cards/:board/:id/archive': { scopes: ['checkup'] },
};

export function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(.+)$/.exec(header ?? '');
  return match?.[1]?.trim() ?? '';
}

// Whether this credential may make this request. Exported so the table can be tested directly:
// a row nobody exercises is a row that does not work.
export function allows(
  cred: Credential,
  method: string,
  routeUrl: string,
  openProject: string | undefined,
  cardId?: string,
): boolean {
  if (cred.scope === 'admin') return true;
  // Fastify auto-registers HEAD for every GET, and it is the same read with the body dropped.
  // Keyed literally, a run probing an endpoint it may read got a 403 for asking the cheap way.
  const verb = method === 'HEAD' ? 'GET' : method;
  // A run's authority is over the project it was dispatched into, and the open project can change
  // under it — nothing cancels a run when the user opens another one. Card ids are unique within a
  // project, never across them, so without this a `work` credential for run-in-A/E-001 went on
  // editing project B's E-001 for the rest of the run.
  if (cred.project !== openProject) return false;
  const rule = RULES[`${verb} ${routeUrl}`];
  if (!rule?.scopes.includes(cred.scope)) return false;
  if (!rule.ownCard?.includes(cred.scope)) return true;
  // An own-card rule with no card on the credential denies rather than waves through: a run
  // minted without one has no card to be confined to.
  return cardId !== undefined && cardId === cred.card;
}

// Registered INSIDE the /api scope, so Fastify's encapsulation keeps it off the static assets and
// off /ws — both of which have their own story (the shell carries no secret; the socket checks the
// token itself, in ws.ts).
export function registerAuth(
  api: FastifyInstance,
  credentials: CredentialStore,
  // A function, not a value: the open project changes while the server runs, and the check has to
  // ask what is open NOW rather than what was open when the hook was registered.
  openProject: () => string | undefined,
): void {
  api.addHook('preHandler', async (req: FastifyRequest, reply) => {
    const cred = credentials.verify(bearerToken(req.headers.authorization));
    if (!cred) return reply.code(401).send({ error: 'Unauthorized' });
    req.credential = cred;
    const { id } = req.params as { id?: string };
    if (!allows(cred, req.method, req.routeOptions.url ?? '', openProject(), id)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  });
}
