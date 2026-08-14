import type { Spend } from '../src/core/accounting.js';
import type { TickAction } from '../src/core/actions.js';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import type { AutopilotState } from '../src/core/autopilot-state.js';
import type { DeclaredCommands } from '../src/core/foundation.js';
import type { TickInput } from '../src/core/tick.js';
import type { BoardName, Card } from '../src/core/types.js';

// The board the tick is asked about, shared by tick.test.ts and tick-stop-sentences.test.ts. One home
// rather than two copies: both files drive the machine through `decideTick`, so a fixture that drifted
// between them would make the two suites disagree about what the same board means.
//
// `TickInput` comes through `src/core/tick.js` — the surviving barrel — deliberately. It is the specifier
// every production importer uses, so type-checking the tests is also a check that the barrel still
// re-exports what callers ask of it.

export function card(id: string, board: BoardName, columnSlug: string, order: number, links: string[]): Card {
  return {
    id,
    title: id,
    order,
    tags: [],
    links,
    created: '2026-08-05',
    board,
    columnSlug,
    body: '',
    filePath: `/tmp/${id}.md`,
  };
}

// A task under the story below, which is the parent every task fixture here hangs off.
export const task = (id: string, columnSlug: string, order = 10): Card =>
  card(id, 'engineering', columnSlug, order, ['P-001']);

// The scaffolder's own defaults, as slugs. Product carries a `blocked` column since decision 45's
// 2026-08-13 correction, and the tick reads this list before stamping one — a column IS a folder, so a
// stamp to a column the board has not got creates the folder and hides the card.
export const COLUMNS: Record<BoardName, string[]> = {
  features: ['backlog', 'todo', 'in-progress', 'done'],
  product: ['backlog', 'todo', 'in-progress', 'blocked', 'done'],
  engineering: ['backlog', 'in-progress', 'review', 'blocked', 'done'],
};

const RUNNING: AutopilotState = { state: 'running', iteration: 0 };

const NO_SPEND: Spend = { runs: 0, withCost: 0, withoutCost: 0 };

// One feature being worked, with one story under it. ONE open feature, because two is a refusal now
// (decision 39's invariant) and a fixture that trips it would answer every test with the same stop.
export const base = (): Card[] => [
  card('F-001', 'features', 'todo', 10, ['P-001']),
  card('P-001', 'product', 'backlog', 10, ['F-001']),
];

const DISTINCT_COMMANDS: DeclaredCommands = { gates: ['gate one', 'gate two'], smoke: 'use the thing' };

export const input = (over: Partial<TickInput> = {}): TickInput => ({
  ap: DEFAULT_AUTOPILOT,
  state: RUNNING,
  cards: base(),
  columns: COLUMNS,
  runs: [],
  spend: NO_SPEND,
  inFlight: [],
  problems: [],
  // A GATE AND A SMOKE COMMAND THAT DIFFER, which is the ordinary project and the only fixture under which
  // `complete` is reachable at all (ruling 66). Every test about the collision names its own pair.
  commands: DISTINCT_COMMANDS,
  ...over,
});

export const state = (over: Partial<AutopilotState>): AutopilotState => ({ ...RUNNING, ...over });

export const detailOf = (action: TickAction): string => (action.kind === 'stop' ? (action.detail ?? '') : '');
