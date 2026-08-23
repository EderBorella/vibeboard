// THE DATA THE PAGE STORIES RENDER, AS TYPED LITERALS.
//
// WHY IT IS HERE AND NOT IN `web/src/`. `tools/lib/source.mjs` excludes `*.stories.tsx` from every gate
// corpus, on the rule that a story is not application code and a class kept alive only by a story is
// exactly the dead class `check:class-budget` exists to find. A `fixtures.ts` under `web/src/` would NOT
// be excluded — it is not a story file — so it would count as a reader and as a definition site. Outside
// `web/src/` it is neither, and `biome.jsonc` and `tsconfig.test.json` now read `.storybook/**` so it is
// not unread code either.
//
// AND NOT FROM `visual/support/fixtures.ts`, which the plan named. That file builds no app data: it is the
// Playwright theme, baseline and credential module, and the data the browser harness renders is a real
// project scaffolded on disk by `visual/run.mjs` through the product's own writers. None of that is
// reachable from a Storybook iframe. Typed literals checked by the compiler against `web/src/lib/shared.ts`
// are stricter than any fixture builder, which is the honest half of what the plan was reaching for.

import type { RunRecord } from '../web/src/lib/api';
import type { Card, ProjectConfig, ProjectSnapshot } from '../web/src/lib/shared';

export const config: ProjectConfig = {
  name: 'demo',
  boards: {
    features: { columns: ['Backlog', 'In progress', 'Review', 'Done'] },
    product: { columns: ['Backlog', 'Shaping', 'Ready', 'In progress', 'Done'] },
    engineering: { columns: ['Backlog', 'Todo', 'In progress', 'Review', 'Done'] },
  },
  miniatureChars: 40,
  idPadding: 3,
  keepChats: 20,
  contextBudget: 200_000,
  maxConcurrentRuns: 3,
  copilot: { backend: 'claude-code', backends: {} },
};

const card = (over: Partial<Card> & Pick<Card, 'id' | 'title' | 'board' | 'columnSlug'>): Card => ({
  order: 0,
  tags: [],
  links: [],
  created: '2026-08-14',
  body: '',
  filePath: `/demo/.vibeboard/${over.board}/${over.id}.md`,
  ...over,
});

// A PROJECT WITH WORK IN IT, because an empty board is the state every other story already shows and the
// one the harness's own surfaces cover. Three boards with different column counts on purpose: the shared
// track count is derived from the widest, and a board with fewer columns has to end early rather than
// stretch — the 79px step this was measured at is what `BoardsView`'s comment is about.
export const snapshot: ProjectSnapshot = {
  root: '/demo',
  name: 'demo',
  config,
  boards: {
    features: [
      card({
        id: 'F-001',
        title: 'Sign-in without a shared token',
        board: 'features',
        columnSlug: 'in-progress',
        tags: ['auth'],
      }),
      card({
        id: 'F-002',
        title: 'Archive a whole column at once',
        board: 'features',
        columnSlug: 'backlog',
      }),
    ],
    product: [
      card({
        id: 'P-004',
        title: 'What a run costs, on the run row',
        board: 'product',
        columnSlug: 'ready',
        tags: ['cost', 'runs'],
      }),
    ],
    engineering: [
      card({
        id: 'E-011',
        title: 'The archive drawer loads every card on open',
        description: 'It reads the whole archive folder to render twenty rows.',
        board: 'engineering',
        columnSlug: 'todo',
        tags: ['perf'],
        links: ['F-001'],
      }),
      card({
        id: 'E-012',
        title: 'Two settings panels disagree about "enforced"',
        board: 'engineering',
        columnSlug: 'review',
      }),
      card({
        id: 'E-013',
        title: 'Cancel leaves the run row spinning',
        board: 'engineering',
        columnSlug: 'done',
      }),
    ],
  },
  archivedCounts: { features: 0, product: 2, engineering: 7 },
  openSuggestions: { 'E-011': 1 },
  carryingAProblem: { 'F-001': ['E-012'] },
};

export const cards: Card[] = [
  ...snapshot.boards.features,
  ...snapshot.boards.product,
  ...snapshot.boards.engineering,
];

const run = (over: Partial<RunRecord> & Pick<RunRecord, 'run' | 'status'>): RunRecord => ({
  skill: 'implement',
  started: '2026-08-23T09:12:00.000Z',
  backend: 'claude-code',
  model: 'sonnet',
  effort: 'medium',
  mode: 'write',
  report: '',
  ...over,
});

// ONE RUN OF EACH STATUS THE THREE COLUMNS SORT BY, because a run list with only successes in it renders
// the column that matters least. `attention` and `interrupted` are what put a row under "Requires
// attention" rather than "Done", which is the one grouping decision this page makes.
export const runs: RunRecord[] = [
  run({ run: 'r-2026-08-23-0912', status: 'running', card: 'E-011', board: 'engineering' }),
  run({
    run: 'r-2026-08-23-0844',
    status: 'attention',
    outcome: 'attention',
    card: 'E-012',
    board: 'engineering',
    finished: '2026-08-23T08:51:00.000Z',
    summary: 'The two panels read different endpoints; needs a decision about which is the truth.',
    filesChanged: 3,
    usage: { costUsd: 0.42, durationMs: 421_000, turns: 9, contextTokens: 41_200, outputTokens: 3_180 },
    report: 'Both panels are honest about what they read.',
  }),
  run({
    run: 'r-2026-08-23-0803',
    status: 'success',
    outcome: 'success',
    card: 'P-004',
    board: 'product',
    finished: '2026-08-23T08:19:00.000Z',
    verdict: 'done',
    summary: 'Cost is on the row.',
    filesChanged: 5,
    suggestions: 1,
    usage: { costUsd: 1.11, durationMs: 968_000, turns: 21, contextTokens: 88_400, outputTokens: 6_020 },
    report: 'Added the cost column and the per-run total.',
  }),
  run({
    run: 'r-2026-08-23-0740',
    status: 'interrupted',
    card: 'E-013',
    board: 'engineering',
    finished: '2026-08-23T07:44:00.000Z',
    fault: 'infrastructure',
    note: 'The backend never answered.',
  }),
  // No card and no board: a run about the PROJECT. The row has to say so rather than blame a missing card.
  run({
    run: 'r-2026-08-23-0701',
    status: 'success',
    outcome: 'success',
    skill: 'checkup',
    finished: '2026-08-23T07:06:00.000Z',
  }),
];

export const activeRunIds = ['r-2026-08-23-0912'];
export const queuedRunIds = ['r-2026-08-23-0930'];

// FROZEN, so a story is the same picture tomorrow. `elapsed()` renders the difference between this and each
// run's `started`, and `Date.now()` would make every render of the running row a different string.
export const now = Date.parse('2026-08-23T09:20:00.000Z');
