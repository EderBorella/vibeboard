import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { allows, bearerToken } from '../src/server/auth/auth.js';
import { type Credential, CredentialStore, type Scope } from '../src/server/auth/credentials.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { tempDir } from './helpers.js';

const ADMIN = 'admin-token';
const admin = { authorization: `Bearer ${ADMIN}` };
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

// A real app with no auth-injecting wrapper: every request here presents exactly the credential
// the test gives it, which is the whole point of this file.
// `mint` carries the project root, because a run's authority is over the project it was dispatched
// into. Handed back from here so no test can accidentally mint against a different one and pass for
// the wrong reason.
type Mint = (scope: Exclude<Scope, 'admin'>, run: string, card?: string) => Credential;

async function open(): Promise<{ app: FastifyInstance; store: CredentialStore; root: string; mint: Mint }> {
  const session = new ProjectSession();
  const store = new CredentialStore(ADMIN);
  const app = buildApp(session, { credentials: store, logger: false });
  const root = await tempDir();
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    headers: admin,
    payload: { path: root, name: 'A', mode: 'greenfield' },
  });
  // The project is supplied here, not by the caller: a run's authority is over the project it was
  // dispatched into, and a test that could pick a different one would pass for the wrong reason.
  const mint: Mint = (scope, run, card) => store.mintRun(scope, run, root, card);
  return { app, store, root, mint };
}

// Neither of these was imported by any test, which made auth.ts's own comment — "exported so the
// table can be tested directly" — false. The table is well covered through the app; the header
// parser was not covered at all.
describe('bearerToken', () => {
  it('reads the token out of a well-formed header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
    expect(bearerToken('Bearer   spaced  ')).toBe('spaced');
  });

  it('is anchored, so a token cannot be smuggled inside another scheme', () => {
    // Unanchored, `Basic Bearer <token>` authenticates — the regex matches anywhere in the string.
    expect(bearerToken('Basic Bearer abc123')).toBe('');
    expect(bearerToken('Basic abc123')).toBe('');
  });

  it('is empty for a missing or malformed header', () => {
    expect(bearerToken(undefined)).toBe('');
    expect(bearerToken('')).toBe('');
    expect(bearerToken('Bearer')).toBe('');
    expect(bearerToken('Bearer ')).toBe('');
  });
});

// The scope table, row by row, without a server in the way. auth.ts exports `allows` saying "a row
// nobody exercises is a row that does not work" — and then no test imported it. The table IS well
// covered through the app, but only where a route happens to be convenient to call; this is the
// whole grid, including the rows that say no.
describe('the scope table', () => {
  const PROJECT = '/p/A';
  const cred = (scope: Scope, card?: string): Credential => ({
    token: 't',
    scope,
    ...(scope === 'admin' ? {} : { run: 'r', project: PROJECT, card }),
  });

  it.each([
    // route,                                     method,  work,  checkup, service
    ['/api/state', 'GET', true, true, true],
    ['/api/config', 'GET', true, true, true],
    ['/api/archive/:board', 'GET', true, true, true],
    ['/api/cards/:board/:id/raw', 'GET', true, true, true],
    // The service creates ONE card in the whole lifecycle — the smoke-harness feature at the bootstrap's exit
    // (ruling 66) — because a mandatory feature that depends on an agent remembering it is one that will
    // sometimes be missing. PATCH and links stay refused: it has no card of its own to edit.
    ['/api/cards', 'POST', true, true, true],
    ['/api/cards/:board/:id', 'PATCH', true, true, false],
    ['/api/cards/:board/:id/links', 'PUT', true, true, false],
    ['/api/cards/:board/:id/move', 'POST', false, true, true],
    ['/api/cards/:board/:id/archive', 'POST', false, true, false],
    // Named here to pin that they are refused, not merely absent from the table by oversight.
    ['/api/cards/:board/:id/raw', 'PUT', false, false, false],
    ['/api/cards/:board/:id/place', 'POST', false, false, false],
    // C2's one new grant, and the row the loop cannot exist without: absent from this table,
    // `POST /api/runs` is admin-only and the service cannot dispatch at all. Both WORKING scopes stay
    // refused — decision 21 — because a run that can dispatch escapes the iteration counter, the budget
    // and the attempt cap in one move.
    ['/api/runs', 'POST', false, false, true],
    // The reads dispatch depends on: `decideTick` counts attempts from the run records and has to know
    // which runs are in flight. A loop that could dispatch but not read would have to be handed the ADMIN
    // token, which is decisions 10 and 21 collapsing in one step.
    ['/api/runs', 'GET', false, false, true],
    ['/api/runs/:board/:card', 'GET', false, false, true],
    // The verdict on a run, and the loop reporting its own ending. Service-only: a run that could write its own
    // verification would advance itself on self-assessment, and one that could stop auto-pilot could stop the
    // thing supervising it.
    ['/api/runs/:board/:card/:run/verification', 'POST', false, false, true],
    // THE TWO WAYS TO CLEAR A CARD'S SPENT ATTEMPTS, admin-only BY ABSENCE and named here so the absence
    // is asserted rather than merely true (decision 86). The attempt cap is the only thing that stops a
    // card being retried for ever, so an agent that could clear its own card's attempts would have
    // unlimited retries; the reset is worse again, because it clears a SUCCESS — including the creating
    // run that bounds a feature's checkup. test/runs-route.test.ts asks the other half — whether an agent
    // is TOLD the route exists — and these two lines are the enforcement: `allows` is what answers the
    // request, and until 2026-09-22 nothing exercised it for either route.
    ['/api/runs/:board/:card/forgive', 'POST', false, false, false],
    ['/api/runs/:board/:card/reset', 'POST', false, false, false],
    ['/api/autopilot/stopped', 'POST', false, false, true],
    ['/api/config', 'PATCH', false, false, false],
    ['/api/explorer/file', 'PUT', false, false, false],
    ['/api/project/open', 'POST', false, false, false],
    ['/api/skills/:slug', 'PUT', false, false, false],
    // Slice D's routes. The ledger is the one grant: the auto-pilot service enforces the budget between
    // dispatches and reaches the board over HTTP like anything else. An AGENT that could read it would be
    // an agent reasoning about its own leash.
    ['/api/accounting', 'GET', false, false, true],
    // The three controls, and the project-run resolve, are admin-only BY ABSENCE from the table — which
    // task 6 calls load-bearing, and load-bearing behaviour with no row is one refactor from silent.
    ['/api/autopilot/state', 'GET', false, false, false],
    ['/api/autopilot/stop', 'POST', false, false, false],
    ['/api/autopilot/kill', 'POST', false, false, false],
    ['/api/autopilot/restart', 'POST', false, false, false],
    ['/api/project-runs/:run/resolve', 'POST', false, false, false],
    ['/api/project/scaffold', 'POST', false, false, false],
    // The diary: the service writes it, nobody else, and nobody reads it but admin.
    ['/api/log', 'POST', false, false, true],
    ['/api/log', 'GET', false, false, false],
  ])('%s %s', (route, method, work, checkup, service) => {
    // `card` matches the :id row's own-card rule, so this grid measures scope and not confinement.
    expect(allows(cred('work', 'E-001'), method, route, PROJECT, 'E-001'), 'work').toBe(work);
    expect(allows(cred('checkup'), method, route, PROJECT, 'E-001'), 'checkup').toBe(checkup);
    expect(allows(cred('service'), method, route, PROJECT, 'E-001'), 'service').toBe(service);
    // Admin reaches everything, on every row.
    expect(allows(cred('admin'), method, route, PROJECT, 'E-001'), 'admin').toBe(true);
  });

  it('denies a route it has never heard of', () => {
    expect(allows(cred('service'), 'POST', '/api/something-new', PROJECT)).toBe(false);
  });

  // THE FOURTH AGENT SCOPE, which the grid above does not carry a column for. `assist` is the copilot and
  // holds board verbs `work` does not, so a row granting it would pass every line of that grid. Asserted
  // for the two attempt-clearing routes because those are the ones whose whole bound is the absence.
  it('refuses both ways of clearing a card’s attempts to the copilot as well', () => {
    for (const route of ['/api/runs/:board/:card/forgive', '/api/runs/:board/:card/reset']) {
      expect(allows(cred('assist', 'E-001'), 'POST', route, PROJECT, 'E-001'), route).toBe(false);
    }
  });

  // THE OWN-CARD ROW'S CLOSED DIRECTION, and it is named here because something else leans on it. The
  // preHandler reads `req.params.id` and nothing else, so a route whose card segment is `:card` — every
  // run route — hands `allows` no card at all and an `ownCard` row on one would deny outright rather than
  // confine. That is FAIL-CLOSED and it is an accident of two naming conventions, so nothing may be built
  // on it as a grant: the rows above are what make the reset and the forgive admin-only, not this.
  it('denies an own-card row when the request produced no card, whatever the credential holds', () => {
    expect(allows(cred('work', 'E-001'), 'PATCH', '/api/cards/:board/:id', PROJECT, undefined)).toBe(false);
    expect(allows(cred('work'), 'PATCH', '/api/cards/:board/:id', PROJECT, 'E-001')).toBe(false);
  });
});

describe('the API boundary', () => {
  it('refuses a request with no credential', async () => {
    const { app } = await open();
    const res = await app.inject({ method: 'POST', url: '/api/cards', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a token it never minted', async () => {
    const { app } = await open();
    const res = await app.inject({ method: 'GET', url: '/api/state', headers: bearer('guessed') });
    expect(res.statusCode).toBe(401);
  });

  it('refuses an expired run credential everywhere', async () => {
    const { app, store, mint } = await open();
    const cred = mint('work', 'run-1', 'E-001');
    store.expireRun('run-1');
    const res = await app.inject({ method: 'GET', url: '/api/state', headers: bearer(cred.token) });
    expect(res.statusCode).toBe(401);
  });

  it('lets the browser through to anything', async () => {
    const { app } = await open();
    expect((await app.inject({ method: 'GET', url: '/api/state', headers: admin })).statusCode).toBe(200);
  });

  it('lets a run read the board', async () => {
    const { app, mint } = await open();
    const cred = mint('work', 'run-1', 'E-001');
    const res = await app.inject({ method: 'GET', url: '/api/state', headers: bearer(cred.token) });
    expect(res.statusCode).toBe(200);
  });

  // The most dangerous endpoint in the app: a run that can dispatch runs escapes the loop's
  // iteration counter, its budget and its concurrency cap in one move.
  it('refuses a work credential on POST /api/runs', async () => {
    const { app, mint } = await open();
    const cred = mint('work', 'run-1', 'E-001');
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: bearer(cred.token),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a service credential dispatch, which is the whole loop', async () => {
    const { app, mint } = await open();
    const cred = mint('service', 'run-svc');
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: bearer(cred.token),
      payload: {},
    });
    // NOT 403 is the claim, and the only claim: a 403 would mean the loop can never dispatch. What it
    // actually hits is the sandbox pre-condition, because this file's fixture builds an app with no
    // sandbox — so asserting the NUMBER here pinned an accident of the fixture rather than any ordering.
    // Proved by adding a sandbox to `open()`: the status became 400, and this line would have failed for
    // a reason that had nothing to do with authorisation. The refusal's own words are the honest anchor.
    expect(res.statusCode).not.toBe(403);
    expect(res.json().error).toMatch(/container/i);
  });

  it('refuses a checkup credential on POST /api/runs too', async () => {
    // The supervisor has authority over CARDS, not over what runs. Dispatching from inside a checkup
    // would add work the loop never counted, same as from inside a work run.
    const { app, mint } = await open();
    const cred = mint('checkup', 'run-chk');
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: bearer(cred.token),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a run credential on PUT /raw, whatever its scope', async () => {
    const { app, mint } = await open();
    // Raw bytes bypass every validation in the mutation layer — id, column and frontmatter all.
    for (const scope of ['work', 'checkup', 'service'] as const) {
      const cred = mint(scope, `run-${scope}`, 'E-001');
      const res = await app.inject({
        method: 'PUT',
        url: '/api/cards/engineering/E-001/raw',
        headers: bearer(cred.token),
        payload: { raw: '---\nid: E-001\n---\n' },
      });
      expect(res.statusCode, scope).toBe(403);
    }
  });

  it('refuses a run credential on PATCH /api/config', async () => {
    // Config holds the columns, the caps and the routing table. An agent that can edit it can
    // rewrite the rules it is judged by.
    const { app, mint } = await open();
    const cred = mint('service', 'run-1');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      headers: bearer(cred.token),
      payload: { name: 'renamed' },
    });
    expect(res.statusCode).toBe(403);
  });

  // Every route not named in the scope table is admin-only, so a new endpoint is closed until
  // somebody opens it deliberately. Explorer writes are the widest reach in the app: any path
  // in the project, card or not.
  it('refuses a run credential on an endpoint the table never mentions', async () => {
    const { app, mint } = await open();
    const cred = mint('checkup', 'run-1');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/explorer/file',
      headers: bearer(cred.token),
      payload: { path: 'notes.md', content: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  describe('a work credential is confined to its own card', () => {
    it('may edit the card it was minted for', async () => {
      const { app, mint } = await open();
      const cred = mint('work', 'run-1', 'E-001');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/cards/engineering/E-001',
        headers: bearer(cred.token),
        payload: { title: 'Renamed by its own run' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('may not edit another', async () => {
      const { app, mint } = await open();
      const cred = mint('work', 'run-1', 'E-001');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/cards/engineering/E-002',
        headers: bearer(cred.token),
        payload: { title: 'Reaching past its own card' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('may not rewrite another card’s links', async () => {
      // The payload is the complete list and links are symmetric, so an unconfined PUT lets a run
      // erase a hierarchy it has nothing to do with — including the trace auto-pilot walks.
      const { app, mint } = await open();
      const cred = mint('work', 'run-1', 'E-001');
      const res = await app.inject({
        method: 'PUT',
        url: '/api/cards/product/P-001/links',
        headers: bearer(cred.token),
        payload: { links: [] },
      });
      expect(res.statusCode).toBe(403);
    });

    it('may still link its own card, which is all break-down needs', async () => {
      // break-down attaches children to their parent, and the parent is the card the run was
      // dispatched for. The far side is written for it, so confinement costs it nothing.
      const { app, mint } = await open();
      const cred = mint('work', 'run-1', 'E-001');
      const res = await app.inject({
        method: 'PUT',
        url: '/api/cards/engineering/E-001/links',
        headers: bearer(cred.token),
        payload: { links: ['P-001'] },
      });
      expect(res.statusCode).toBe(200);
    });

    // The switch below is off by default and is the human's choice; a run is held to the rule either
    // way. The machine reads the hierarchy off these links, and an agent has no way to mean "see also".
    it('is refused a second parent even with the project switch off', async () => {
      const { app, mint } = await open();
      // A second feature to be the second parent. Created as admin: a work run may create cards, but
      // this is fixture, not the thing under test.
      await app.inject({
        method: 'POST',
        url: '/api/cards',
        headers: admin,
        payload: { board: 'features', columnSlug: 'todo', title: 'Second feature' },
      });
      const cred = mint('work', 'run-1', 'P-001');
      const res = await app.inject({
        method: 'PUT',
        url: '/api/cards/product/P-001/links',
        headers: bearer(cred.token),
        payload: { links: ['F-001', 'F-002'] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('two parents on the features board');
    });

    // The evasion this endpoint had until 2026-08-02: links are symmetric, so writing P-002's list
    // writes the back-reference onto E-001. P-002 gains no parent, the child-side check passes, and
    // E-001 ends up with two — the rule satisfied on one card and violated on the other.
    it('cannot adopt a child that already has a parent, from the parent side', async () => {
      const { app, mint } = await open();
      // A second product card for the run to own. E-001 already links P-001 (sample cards).
      const p2 = (
        await app.inject({
          method: 'POST',
          url: '/api/cards',
          headers: admin,
          payload: { board: 'product', columnSlug: 'todo', title: 'Second product' },
        })
      ).json().id;

      const cred = mint('work', 'run-p', p2);
      const res = await app.inject({
        method: 'PUT',
        url: `/api/cards/product/${p2}/links`,
        headers: bearer(cred.token),
        payload: { links: ['E-001'] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('already has a parent on the product board');

      // And the far side was not written: a refusal that still moved the link would be worse than none.
      const state = (await app.inject({ method: 'GET', url: '/api/state', headers: admin })).json();
      const e1 = state.snapshot.boards.engineering.find((c: { id: string }) => c.id === 'E-001');
      expect(e1.links).toEqual(['P-001']);
    });

    it('is not confined when the scope is checkup', async () => {
      // The checkup is a supervisor, not a worker: editing any card is the job.
      const { app, mint } = await open();
      const cred = mint('checkup', 'run-1');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/cards/engineering/E-001',
        headers: bearer(cred.token),
        payload: { title: 'Renamed by the checkup' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // Card ids are unique within a project, never across them — every project has an E-001. Nothing
  // cancels a live run when the user opens another project, so a credential checked on the id alone
  // went on working, against the wrong project's card, for the rest of the run.
  it('refuses a credential minted against a project that is no longer the open one', async () => {
    const { app, store, root } = await open();
    const cred = store.mintRun('work', 'run-in-A', root, 'E-001');
    // Still fine while A is open.
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/cards/engineering/E-001',
          headers: bearer(cred.token),
          payload: { title: 'while A is open' },
        })
      ).statusCode,
    ).toBe(200);

    // Open a second project. The run in A is not cancelled by this.
    const other = await tempDir();
    await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      headers: admin,
      payload: { path: other, name: 'B', mode: 'greenfield' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/cards/engineering/E-001',
      headers: bearer(cred.token),
      payload: { title: 'edited across the project switch' },
    });
    expect(res.statusCode).toBe(403);
    // And project B's card is untouched.
    const state = (await app.inject({ method: 'GET', url: '/api/state', headers: admin })).json();
    const card = state.snapshot.boards.engineering.find((c: { id: string }) => c.id === 'E-001');
    expect(card.title).not.toBe('edited across the project switch');
  });

  // The five verbs an agent can reach, as a matrix. A row nobody exercises is a row that does not
  // work, and the interesting part is the gap between the two scopes: a work agent must not be able
  // to move its own card into done and declare itself finished.
  describe('the five card verbs', () => {
    const verbs = (id: string) =>
      ({
        create: {
          method: 'POST' as const,
          url: '/api/cards',
          payload: { board: 'engineering', columnSlug: 'backlog', title: 'x' },
        },
        edit: { method: 'PATCH' as const, url: `/api/cards/engineering/${id}`, payload: { title: 'x' } },
        link: { method: 'PUT' as const, url: `/api/cards/engineering/${id}/links`, payload: { links: [] } },
        move: {
          method: 'POST' as const,
          url: `/api/cards/engineering/${id}/move`,
          payload: { toColumnSlug: 'in-progress' },
        },
        archive: { method: 'POST' as const, url: `/api/cards/engineering/${id}/archive`, payload: {} },
      }) satisfies Record<string, { method: 'POST' | 'PATCH' | 'PUT'; url: string; payload: object }>;

    it('lets a work credential create, edit its own card and link — and nothing else', async () => {
      const { app, mint } = await open();
      const cred = mint('work', 'run-1', 'E-001');
      const v = verbs('E-001');
      for (const name of ['create', 'edit', 'link'] as const) {
        const res = await app.inject({ ...v[name], headers: bearer(cred.token) });
        expect(res.statusCode, name).toBe(200);
      }
      for (const name of ['move', 'archive'] as const) {
        const res = await app.inject({ ...v[name], headers: bearer(cred.token) });
        expect(res.statusCode, name).toBe(403);
      }
    });

    it('lets a checkup credential do all five', async () => {
      const { app, mint } = await open();
      const cred = mint('checkup', 'run-1');
      const v = verbs('E-001');
      for (const name of ['create', 'edit', 'link', 'move', 'archive'] as const) {
        const res = await app.inject({ ...v[name], headers: bearer(cred.token) });
        expect(res.statusCode, name).toBe(200);
      }
    });

    it('refuses a run of any scope on /place, which is the drag-and-drop verb', async () => {
      // Position is a person's judgement about a board they are looking at. An agent moves a card
      // to a column; where in that column is not a question it has any basis to answer.
      const { app, mint } = await open();
      for (const scope of ['work', 'checkup', 'service'] as const) {
        const cred = mint(scope, `run-${scope}`, 'E-001');
        const res = await app.inject({
          method: 'POST',
          url: '/api/cards/engineering/E-001/place',
          headers: bearer(cred.token),
          payload: { toColumnSlug: 'in-progress', beforeId: null },
        });
        expect(res.statusCode, scope).toBe(403);
      }
    });

    it('appends a moved card to the end of its new column', async () => {
      const { app, mint } = await open();
      const cred = mint('checkup', 'run-1');
      const res = await app.inject({
        method: 'POST',
        url: '/api/cards/engineering/E-001/move',
        headers: bearer(cred.token),
        payload: { toColumnSlug: 'in-progress' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().columnSlug).toBe('in-progress');
    });

    it('refuses a move to a column the board does not have', async () => {
      const { app, mint } = await open();
      const cred = mint('checkup', 'run-1');
      const res = await app.inject({
        method: 'POST',
        url: '/api/cards/engineering/E-001/move',
        headers: bearer(cred.token),
        payload: { toColumnSlug: 'not-a-column' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // A malformed body from an agent used to be a 500 and a stack trace — from the caller class least
  // able to interpret one, and with nothing in its instructions to suggest a 500 was even possible.
  describe('a bad request is answered, not crashed on', () => {
    it('refuses a board the project does not have', async () => {
      const { app, mint } = await open();
      const cred = mint('work', 'run-1', 'E-001');
      const res = await app.inject({
        method: 'POST',
        url: '/api/cards',
        headers: bearer(cred.token),
        payload: { board: 'eng', columnSlug: 'backlog', title: 'x' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('refuses a links payload that is not a list', async () => {
      const { app, mint } = await open();
      const cred = mint('work', 'run-1', 'E-001');
      const res = await app.inject({
        method: 'PUT',
        url: '/api/cards/engineering/E-001/links',
        headers: bearer(cred.token),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // Fastify registers HEAD alongside every GET. Keyed on the literal method, a run probing an
  // endpoint it is allowed to read got a 403 for asking the cheap way.
  it('lets a run HEAD what it may GET', async () => {
    const { app, mint } = await open();
    const cred = mint('work', 'run-1', 'E-001');
    expect(
      (await app.inject({ method: 'HEAD', url: '/api/state', headers: bearer(cred.token) })).statusCode,
    ).toBe(200);
    // And HEAD does not become a way around the table.
    expect(
      (
        await app.inject({
          method: 'HEAD',
          url: '/api/cards/engineering/E-001/raw',
          headers: bearer(cred.token),
        })
      ).statusCode,
    ).toBe(200);
  });

  // The socket carries the copilot channel, and the copilot writes files with tools that
  // auto-approve. Locking /api while leaving this open would secure nothing.
  it('refuses a websocket that presents no credential', async () => {
    const { app } = await open();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { default: WebSocket } = await import('ws');
    const address = app.addresses()[0];
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    // The handshake is refused, so the client sees an error and never an open socket. Waited on
    // with real time and a generous margin — there is a real TCP connection behind this, and a
    // faked clock would observe neither end of it.
    const outcome = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('opened'));
      ws.on('error', () => resolve('refused'));
      setTimeout(() => resolve('nothing happened'), 2000);
    });
    ws.close();
    expect(outcome).toBe('refused');
  });

  // The middle case, and the only interesting one: the two ends — no credential and the admin
  // token — both passed with the scope check reduced to a mere presence check, so nothing held the
  // socket to ADMIN. A run that can open it drives the copilot channel, whose tools write files
  // with no approval step.
  it('refuses a websocket presenting a run credential, at every scope', async () => {
    const { app, mint } = await open();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { default: WebSocket } = await import('ws');
    const address = app.addresses()[0];
    for (const scope of ['work', 'checkup', 'service'] as const) {
      const cred = mint(scope, `run-${scope}`, 'E-001');
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${cred.token}`);
      const outcome = await new Promise<string>((resolve) => {
        ws.on('open', () => resolve('opened'));
        ws.on('error', () => resolve('refused'));
        setTimeout(() => resolve('nothing happened'), 2000);
      });
      ws.close();
      expect(outcome, scope).toBe('refused');
    }
  });

  // `??` treats an empty `?token=` as a supplied value, so it shadowed a perfectly good header. A
  // browser cannot set one, but nothing else connecting here is a browser.
  it('falls back to the Authorization header when the query token is empty', async () => {
    const { app } = await open();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { default: WebSocket } = await import('ws');
    const address = app.addresses()[0];
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=`, { headers: admin });
    const outcome = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('opened'));
      ws.on('error', () => resolve('refused'));
      setTimeout(() => resolve('nothing happened'), 2000);
    });
    ws.close();
    expect(outcome).toBe('opened');
  });

  it('accepts a websocket presenting the admin token', async () => {
    const { app } = await open();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { default: WebSocket } = await import('ws');
    const address = app.addresses()[0];
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${ADMIN}`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('close', () => resolve(false));
      ws.on('error', () => resolve(false));
    });
    ws.close();
    expect(opened).toBe(true);
  });
});
