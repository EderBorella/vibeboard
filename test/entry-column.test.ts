import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entryColumn } from '../src/core/entry-column.js';
import type { BoardName, ProjectConfig } from '../src/core/types.js';
import { defaultConfig } from '../src/store/project/config.js';

// WHERE A BOARD IS ENTERED. It had no test of its own while it lived in the card routes (now
// `server/boards/cards-routes.ts`) — every assertion about it went through an endpoint — so the
// refusal that stops a card being created into a terminal column was held by a 409 in one route's
// suite and nothing else.

const config = (over: (c: ProjectConfig) => ProjectConfig = (c) => c): ProjectConfig =>
  over(defaultConfig('T'));

const withColumns =
  (board: BoardName, columns: string[]) =>
  (c: ProjectConfig): ProjectConfig => ({
    ...c,
    boards: { ...c.boards, [board]: { ...c.boards[board], columns } },
  });

describe('entryColumn', () => {
  it('is the board’s first column, positionally', () => {
    expect(entryColumn(config(), 'features')).toBe('backlog');
    expect(entryColumn(config(), 'product')).toBe('backlog');
    expect(entryColumn(config(), 'engineering')).toBe('backlog');
  });

  it('follows a reorder rather than the name "backlog"', () => {
    // "Every board opens with a Backlog" is a scaffolder default, not an invariant.
    const reordered = config(withColumns('product', ['Triage', 'Backlog', 'Done']));
    expect(entryColumn(reordered, 'product')).toBe('triage');
  });

  it('refuses a first column that is terminal', () => {
    // A live card in a terminal column is the positive evidence `complete` reads, so entering there
    // would let a compliant agent manufacture a finished project.
    const base = defaultConfig('T');
    const terminalFirst = {
      ...base,
      autopilot: { ...base.autopilot, terminal: { ...base.autopilot?.terminal, product: ['backlog'] } },
    } as ProjectConfig;
    expect(entryColumn(terminalFirst, 'product')).toBeUndefined();
  });

  it('refuses engineering’s blocked column, which only the loop puts a card in', () => {
    const base = config(withColumns('engineering', ['Blocked', 'In Progress', 'Done']));
    const blockedFirst = {
      ...base,
      autopilot: { ...base.autopilot, blockedColumn: 'blocked' },
    } as ProjectConfig;
    expect(entryColumn(blockedFirst, 'engineering')).toBeUndefined();
  });

  // AND PRODUCT'S, since decision 45's correction gave that board one too. Through `isBlockedColumn`
  // rather than a second copy of "which boards have a blocked column": a story created into the column
  // that means "out of attempts" is work nothing will ever pick up, and a break-down creates stories.
  it('refuses product’s blocked column as well', () => {
    const base = config(withColumns('product', ['Blocked', 'Todo', 'Done']));
    const blockedFirst = {
      ...base,
      autopilot: { ...base.autopilot, blockedColumn: 'blocked' },
    } as ProjectConfig;
    expect(entryColumn(blockedFirst, 'product')).toBeUndefined();
    // Features has no blocked column, so the same first column there is an ordinary entry: the refusal
    // follows the rule rather than the word.
    const onFeatures = config(withColumns('features', ['Blocked', 'Todo', 'Done']));
    expect(entryColumn({ ...onFeatures, autopilot: base.autopilot } as ProjectConfig, 'features')).toBe(
      'blocked',
    );
  });

  it('refuses a board with no columns at all', () => {
    expect(entryColumn(config(withColumns('features', [])), 'features')).toBeUndefined();
  });

  it('survives a hand-edited autopilot block that is not the shape the type claims', () => {
    // `autopilot` is parsed YAML, so reading a member off it is a 500 handed to the caller least able
    // to interpret one.
    const bent = { ...defaultConfig('T'), autopilot: { terminal: 'done' } } as unknown as ProjectConfig;
    expect(entryColumn(bent, 'features')).toBe('backlog');
  });
});

// A ROUTE MUST NOT IMPORT A ROUTE. `suggestions/routes.ts` imported `entryColumn` from
// `boards/cards-routes.ts`, which is how one derivation ends up with two homes: the only alternative
// anybody reaches for is a second copy, and a second copy is how one path refuses a terminal first
// column while the other quietly creates a card in it.
//
// Asserted over EVERY route module rather than over the one pair that was wrong, so the next one is
// caught when it is written rather than at the next review.
//
// It used to read one flat `src/server/routes/` directory and flag a `./sibling.js` import. The routes
// now sit in their feature folders, so a route reaching another route is a `../other-feature/routes.js`
// — a specifier the old pattern could not see, in a directory that no longer exists. The premise guard
// is what reported that rather than letting the whole assertion pass over an empty list.
const ROUTE_MODULE = /(^|[\\/])(routes|[\w-]+-routes)\.ts$/;

describe('the route layer', () => {
  it('has no route importing another route', async () => {
    const dir = join(process.cwd(), 'src', 'server');
    const files = (await readdir(dir, { recursive: true })).filter((f) => ROUTE_MODULE.test(f));
    // The premise: a list this read as empty would make the assertion below vacuous.
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(join(dir, file), 'utf8');
      for (const match of source.matchAll(/from '(\.[^']*)'/g)) {
        const target = resolve(dirname(join(dir, file)), match[1].replace(/\.js$/, '.ts'));
        if (ROUTE_MODULE.test(relative(dir, target))) offenders.push(`${file} imports ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
