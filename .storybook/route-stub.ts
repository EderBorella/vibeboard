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
// SO THERE ARE TWO HONEST ROUTES AND BOTH ARE IN USE. Some components take everything they render as PROPS
// — `Organisms/Board tile`, `Organisms/Top bar`, `Organisms/Card skills`, `Pages/Boards`, `Pages/SignIn`,
// `Organisms/Utility dock`, `Organisms/Control file list`, `Organisms/File tree` — and those get typed
// literals checked by the compiler against `web/src/lib/shared.ts`, which is stricter than any fixture
// builder. The rest fetch on mount through `web/src/lib/api/`, and a hook cannot be given props. The one
// thing those all have in common is `request()` in `lib/api/http.ts` — the single chokepoint every feature
// module calls and nothing bypasses — so stubbing `globalThis.fetch` under it reaches them through the code
// they actually run, rather than around it.
//
// AND A ROUTE TABLE IS NOT TYPE-CHECKED. `RouteTable`'s value is `object`, so a literal written into one is
// checked by nothing: three invented `DiaryKind`s, a `SigninDevice` with two fields it does not have, and an
// `/api/accounting` row shaped nothing like `Accounting` all passed four typechecks, and the last of them
// threw on render in all three themes. ANNOTATE the literal — `const x: DiaryEntry[] = …` — wherever a hook
// reaches into the answer. Every story here does.
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
// NOT INSTALLED GLOBALLY, AND THE OPT-IN IS SCOPED TO THE STORY'S LIFETIME. `preview.tsx` loads the app's
// stylesheet list and nothing else; a story opts in through `withRoutes`.
//
// The first version of this file claimed that meant "the prop-driven organisms keep running against the
// real (absent) network and would fail loudly if one of them ever started fetching". That was FALSE as
// implemented, and measured false in a browser: the decorator installed the stub and never called the
// returned restorer, so switching from `Organisms/Suggestions pane` to `Organisms/Top bar` through
// Storybook's own channel (no iframe reload — how the workbench is actually used) left the stub in place
// and `fetch('/api/cards')` answered `200 {"cards":[],"columns":[]}`. A stub that outlives its story is
// the shared-fixture failure this file was written to avoid, one level up.
//
// So the install is now owned by `withRoutes` and torn down on unmount. It is installed during RENDER and
// not from an effect, because a hook-driven child fetches on mount and a parent's effect runs AFTER its
// children's — an effect-time install is exactly one render too late for the thing it exists to catch.

import { createElement, type FunctionComponent, type ReactElement, useEffect, useState } from 'react';
import type { Accounting, ModelOption } from '../web/src/lib/api';

export type StubHandler = (req: { path: string; query: URLSearchParams; init: RequestInit }) => unknown;
// NOT `StubHandler | unknown`: that union REDUCES to `unknown`, which silently deletes the contextual type
// for every handler a story writes (`({ init }) => …` became an implicit `any`, TS7031, and the build died).
export type RouteTable = Record<string, StubHandler | object | null>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Longest key first, so `/api/runs/features/C-042` never falls through to `/api/runs`. Matched against
// `url.pathname`, which never contains a `?` — so there is deliberately no `${key}?` clause here; the one
// that used to be is dead code that reads like a case somebody tested.
const match = (table: RouteTable, path: string): string | undefined =>
  Object.keys(table)
    .filter((key) => path === key || path.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0];

// Replaces `globalThis.fetch` and returns its own undo. THE RESTORER IS IDENTITY-GUARDED, because the
// naive version does not compose: two installs and then `r1(); r2();` left `globalThis.fetch` as r1's stub
// FOREVER — measured, `after the SECOND restorer, fetch === original: false`. Restoring a stub you did not
// install is worse than leaking, so a restorer whose stub is no longer live does nothing.
export function installRoutes(table: RouteTable): () => void {
  const real = globalThis.fetch;
  const mine = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
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
  globalThis.fetch = mine;
  return () => {
    if (globalThis.fetch === mine) globalThis.fetch = real;
  };
}

// THE DECORATOR EVERY HOOK-DRIVEN STORY USES. `useState`'s initialiser runs during the first render, which
// is before the child mounts and therefore before it fetches; the effect exists only to hand React the
// restorer as a cleanup, so leaving the story removes the stub.
function RouteStub({ table, story }: { table: RouteTable; story: FunctionComponent }): ReactElement {
  const [restore] = useState(() => installRoutes(table));
  useEffect(() => restore, [restore]);
  return createElement(story);
}

export const withRoutes =
  (table: RouteTable) =>
  (Story: FunctionComponent): ReactElement =>
    createElement(RouteStub, { table, story: Story });

// A TYPED ROW, for the shapes a hook DESTRUCTURES rather than merely reads. `RouteTable`'s value type is
// `object`, so an entry is checked by nothing — and `/api/accounting` was written as
// `{ runs, cost, tokens }` when `Accounting` is `{ project: Spend; cards: []; attemptCap: number }`. It
// threw on render (`Cannot read properties of undefined (reading 'runs')`) the first time a story
// consumed it, which is the entire argument for having a consumer: this table shipped for a phase saying
// "every one of these is the shape its module declares", and one of them was not.
const emptyAccounting: Accounting = {
  project: { runs: 0, withCost: 0, withoutCost: 0 },
  cards: [],
  attemptCap: 3,
};

// THE SHAPES THE APP ASKS FOR ON MOUNT, as the empty-but-valid answer. Each is meant to be the shape its
// `api/` module's return type declares, so a hook that reads `.cards` or `.skills` gets an array rather
// than `undefined` — which is the difference between an empty pane and a thrown render. ANNOTATE ANY ROW A
// HOOK REACHES INTO, on `emptyAccounting`'s precedent; an un-annotated literal here is unchecked.
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
  '/api/accounting': emptyAccounting,
  '/api/log': { entries: [] },
  '/api/suggestions': { suggestions: [] },
  '/api/settings': {},
  '/api/sandbox': { enforced: false },
  // `thisDevice` is required by `SigninState` and was missing: null is the admin-token caller, which
  // belongs to no device, and is the honest empty answer.
  '/api/signin': { pending: [], devices: [], thisDevice: null },
  '/api/autopilot/state': null,
  '/api/autopilot/readiness': { blockers: [] },
  '/api/copilot/authority': { authority: null },
  '/api/control/files': { groups: [] },
  '/api/control/resources': { resources: [] },
  '/api/control/file': { path: '', content: '' },
  '/api/explorer/tree': { entries: [] },
  '/api/explorer/list': { entries: [], truncated: false },
  '/api/explorer/file': { path: '', content: '' },
  // A BARE ARRAY AND NOT `{ models }`, and it was the second row to be the wrong shape — the one this
  // file's own warning was written about, found the same way: by the first story to consume it.
  // `listModels` returns the body AS the list, so `{ models: [] }` made `models.find` a TypeError and
  // took the whole story down with it. Annotated for `emptyAccounting`'s reason: a `RouteTable` value is
  // `object`, so nothing checked the old one.
  '/api/models': [] as ModelOption[],
  '/api/projects': { projects: [] },
};
