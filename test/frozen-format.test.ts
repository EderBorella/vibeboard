import { cp, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { boardColumnSlugs } from '../src/core/board/columns.js';
import { decideTick, type TickInput } from '../src/core/tick.js';
import { BOARDS, type BoardName, type Card } from '../src/core/types.js';
import { readBoard } from '../src/store/cards/board.js';
import { updateCard } from '../src/store/cards/mutations.js';
import { readConfig } from '../src/store/project/config.js';
import { tempDir } from './helpers.js';

// THE ON-DISK FORMAT IS FROZEN, and `test/fixtures/legacy-project` is what a project written BEFORE
// decision 85 looks like. Every card file in it was produced by this repository's own writers as they
// stood before `satisfiedBy` existed — scaffolded, then created through `createLinkedCard` — rather than
// typed out from memory, because a fixture invented from the documentation is wrong in exactly the way the
// code would be.
//
// WHAT "FROZEN" HAS TO MEAN FOR AN OPTIONAL KEY TO BE PERMITTED, asserted rather than argued:
//
//   it still parses          every card reads back with the fields it had, and the new one absent;
//   it still WRITES BACK     rewriting a card through the ordinary store path reproduces the file BYTE FOR
//                            BYTE — no new key, no reordering, no `satisfiedBy: null`;
//   it still runs            the lifecycle machine decides over it exactly what it decided before.
//
// EXACT BYTES, never `toContain`. An emitted-but-empty key, a key in the wrong place, or a re-quoted date
// are all invisible to a substring match and all of them are a changed format.

const FIXTURE = join(process.cwd(), 'test', 'fixtures', 'legacy-project');

async function openLegacy(): Promise<{ root: string; cards: Card[]; columns: Record<BoardName, string[]> }> {
  const root = await tempDir();
  await cp(FIXTURE, root, { recursive: true });
  const config = await readConfig(root);
  const cards: Card[] = [];
  const columns = {} as Record<BoardName, string[]>;
  for (const board of BOARDS) {
    cards.push(...(await readBoard(root, board, config)));
    columns[board] = boardColumnSlugs(config, board);
  }
  return { root, cards, columns };
}

// Every card file in the fixture, by path, so a card added to it is covered without being listed here.
async function cardFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.md')) found.push(full);
    }
  };
  await walk(join(root, '.vibeboard', 'boards'));
  return found.sort();
}

describe('a project written before decision 85', () => {
  it('still reads back every card, with no criterion on any of them', async () => {
    const { cards } = await openLegacy();
    expect(cards.map((c) => c.id).sort()).toEqual(['E-001', 'F-001', 'P-001', 'P-002']);
    // The fields these cards really carry, so a parser that started dropping one fails here.
    expect(cards.find((c) => c.id === 'P-001')).toMatchObject({
      title: 'The test command exits 0',
      links: ['F-001'],
      created: '2026-08-20',
      createdBy: 'run-2026-08-20-0001',
      columnSlug: 'backlog',
      body: "Running the project's test command must exit 0.",
    });
    expect(cards.filter((c) => c.satisfiedBy !== undefined)).toEqual([]);
  });

  // THE BYTES. `updateCard` with an empty patch is the ordinary write path every mutation ends in, so this
  // is the real question: does today's writer reproduce yesterday's file? A `satisfiedBy` emitted when
  // absent, or emitted in a different place, fails here and nowhere else.
  it('writes every card back byte for byte', async () => {
    const { root, cards } = await openLegacy();
    const before = new Map<string, string>();
    for (const path of await cardFiles(root)) before.set(path, await readFile(path, 'utf8'));
    expect(before.size).toBe(4);
    for (const card of cards) await updateCard(root, card, {});
    for (const [path, original] of before) expect(await readFile(path, 'utf8')).toBe(original);
  });

  // AND IT STILL RUNS. The board is mid-lifecycle — one feature open, one story carrying a task, one story
  // behind it with none — and the machine decides over it what it decided before this branch existed.
  it('drives the lifecycle machine to the same decisions', async () => {
    const { cards, columns } = await openLegacy();
    const input: TickInput = {
      ap: DEFAULT_AUTOPILOT,
      state: { state: 'running', iteration: 0 },
      cards,
      columns,
      runs: [],
      spend: { runs: 0, withCost: 0, withoutCost: 0 },
      inFlight: [],
      problems: [],
      commands: { gates: ['npm test'], smoke: 'node dist/cli.js --help' },
      unrecordedSendBacks: [],
      unwrittenTasks: [],
      satisfied: [],
    };
    // The open story has a task, so the work goes ahead: row P3, with that task in the group.
    expect(decideTick(input)).toMatchObject({
      kind: 'dispatch',
      phase: 'story-implement',
      card: { id: 'P-002' },
    });

    // AND THE BRANCH A CHILDLESS STORY TAKES, which decisions 85 and 92 touch. The same project one story later:
    // P-002 closed, so the machine picks up P-001 — which carries no criterion, because no card written before
    // decision 85 could. The loop writes its one task (decision 92), and `satisfied` naming it changes nothing,
    // because the card names no command for the loop to have run.
    const later = cards.map((c) => (c.id === 'P-002' ? { ...c, columnSlug: 'done' } : c));
    expect(decideTick({ ...input, cards: later })).toMatchObject({
      kind: 'create',
      phase: 'story-task',
      card: { id: 'P-001' },
    });
    expect(decideTick({ ...input, cards: later, satisfied: ['P-001'] })).toMatchObject({
      kind: 'create',
      phase: 'story-task',
      card: { id: 'P-001' },
    });
  });
});
