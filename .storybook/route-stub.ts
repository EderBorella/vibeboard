// A ROUTE-KEYED `fetch`, SO A HOOK-DRIVEN ORGANISM CAN BE RENDERED ON ITS OWN.
//
// WHY THIS EXISTS AT ALL, and it is a correction rather than an addition. The plan for the organism
// stories said to use "the fixture data the browser harness already builds in
// `visual/support/fixtures.ts`". **That file builds no app data.** It is the Playwright theme, baseline
// and credential module; the data the harness renders is a REAL PROJECT scaffolded on disk by
// `visual/run.mjs` through the product's own writers, against a live server. None of that is reachable
// from a Storybook iframe, and importing that module would give a story three Playwright fixtures and no
// cards.
//
// SO THERE ARE TWO HONEST ROUTES AND THIS IS THE SECOND. Three organisms take everything they render as
// PROPS — `Organisms/Board tile`, `Organisms/Top bar`, `Organisms/Card skills` — and those have typed
// literals checked by the compiler against `web/src/lib/shared.ts`, which is stricter than any fixture
// builder. The other nine fetch on mount through `web/src/lib/api/`, and a hook cannot be given props.
// The one thing they all have in common is `request()` in `lib/api/http.ts` — the single chokepoint every
// feature module calls and nothing bypasses — so stubbing `window.fetch` under it reaches all nine
// through the code they actually run, rather than around it.
//
// KEYED ON THE PATH AND MATCHED LONGEST-PREFIX-FIRST, because the routes nest: `/api/runs` and
// `/api/runs/features/C-042` are different answers and the second must not be served by the first. The
// query string is stripped before matching and handed to the handler, since four routes carry their whole
// argument in it (`?path=`, `?backend=`, `?id=`).
//
// AN UNKEYED ROUTE IS A LOUD 501 AND NOT AN EMPTY OBJECT. A stub that answers everything with `{}` makes
// a broken story look like an empty one, which is the failure this whole workbench exists to stop being
// invisible; and `ApiError` carries the status, so a 501 surfaces as the organism's own error state with
// the path in it.
//
// NOT INSTALLED GLOBALLY. `preview.tsx` loads the app's stylesheet list and nothing else; a story opts in
// through `withRoutes`, so the three prop-driven organisms above keep running against the real (absent)
// network and would fail loudly if one of them ever started fetching.

export type StubHandler = (req: { path: string; query: URLSearchParams; init: RequestInit }) => unknown;
export type RouteTable = Record<string, StubHandler | unknown>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Longest key first, so `/api/runs/features/C-042` never falls through to `/api/runs`.
const match = (table: RouteTable, path: string): string | undefined =>
  Object.keys(table)
    .filter((key) => path === key || path.startsWith(`${key}/`) || path.startsWith(`${key}?`))
    .sort((a, b) => b.length - a.length)[0];

// Replaces `globalThis.fetch` for as long as the returned function is not called. Returns the restorer
// rather than registering a global teardown, so a story that installs one is the only thing that can
// remove it — a decorator's cleanup and a module-level `afterEach` disagreeing about whose stub is live
// is how a shared stub ends up serving another story's data.
export function installRoutes(table: RouteTable): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'http://storybook.local');
    const key = match(table, url.pathname);
    if (key === undefined) {
      return json({ error: `no stub for ${url.pathname} — add it to the story's routes` }, 501);
    }
    const answer = table[key];
    const body =
      typeof answer === 'function'
        ? (answer as StubHandler)({ path: url.pathname, query: url.searchParams, init })
        : answer;
    return json(body);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

// THE SHAPES THE APP ASKS FOR ON MOUNT, as the empty-but-valid answer. Every one of these is the shape
// its `api/` module's return type declares, so a hook that reads `.cards` or `.skills` gets an array
// rather than `undefined` — which is the difference between an empty pane and a thrown render.
//
// EMPTY IS THE DEFAULT AND NOT THE INTERESTING CASE. A story that wants a populated organism spreads over
// this: `{ ...EMPTY, '/api/cards': { cards: [card] } }`. Empty is the default because an empty answer is
// the one state every one of these surfaces has to render and the one no fixture ever covers.
export const EMPTY: RouteTable = {
  '/api/state': { project: null, config: null },
  '/api/config': null,
  '/api/cards': { cards: [], columns: [] },
  '/api/archive': { cards: [] },
  '/api/skills': { skills: [], invalid: [] },
  '/api/runs': { records: [] },
  '/api/accounting': { runs: 0, cost: 0, tokens: 0 },
  '/api/log': { entries: [] },
  '/api/suggestions': { suggestions: [] },
  '/api/settings': {},
  '/api/sandbox': { enforced: false },
  '/api/signin': { pending: [], devices: [] },
  '/api/autopilot/state': null,
  '/api/autopilot/readiness': { blockers: [] },
  '/api/copilot/authority': { authority: null },
  '/api/control/files': { groups: [] },
  '/api/control/resources': { resources: [] },
  '/api/control/file': { path: '', content: '' },
  '/api/explorer/tree': { entries: [] },
  '/api/explorer/list': { entries: [], truncated: false },
  '/api/explorer/file': { path: '', content: '' },
  '/api/models': { models: [] },
  '/api/projects': { projects: [] },
};
