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
// `EMPTY` ITSELF IS HELD BY tsc NOW, row by row, with a `satisfies` against the type its client declares —
// see the block above it. That closes the shared default and not the stories: a table a STORY writes is
// still a `RouteTable`, so its own rows are still checked by nothing until they are annotated.
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
import type {
  Accounting,
  AppSettings,
  AutopilotState,
  ControlFile,
  ControlGroup,
  DiaryEntry,
  DirListing,
  FileRead,
  getState,
  ModelOption,
  ProjectRef,
  Readiness,
  ResourceLink,
  RunList,
  SandboxState,
  SigninState,
  SkillCatalogue,
} from '../web/src/lib/api';
import type { ArchivedCard, ProjectConfig, Suggestion } from '../web/src/lib/shared';

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

// NOTHING IS BLOCKING, WHICH IS THE ONLY HONEST EMPTY FOR THIS ONE. `{ blockers: [] }` was five fields
// short, and the missing ones are not decoration: setup's own advance reads `readme.ok` and
// `foundation.missing` off this answer before it moves anybody, so every Review story's "It reads right —
// continue" threw on `state.readme.ok` and was caught as "the read failed" — a button that did nothing,
// in a workbench built to show controls doing something.
const emptyReadiness: Readiness = {
  ok: true,
  blockers: [],
  readme: { ok: true },
  // Present and missing both empty: a story that wants half a project written says so itself. What must
  // not happen here is `missing` being absent, which reads as "nothing is missing" to a `.length` and as
  // a thrown render to anything else.
  foundation: { present: [], missing: [], ok: true },
  gates: { ok: true, count: 0 },
  smoke: { ok: true },
  phases: { problems: [], count: 0 },
  unreviewedGates: [],
};

// A file the control door answers with, whole: the READ carries the listing's own fields as well as the
// text, so `{ path, content }` was missing four of them and the category is not optional.
const emptyControlFile: ControlFile & { content: string } = {
  path: '',
  name: '',
  category: 'docs',
  managed: false,
  deletable: true,
  renameable: true,
  content: '',
};

// THE SHAPES THE APP ASKS FOR ON MOUNT, as the empty-but-valid answer. Each is the shape its `api/` module
// DECLARES — so a hook that reads `.cards` or `.skills` gets an array rather than `undefined`, which is the
// difference between an empty pane and a thrown render.
//
// EVERY ROW IS NOW HELD BY tsc, and that is a change of kind rather than of degree. This block used to say
// "annotate any row a hook reaches into", which leaves the judgement of which rows those are to whoever
// writes the next one — and the judgement was wrong three times: `/api/state`, `/api/projects` and
// `/api/autopilot/readiness` were each a shape no route in this product answers, and each was found by a
// story failing in a browser rather than by a check. Every row carries a `satisfies` now, against the type
// its client declares, so a wrong shape is a build error. `satisfies` and not `as`: an assertion accepts a
// literal that is missing required fields whenever the target is assignable to it — `{} as AppSettings`
// compiles — which is exactly the mistake being guarded against.
//
// FOUR ROWS HAVE NO GET CLIENT AT ALL and are typed against what the SERVER route answers, each said on its
// own line: there is no GET for `/api/cards`, `/api/config`, `/api/explorer/tree` or
// `/api/copilot/authority` in `web/src/lib/api/`.
//
// EMPTY IS THE DEFAULT AND NOT THE INTERESTING CASE. A story that wants a populated organism spreads over
// this: `{ ...EMPTY, '/api/log': { entries } }`. Empty is the default because an empty answer is the one
// state every one of these surfaces has to render and the one no fixture ever covers.
export const EMPTY: RouteTable = {
  // Off the client's own return type rather than restated here: `getState` declares
  // `{ open: boolean; snapshot?: ProjectSnapshot }` inline, and a hand-copied version of it would be a
  // second declaration free to drift. It was `{ project: null, config: null }`, which is neither.
  '/api/state': { open: false } satisfies Awaited<ReturnType<typeof getState>>,
  // No GET client in `web/src/lib/api/`; the route answers the open project's config, and `null` is what
  // a workbench with no project open stands for.
  '/api/config': null as ProjectConfig | null,
  // THE ONLY GET UNDER THIS PREFIX IS THE RAW CARD FILE (`/api/cards/:board/:id/raw`), which answers
  // `{ raw }` — the board's cards arrive on the websocket snapshot and are never fetched. `{ cards,
  // columns }` was a shape no route here has ever answered.
  '/api/cards': { raw: '' } satisfies { raw: string },
  '/api/archive': { cards: [] } satisfies { cards: ArchivedCard[] },
  '/api/skills': { skills: [], invalid: [] } satisfies SkillCatalogue,
  // `RunList`, and it was `{ records: [] }`: `listRuns` hands the body straight back, so the Execution
  // page read `runs` off an object that has no such field.
  '/api/runs': { runs: [], active: [], queued: [] } satisfies RunList,
  '/api/accounting': emptyAccounting,
  '/api/log': { entries: [] } satisfies { entries: DiaryEntry[] },
  '/api/suggestions': { suggestions: [] } satisfies { suggestions: Suggestion[] },
  '/api/settings': { debugLog: false, serverLog: null, autopilotLog: null } satisfies AppSettings,
  // A HEALTHY MACHINE IS THE EMPTY ANSWER HERE, not a refusal: `{ enforced: false }` named no field this
  // type has, so `ok` was `undefined` and every surface that asks rendered the failure branch with no
  // sentence in it — the sandbox panel's worst state, reached by a stub rather than by a fault.
  '/api/sandbox': {
    ok: true,
    backend: 'managed',
    agentRefusal: null,
    refusalKind: null,
  } satisfies SandboxState,
  // `thisDevice` is required by `SigninState` and was missing: null is the admin-token caller, which
  // belongs to no device, and is the honest empty answer.
  '/api/signin': { pending: [], devices: [], thisDevice: null } satisfies SigninState,
  // The BODY wraps the state — `getAutopilotState` reads `.state` off it — so a bare `null` here was not
  // an empty answer but a `TypeError` the hook swallowed as a failed read.
  '/api/autopilot/state': { state: null } satisfies { state: AutopilotState | null },
  '/api/autopilot/readiness': emptyReadiness,
  // No GET client; this is what the POST answers.
  '/api/copilot/authority': { authorised: false } satisfies { authorised: boolean },
  '/api/control/files': { groups: [] } satisfies { groups: ControlGroup[] },
  // `links`, not `resources`: `getResources` reads that field and nothing else.
  '/api/control/resources': { links: [] } satisfies { links: ResourceLink[] },
  '/api/control/file': emptyControlFile,
  // No GET: `/api/explorer/tree` is a DELETE and answers `{ ok: true }`. The tree the explorer renders is
  // `/api/explorer/list`, one directory at a time.
  '/api/explorer/tree': { ok: true } satisfies { ok: true },
  '/api/explorer/list': { path: '', parent: null, entries: [] } satisfies DirListing,
  // `FileRead` is a three-way union and every arm carries `kind`, `name` and `size`; `{ path, content }`
  // is none of them.
  '/api/explorer/file': { kind: 'text', path: '', name: '', size: 0, content: '' } satisfies FileRead,
  // A BARE ARRAY AND NOT `{ models }`. `listModels` returns the body AS the list, so `{ models: [] }` made
  // `models.find` a TypeError and took the whole story down with it — found, like `/api/accounting` before
  // it, by the first story to consume the row. It was written up here as "the second row to be wrong",
  // which was a count of the ones somebody had happened to render: the sweep that followed found fourteen
  // of the 23 rows wrong. The table is type-held now, so there is no third.
  '/api/models': [] satisfies ModelOption[],
  // A bare array for `listProjects`'s reason, and `{ projects }` is why the picker's stories all rendered
  // "no projects yet" over a list written three rows above them.
  '/api/projects': [] satisfies ProjectRef[],
};
