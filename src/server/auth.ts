import type { FastifyInstance, FastifyRequest } from 'fastify';
import { FOUNDATION_FILES } from '../core/layout.js';
import { CREDENTIAL_COOKIE, CROSS_ORIGIN, readCookie } from './cookies.js';
import type { Credential, CredentialStore, Scope } from './credentials.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Set by the preHandler below, so a handler can ask who is calling without re-deriving it.
    credential?: Credential;
  }
}

const AGENT_SCOPES = ['work', 'checkup', 'service'] as const;
// Everything that reads the board. `assist` is the chat copilot, which is driven by a person looking
// at that board, so it reads everything a run does.
const READ_SCOPES = [...AGENT_SCOPES, 'assist'] as const;
// The board verbs the copilot shares with a checkup. Not with `work`: a run is confined to its own
// card, and the copilot is not a run.
const BOARD_SCOPES = ['checkup', 'assist'] as const;

interface Rule {
  scopes: readonly Scope[];
  // Scopes additionally confined to the credential's own card, matched against the `:id` param.
  ownCard?: readonly Scope[];
  // ONE LINE, AND IT IS REQUIRED. The endpoint catalogue an agent is given is generated from this
  // table (`endpointsFor` below), so a row without a description does not compile — which is the
  // whole mechanism. It used to be prose typed out three times, in run-prompt.ts twice and in the
  // seeded VIBEBOARD.md, and adding a row here told no agent anything.
  //
  // Written as the agent needs to read it: the payload shape belongs here, not in a comment.
  describe: string;
}

// Decision 10's scope table, and the only place that answers "who may call this". A route absent
// from this map is **admin only**: a new endpoint has to opt into agent access deliberately,
// because the alternative — defaulting to reachable — grants authority by forgetting to think
// about it. Keys are `${method} ${the route's registered pattern}`, not the request path, so they
// cannot drift as ids change.
const RULES: Record<string, Rule> = {
  // Reads. An agent needs the board it is working on and the config that describes it.
  'GET /api/state': {
    scopes: READ_SCOPES,
    describe: 'the whole board — every card on all three boards, plus the project config.',
  },
  'GET /api/config': {
    scopes: READ_SCOPES,
    describe: 'the project config on its own: the configured columns and their exact slugs.',
  },
  'GET /api/archive/:board': { scopes: READ_SCOPES, describe: 'the archived cards of one board.' },
  'GET /api/cards/:board/:id/raw': {
    scopes: READ_SCOPES,
    describe: "one card's file verbatim, frontmatter included.",
  },

  // Writes a work agent needs to do its job: create a card, edit the one it was given, and link.
  // `link` is not optional — break-down must attach children to their parent, and the hierarchy is
  // derived from those links, so without it every card it creates is an orphan.
  'POST /api/cards': {
    scopes: ['work', ...BOARD_SCOPES],
    describe:
      '`{ board, columnSlug, title, description?, body?, links? }` — create a card. The id is assigned by the server; never choose one. `columnSlug` must be a column that already exists, because naming one that does not CREATES the folder and the card then vanishes from the board while keeping its id.',
  },
  'PATCH /api/cards/:board/:id': {
    scopes: ['work', ...BOARD_SCOPES],
    ownCard: ['work'],
    describe: '`{ title?, description?, tags?, group?, body? }` — edit a card.',
  },
  // Own card for `work`, like PATCH: the payload is the COMPLETE list, and links are symmetric, so
  // an unconfined PUT lets a run erase the links of any card on any board — including the
  // feature→product→engineering trace the whole hierarchy is derived from. It costs break-down
  // nothing: it links children to their parent, and the parent IS the run's own card.
  'PUT /api/cards/:board/:id/links': {
    scopes: ['work', ...BOARD_SCOPES],
    ownCard: ['work'],
    describe:
      '`{ links: [id, ...] }`, the COMPLETE list rather than an addition. Links are symmetric, so the far side is updated for you.',
  },

  // Moving is supervision, not work: a work agent must not be able to put its own card in done and
  // declare itself finished. `/place` is absent deliberately — it is the drag-and-drop verb, and
  // where in a column a card belongs is a person's judgement about a board they can see.
  'POST /api/cards/:board/:id/move': {
    scopes: ['checkup', 'service', 'assist'],
    describe: '`{ toColumnSlug }` — move a card to another column on the same board, keeping its id.',
  },
  'POST /api/cards/:board/:id/archive': {
    scopes: BOARD_SCOPES,
    describe: 'archive a card. It leaves the board and keeps its id; nothing is deleted.',
  },

  // Filing is uncapped and open to both working scopes; READING the list is not. A work agent that
  // can see every open problem in the project is a work agent scoped to one card talking itself
  // into five, which is the scope spiral decision 5 exists to prevent. The service reads them to
  // feed the checkup and files none — it dispatches work, it does not discover it.
  'POST /api/suggestions': {
    scopes: ['work', ...BOARD_SCOPES],
    describe:
      '`{ title, body? }` — file a problem you noticed but were not asked to fix, so it is not lost and not acted on unasked.',
  },
  'GET /api/suggestions': { scopes: ['checkup', 'service', 'assist'], describe: 'the open suggestions.' },
  // PATCH is absent on purpose: triage is the human's, and the checkup's in slice C through its own
  // path. A run marking its own finding `dismissed` would close the channel from the inside.

  // The ledger: what the project has spent and how many attempts each card has used. The SERVICE
  // needs it — the budget is compared between dispatches and the loop is a separate process reaching
  // the board over HTTP like anything else. `work` and `checkup` do not: an agent that can see how
  // much room is left in the budget is an agent reasoning about its own leash.
  'GET /api/accounting': {
    scopes: ['service'],
    describe: "the project's spend and each card's attempt count.",
  },

  // The diary. The SERVICE writes it — loop step 12 appends a run's summary after every dispatch, and
  // the service is a separate process reaching the board over HTTP like anything else. Both working
  // scopes are absent deliberately: a run already reports that summary, so an agent writing here would
  // be a second path to one fact. Reading is absent for every scope — admin-only, like triaging a
  // suggestion — because nothing an agent does needs the project's narrative, and an agent reading how
  // the last ten runs went is an agent reasoning about the loop that is running it.
  'POST /api/log': { scopes: ['service'], describe: "append a line to the project's diary." },

  // The toolchain. OPEN TO EVERY WORKING SCOPE, deliberately: an agent that cannot install what a
  // job needs is an agent that reports the job as impossible. It installs into the container the
  // caller is already running in, which is thrown away when VibeBoard stops — so the authority this
  // grants ends with the box. The escalation itself stays out here, where the agent cannot reach it.
  'POST /api/toolchain/install': {
    scopes: ['work', 'checkup', 'service', 'assist'],
    describe:
      '`{ packages: ["name", …] }` — install system packages into your own container, as root, on your behalf. For apt packages only; Python, Node, Rust and Go packages you can install yourself without asking, and should. Everything installed is gone when VibeBoard stops, which is deliberate — say what you need each time rather than assuming last week\'s box.',
  },

  // Dispatching. THE SERVICE ONLY, and the two working scopes are refused for the reason decision 21
  // gives: a run that can dispatch escapes every counter the loop keeps. Its iteration, its budget and
  // its attempt cap are all compared between dispatches by the loop — an agent that starts a run from
  // inside a run adds work nothing counted, and the caps stop bounding anything.
  //
  // This row is what makes the loop possible at all: without it `POST /api/runs` is admin-only, because
  // a route absent from this table grants nothing.
  'POST /api/runs': { scopes: ['service'], describe: 'dispatch a run.' },

  // And the reads that dispatch depends on. `decideTick` counts attempts from the run records and needs
  // to know which runs are in flight, so a loop that could dispatch but not read them would have to be
  // handed the ADMIN token instead — which is decisions 10 and 21 collapsing in one step. Same reasoning
  // as `GET /api/accounting`, and the working scopes are refused for the same reason: an agent that can
  // see every run in the project is an agent reasoning about its own leash.
  'GET /api/runs': { scopes: ['service'], describe: 'every run record in the project.' },
  'GET /api/runs/:board/:card': { scopes: ['service'], describe: "one card's run records." },

  // The verdict on a run, written by the loop that judged it (decision 18). Neither working scope may reach
  // it: a run that could write its own verification would be a run advancing itself on self-assessment,
  // which is decision 3's whole subject.
  'POST /api/runs/:board/:card/:run/verification': {
    scopes: ['service'],
    describe: "write a run's verdict.",
  },

  // The loop saying why it stopped. The service alone: the other three controls are admin-only because a
  // run that could restart its own project could undo the emergency stop aimed at it, and this one is
  // narrower still — it cannot claim `killed` or `stopped`, which are a person's words.
  'POST /api/autopilot/stopped': { scopes: ['service'], describe: 'record why the loop stopped.' },

  // THE ONE WRITE INTO THE CONTROL PLANE, and `assist` alone. A dedicated route rather than
  // `PUT /api/control/file` with a path allow-list: `allows()` is a pure function of the route pattern
  // and its params, and a body-dependent rule would be a new category of thing this table can express.
  //
  // Refused to every autonomous scope on purpose. These documents hold the gates a run is judged
  // against, so a run able to amend one could lower the bar until its own work passed — decision 3's
  // subject. The copilot is different only because a person is reading its answer as it types.
  'PUT /api/control/foundation/:name': {
    scopes: ['assist'],
    describe: `\`{ content }\` — write one foundation document. \`:name\` is one of ${FOUNDATION_FILES.map((f) => f.name).join(', ')} and nothing else. CODE-QUALITY.md carries the \`gates:\` list and TESTING.md the \`smoke:\` command, both in YAML frontmatter; changing either blocks auto-pilot until a person has reviewed them.`,
  },
};

// THE CATALOGUE AN AGENT IS GIVEN, generated from the table above rather than typed out beside it.
//
// It replaced three hand-written copies — two in run-prompt.ts and one in the VIBEBOARD.md that
// scaffold.ts seeds — which is why the table and the prose could disagree: adding a row granted
// authority no agent was ever told about, and every wording fix had to be made three times. The
// seeded document now names no endpoints at all and points at the credential section instead, so
// this is the only list there is.
//
// One line per row the scope may call, in the table's own order, which is the order a person grouped
// them in. The own-card confinement is rendered where the row carries it, because a catalogue that
// omitted it would describe an authority the agent does not have and every attempt would 403.
//
// AN OWN-CARD ROW IS LEFT OUT ENTIRELY when there is no card, because `allows` DENIES those rows to a
// credential minted without one — "a run minted without a card has no card to be confined to". The card-less
// caller is real: a project run (the bootstrap) is `work` scope with no card at all, and listing PATCH beside
// a promise about "your own card" would describe the one authority it is guaranteed not to have.
export function endpointsFor(scope: Scope, card?: string): string[] {
  const lines: string[] = [];
  for (const [key, rule] of Object.entries(RULES)) {
    if (!rule.scopes.includes(scope)) continue;
    const ownCard = rule.ownCard?.includes(scope) === true;
    if (ownCard && card === undefined) continue;
    const confined = ownCard ? ` You may do this to **${card}** and no other card.` : '';
    lines.push(`- \`${key}\` — ${rule.describe}${confined}`);
  }
  return lines;
}

export function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(.+)$/.exec(header ?? '');
  return match?.[1]?.trim() ?? '';
}

// THE ONE ASYMMETRY THAT MATTERS IN THIS FILE. A cookie is attached by the browser automatically,
// which is the single thing a bearer token is not — so a page on another origin can make this server
// act as the signed-in user without ever reading a secret. `SameSite=Strict` is the primary defence
// and this is the second.
//
// It may be applied ONLY to a caller that authenticated by cookie. An agent sends `Authorization` and
// no `Origin` at all: checking unconditionally would refuse every run, which is why the caller below
// passes the bearer's presence rather than this deciding for itself.
export function sameOrigin(req: {
  method: string;
  headers: { origin?: string | undefined; host?: string | undefined };
}): boolean {
  const origin = req.headers.origin;
  // An ABSENT Origin cannot be refused outright — a top-level navigation sends none, and neither does
  // a same-origin GET in Chrome — but it must not be a licence to mutate. That split is the check.
  if (!origin) return req.method === 'GET' || req.method === 'HEAD';
  try {
    // `null`, which a sandboxed iframe or a file:// page sends, is not a URL and lands in the catch.
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
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
    // TWO TRANSPORTS, one credential store. Agents send a bearer; a browser sends a cookie it never
    // reads. Bearer FIRST, so an explicitly presented credential is the one that is judged: a caller
    // that sends a bad bearer gets a 401 rather than quietly succeeding as whoever holds the cookie.
    const bearer = bearerToken(req.headers.authorization);
    const cred = credentials.verify(bearer || readCookie(req.headers.cookie, CREDENTIAL_COOKIE));
    if (!cred) return reply.code(401).send({ error: 'Unauthorized' });
    // Only for the cookie path — see `sameOrigin`. An agent sends no Origin, so an unconditional check
    // here would refuse every run in the project.
    if (!bearer && !sameOrigin(req)) return reply.code(403).send({ error: CROSS_ORIGIN });
    req.credential = cred;
    const { id } = req.params as { id?: string };
    if (!allows(cred, req.method, req.routeOptions.url ?? '', openProject(), id)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  });
}
