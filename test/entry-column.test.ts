import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { entryColumn } from '../src/core/entry-column.js';
import type { BoardName, ProjectConfig } from '../src/core/types.js';

// WHERE A BOARD IS ENTERED. It had no test of its own while it lived in `routes/cards.ts` — every
// assertion about it went through an endpoint — so the refusal that stops a card being created into a
// terminal column was held by a 409 in one route's suite and nothing else.

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

// A ROUTE MUST NOT IMPORT A ROUTE. `routes/suggestions.ts` imported `entryColumn` from
// `routes/cards.ts`, which is how one derivation ends up with two homes: the only alternative anybody
// reaches for is a second copy, and a second copy is how one path refuses a terminal first column
// while the other quietly creates a card in it.
//
// Asserted over the DIRECTORY rather than over the one pair that was wrong, so the next one is caught
// when it is written rather than at the next review.
describe('the route layer', () => {
  it('has no route importing another route', async () => {
    const dir = join(process.cwd(), 'src', 'server', 'routes');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.ts'));
    // The premise: a directory this read as empty would make the assertion below vacuous.
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(join(dir, file), 'utf8');
      for (const match of source.matchAll(/from '\.\/([\w.-]+)\.js'/g)) {
        offenders.push(`${file} imports ./${match[1]}.js`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
