import type { FastifyInstance, FastifyRequest } from 'fastify';
import { FOUNDATION_FILES } from '../../core/layout.js';
import { CREDENTIAL_COOKIE, CROSS_ORIGIN, readCookie } from './cookies.js';
import type { Credential, CredentialStore, Scope } from './credentials.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Set by the preHandler below, so a handler can ask who is calling without re-deriving it.
    credential?: Credential;
  }
}

const AGENT_SCOPES = ['work', 'checkup', 'service'] as const;
// The chat copilot in both its forms: authorised for a conversation, or handed a stuck board by Fix board
// (decision 88). Both are driven by a person looking at the board, and `repair` holds every board verb
// `assist` does — which is why the board rows below name this pair rather than `assist` alone.
const COPILOT_SCOPES = ['assist', 'repair'] as const;
// Everything that reads the board. The copilot is driven by a person looking at that board, so it reads
// everything a run does.
const READ_SCOPES = [...AGENT_SCOPES, ...COPILOT_SCOPES] as const;
// The board verbs the copilot shares with a checkup. Not with `work`: a run is confined to its own
// card, and the copilot is not a run.
const BOARD_SCOPES = ['checkup', ...COPILOT_SCOPES] as const;

interface Rule {
  scopes: readonly Scope[];
  // Scopes additionally confined to the credential's own card, matched against the `:id` param.
  ownCard?: readonly Scope[];
  // A run a person started may do this to its own card, whatever its scope row says (decision 97).
  handOwnCard?: true;
  // ONE LINE, AND IT IS REQUIRED. The endpoint catalogue an agent is given is generated from this
  // table (`endpointsFor` below), so a row without a description does not compile — which is the
  // whole mechanism. It used to be prose typed out three times, twice in the dispatch prompt
  // (`runs/prompt/`) and once in the seeded VIBEBOARD.md, and adding a row here told no agent anything.
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
    describe:
      'the whole board and the project config. The cards are under `snapshot.boards.features`, `.product` and `.engineering`, each a list of cards with `id`, `title`, `columnSlug`, `links` and `body`.',
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
  //
  // NO `links` ON THE CREATE (ruling 65). It was advertised here and written into the new card's frontmatter
  // unaccompanied — one side of a symmetric relation, and the side nothing reads — so a break-down told it had
  // linked its children left orphans. The parent link is now the server's to assert, from the credential it is
  // already holding, which is where the column, the group and the creating run come from too. `PUT …/links`
  // stays for the run's own card: it is confined to it, and parent↔child is the only link a run can mean.
  //
  // AND `service`, which is the loop (ruling 66). It creates the smoke-harness feature at the bootstrap's exit,
  // because a mandatory feature that depends on an agent remembering is one that will sometimes be missing, and
  // each story's one task (decision 92), the one create that names its parent. Every rule this endpoint enforces for a run still applies to it — the credential
  // carries a run id, so `lifecycleRulesForCreate` runs — and the loop is already the caller that stamps
  // `setup: true` and moves cards, so this grants no authority it does not have one door along.
  //
  // AND `satisfiedBy` IS ON IT (decision 85), because the seeded `break-down` skill tells an agent to send
  // that key on the create and this list is where the same prompt says what the create takes. The two
  // disagreed: the field was absent here, so an agent reading the catalogue it was handed had no reason to
  // send it and the check would never have fired on a real project. Written here rather than in the skill
  // for the reason the whole table exists — the payload shape has one home, and three hand-written copies
  // is what this generator replaced.
  'POST /api/cards': {
    scopes: ['work', 'service', ...BOARD_SCOPES],
    describe:
      '`{ board, columnSlug, title, description?, body?, satisfiedBy? }` — create a card. The id is assigned by the server; never choose one. `columnSlug` must be a column that already exists, because naming one that does not CREATES the folder and the card then vanishes from the board while keeping its id. `satisfiedBy` names a gate command this project already declares, copied exactly, and only when that gate IS the card’s one acceptance criterion; it must be a string, and anything else is refused.',
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
  // declare itself finished. A run a person started is the exception — the person judges it, and moving its
  // own card is how a check of theirs says it passed.
  'POST /api/cards/:board/:id/move': {
    scopes: ['checkup', 'service', ...COPILOT_SCOPES],
    handOwnCard: true,
    describe: '`{ toColumnSlug }` — move a card to another column on the same board, keeping its id.',
  },
  // THE DRAG-AND-DROP VERB, and every scope but `repair` is refused it: where in a column a card belongs is a
  // person's judgement about a board they can see. `repair` is that judgement made in front of the person
  // (decision 88), and it needs this because a column's order is what the loop reads as "next" — siblings
  // ordered against their dependency is one of the ways a board sticks, and `move` can only append.
  'POST /api/cards/:board/:id/place': {
    scopes: ['repair'],
    describe:
      '`{ toColumnSlug, beforeId }` — put a card in a column in front of the card `beforeId` names, or at the end when `beforeId` is null. The loop takes a column’s cards in this order.',
  },
  'POST /api/cards/:board/:id/archive': {
    scopes: BOARD_SCOPES,
    describe: 'archive a card. It leaves the board and keeps its id; nothing is deleted.',
  },
  // THE UNDO OF THE ROW ABOVE, for `repair` alone (decision 88). Archive is the one board verb the copilot holds
  // with no way back, so a repair that archived the wrong card — or a card whose absence is what stalled the
  // story above it — would otherwise be left for the person to find in a drawer.
  'POST /api/cards/:board/:id/restore': {
    scopes: ['repair'],
    describe:
      '`{ toColumnSlug? }` — bring an archived card back to the board, at the end of the column it was archived from unless you name another (the board’s first column when that one is gone). `GET /api/archive/:board` lists them.',
  },
  // THE SERVICE ALONE, and `checkup` is refused as deliberately as `work` is (decision 44). `setup` makes
  // an absent gate set EXPECTED for a whole subtree (decision 51), and `followUp` decides which feature a
  // second wave of work hangs off — so both are authority rather than supervision, and neither is a thing
  // an agent may grant itself. Reachable by the browser regardless, because `allows` returns true for
  // admin before it consults this table.
  'POST /api/cards/:board/:id/flags': {
    scopes: ['service'],
    describe: '`{ setup?, followUp? }` — set or clear the two flags auto-pilot owns.',
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
  'GET /api/suggestions': {
    scopes: ['checkup', 'service', ...COPILOT_SCOPES],
    describe: 'the open suggestions.',
  },
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
  // be a second path to one fact. Reading is refused to every autonomous scope and to `assist` — nothing
  // they do needs the project's narrative, and an agent reading how the last ten runs went is an agent
  // reasoning about the loop that is running it.
  'POST /api/log': { scopes: ['service'], describe: "append a line to the project's diary." },
  // EXCEPT A REPAIR, which is reasoning about exactly that and is meant to be (decision 88). No loop is running
  // it — Fix board refuses while one is — and the line that found the real incident was a diary line: "E-214
  // moved to done: its story's implement-story run delivered it." The file is readable in its box already;
  // this is the same text with the entries parsed.
  'GET /api/log': {
    scopes: ['repair'],
    describe:
      "the project's diary, oldest first: what each dispatch did to which card, and why the loop stopped.",
  },

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
  //
  // `repair` reads both because a card's history IS the evidence (decision 88), and it has no leash to reason
  // about: it dispatches nothing. The records sit in its box's read-only mount already, so the row adds the
  // server's own count of attempts against the cap, not a reach.
  'GET /api/runs': { scopes: ['service', 'repair'], describe: 'every run record in the project.' },
  'GET /api/runs/:board/:card': {
    scopes: ['service', 'repair'],
    describe:
      "one card's run records, oldest first, and `account.attempts` — how many attempts each skill has used against `account.attemptCap`, counted the way the loop counts them.",
  },

  // The verdict on a run, written by the loop that judged it (decision 18). Neither working scope may reach
  // it: a run that could write its own verification would be a run advancing itself on self-assessment,
  // which is decision 3's whole subject.
  'POST /api/runs/:board/:card/:run/verification': {
    scopes: ['service'],
    describe: "write a run's verdict.",
  },

  // CLEARING SPENT ATTEMPTS, and `repair` is the only scope that may (decisions 86 and 88). Every autonomous
  // scope is refused for the reason the routes give: an agent able to clear its own card's attempts has
  // unlimited retries, and the reset also clears the creating run that bounds a checkup. `repair` is not that
  // agent. It is minted for one Fix board turn, it belongs to no card and no run, it cannot dispatch — so no
  // attempt it clears is ever its own — and it exists because a card whose failures have a cause that is gone
  // was a card only a person could free.
  //
  // `:card` AND NOT `:id`, which the preHandler reads as "no card". Harmless here, because none of these carries
  // an own-card rule, and nothing may rely on that: the bound is that `repair` is the only scope named.
  'POST /api/runs/:board/:card/forgive': {
    scopes: ['repair'],
    describe:
      "clear a card's FAILED attempts so auto-pilot will try it again. A run that succeeded still counts. Only where the cause of the failures is gone; refused while a run on the card is unfinished.",
  },
  'POST /api/runs/:board/:card/reset': {
    scopes: ['repair'],
    describe:
      'clear EVERY attempt a card has spent, successes included — so a checkup or break-down that already created work may create it again. Only when the forgive above would leave the card at its cap and the cause is gone; refused while a run on the card is unfinished.',
  },
  'POST /api/runs/project/forgive': {
    scopes: ['repair'],
    describe:
      "clear the failed attempts of the project's own runs — the derivation of an empty board, which has no card. Refused while one is unfinished.",
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

  // ONE KEY OF ONE DOCUMENT, and the only foundation write an autonomous run may make (ruling 67). The row
  // ABOVE refuses every foundation document to `work` for a reason that holds — a run able to edit `gates:`
  // can lower the bar until its own work passes — and that refusal was ALSO refusing the write the mandatory
  // smoke-harness feature exists to make, which deadlocked the feature: its card asks for a declaration in
  // TESTING.md, and nothing dispatched by the loop could ever make it.
  //
  // The distinction the two rows draw is direction, not document. `gates:` is the bar a run is judged
  // against, so a run editing it is marking its own homework. `smoke:` is a check that must FAIL when the
  // product cannot be run, and auto-pilot refuses to report a project finished until one exists that is not
  // already a gate. A run cannot weaken itself with it; the validation in core/smoke-declaration.ts is what
  // keeps it to that.
  'POST /api/foundation/smoke': {
    scopes: ['work', 'checkup', 'service', 'assist'],
    describe:
      '`{ command }` — declare the shell command that runs this project’s smoke test, written into the `smoke:` key of foundation/TESTING.md and nothing else in that file. Refused if it is empty, longer than one line, or the same command as one of the gates in foundation/CODE-QUALITY.md — a gate and a smoke command that are the same command are one check rather than two.',
  },

  // THE SETUP WIZARD, and the narrowest row in this table. `/api/wizard` itself is absent — admin-only
  // by default — because an agent that could rewrite the wizard's state could steer what it is asked
  // to do next. This grants ONE BLOCK of that state: a scan or stack run may write `suggested`, which
  // the form reads into EMPTY fields only, so a repository nobody has vetted can propose and never
  // answer. `work` because that is the scope a project run is minted with (`#start` in
  // runs/agent-runner.ts); the copilot is refused because it is not the thing that read the repo.
  // decision 77.
  'PUT /api/wizard/prefill': {
    scopes: ['work'],
    describe:
      '`{ answers?: { what?, who?, done? }, kind?, stack?, packages? }` — hand the setup assistant what you inferred about this project. Suggestions only: the person sees and can overrule every field.',
  },

  // The other half, and the scopes are swapped for the same reason: the copilot is what writes the
  // documents during setup, so it is what files their summaries. A run may not — it is not in the
  // conversation the person is reading, and the summary is the part of a document they are certain
  // to read. Capped at 600 characters by the route, which is a contract and not a hint. decision 77.
  'PUT /api/wizard/resumes/:name': {
    scopes: ['assist'],
    describe:
      '`{ summary }` — after writing a foundation document or the README during setup, store its plain-language summary (2–3 sentences, under 600 characters). `:name` is the document filename.',
  },
};

// THE CATALOGUE AN AGENT IS GIVEN, generated from the table above rather than typed out beside it.
//
// It replaced three hand-written copies — two in the dispatch prompt (`runs/prompt/`) and one in the VIBEBOARD.md that
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
export function endpointsFor(scope: Scope, card?: string, byHand = false): string[] {
  const lines: string[] = [];
  for (const [key, rule] of Object.entries(RULES)) {
    const handRow = byHand && rule.handOwnCard === true && !rule.scopes.includes(scope);
    if (!rule.scopes.includes(scope) && !handRow) continue;
    const ownCard = handRow || rule.ownCard?.includes(scope) === true;
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
  if (cred.byHand === true && rule?.handOwnCard === true && !rule.scopes.includes(cred.scope)) {
    return cardId !== undefined && cardId === cred.card;
  }
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
    // `:id` AND NOTHING ELSE, which is a naming convention rather than a rule. The run routes spell their
    // card segment `:card`, so one of those reaches `allows` with no card and an `ownCard` row on it would
    // DENY every agent rather than confine one. That direction is safe, and it is still an accident — the
    // bound on `/runs/:board/:card/reset` and `/forgive` is that their rows name `repair` and nothing else,
    // asserted row by row in test/auth.test.ts, and never this. Widening the read to `:card` would make the table
    // able to express a confinement it has never been asked for; the comment is the cheaper answer.
    const { id } = req.params as { id?: string };
    if (!allows(cred, req.method, req.routeOptions.url ?? '', openProject(), id)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  });
}
