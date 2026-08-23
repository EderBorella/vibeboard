import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

// The three themes are the considered part of this codebase — themes.css carries measured contrast
// ratios and a per-theme reason for every decision — so every check runs against all three. A
// conformance claim about one theme is a claim about none.
export const THEMES = ['cyberpunk', 'marshmallow', 'classic-dark'] as const;
export type Theme = (typeof THEMES)[number];

export interface VisualOptions {
  theme: Theme;
}

interface Fixtures {
  // A page that is PROVEN to be showing the board. See `openBoard`.
  board: Page;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = resolve(HERE, '..', 'baseline');

// PER-SURFACE, AND DELIBERATELY NOT THE SAME SHAPE AS THE BOARD'S.
//
// FOUR MEASUREMENTS NOW AND IT WAS TWO: the atom phase added `controlHeights` and `markerHeights`,
// because this file recorded font sizes and radii and NOTHING about height — so the phase whose whole
// subject is that ten controls were ten heights was invisible to the instrument that fails on drift.
// "Zero drift" meant "nothing this file measures moved".
//
// The board records TALLIES (`13px×127`) and its drift check compares the value set behind them. A
// surface records only the SET, sorted, and the reason is what the two numbers are for: the board's
// tally is a fact about a fixed arrangement of 231 elements, while a surface's element count moves
// with the fixture's content — one more run record changes every tally on the Execution view and
// nothing about its type. So drift on a surface is asserted over the set, symmetrically NEW and GONE,
// which is the claim that a new off-scale value cannot appear and an existing one cannot vanish
// unnoticed. The board's own `fontSizes`/`radii` tallies are untouched by this phase.
export interface SurfaceBaseline {
  fontSizes: string[];
  radii: string[];
  // THE TWO BOX HEIGHTS, added by the atom phase and OPTIONAL for one run only: every baseline on disk
  // was recorded before they existed, and a reader that indexed blind would compare a set against
  // `undefined`. A surface whose baseline predates them is reported as drift rather than passed over —
  // see the drift block in surfaces.spec.ts — because the alternative is a field that silently checks
  // nothing until somebody remembers to re-record.
  controlHeights?: string[];
  markerHeights?: string[];
  examined: Record<string, number>;
  findings: Record<string, number>;
}

export interface Baseline {
  recorded: string;
  // Value → number of elements computing it. The count matters as much as the list: it is what says
  // whether a size is the default or a one-off.
  fontSizes: Record<string, number>;
  fontSizesOnText: Record<string, number>;
  radii: Record<string, number>;
  examined: Record<string, number>;
  findings: Record<string, number>;
  // Keyed by `Surface.name`. Absent for a theme recorded before Phase 6, which is why every reader
  // below defaults rather than indexes blind.
  surfaces?: Record<string, SurfaceBaseline>;
}

export function baselineFile(theme: string): string {
  return join(BASELINE_DIR, `${theme}.json`);
}

export async function readBaseline(theme: string): Promise<Baseline> {
  return JSON.parse(await readFile(baselineFile(theme), 'utf8')) as Baseline;
}

export async function writeBaseline(theme: string, baseline: Baseline): Promise<void> {
  await mkdir(BASELINE_DIR, { recursive: true });
  await writeFile(baselineFile(theme), `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

export const recording = process.env.VB_VISUAL_RECORD === '1';

// Sign the browser in, and PROVE the page is the board.
//
// This is the failure mode that would make every number in this harness a lie: the server has no
// anonymous access, so a browser without a credential renders the sign-in gate — a small centred
// card with about a dozen elements, no board columns, and its own font sizes. Every check would run,
// examine that card, and report a clean conformance that says nothing about the app.
//
// So: the credential goes in first, and then four separate facts are asserted, each of which only
// holds on the board. `[data-testid="ap-bar"]` is the strongest of them — App.tsx renders the
// auto-pilot bar only when the shell has chosen `work`, which requires a credential, an open project
// AND a snapshot from the socket.
async function openBoard(page: Page, theme: Theme, baseURL: string): Promise<void> {
  // THE CREDENTIAL. Read at run time from the file the harness's own server created under the
  // per-run temp root, held in memory, and never written, logged or named anywhere: no trace, no
  // video and no HAR is recorded (see playwright.config.ts) precisely because all three capture
  // request headers.
  const tokenFile = process.env.VB_VISUAL_TOKEN_FILE;
  if (!tokenFile) throw new Error('VB_VISUAL_TOKEN_FILE is not set — run the harness with `npm run visual`');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!token) throw new Error('the harness server wrote no credential');
  await page.context().addCookies([
    // The names mirror src/server/auth/cookies.ts: `vb` carries the credential, `vb.in` is the
    // no-secret hint that lets the page answer "am I signed in?" before its first render. Setting
    // only the first would make the page start a sign-in flow it does not need.
    { name: 'vb', value: token, url: baseURL },
    { name: 'vb.in', value: '1', url: baseURL },
  ]);
  // Before the app's first paint, or `useTheme` writes the default and the theme under test is
  // whatever the previous test left behind.
  await page.addInitScript((t) => {
    window.localStorage.setItem('vb-theme', t);
  }, theme);
  await page.goto('/');

  await expect(page.locator('[data-testid="ap-bar"]')).toBeVisible({ timeout: 30_000 });
  // The sign-in gate and the project gate share this class. Its absence is the other half of the
  // proof: `ap-bar` says the board rendered, `.gate` absent says nothing is covering it.
  await expect(page.locator('.gate')).toHaveCount(0);
  // Three boards, and cards on them — the scaffolder's sample cards. A board with no tiles renders
  // almost nothing, and a check that examines nothing passes.
  // KEYED ON THE TEST HANDLE, NOT ON `.board`. Phase 8 turned the board into a `<Stack as="section">` and
  // deleted the class, and this line is what broke: every one of the 108 tests failed in the FIXTURE,
  // before a single check ran. That is the fourth time in this sweep a conformance selector has been
  // keyed on a style class — after `.ap-bar-end`, `.cards-gone` and `NOT_AN_ATOM_YET` — and it is the
  // worst of the four, because the other three would have gone quietly vacuous while this one took the
  // whole harness down. A test may depend on a `data-testid`; it may not depend on a class surviving.
  await expect(page.locator('[data-testid="board"]')).toHaveCount(3);
  expect(await page.locator('.tile').count()).toBeGreaterThan(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

export const test = base.extend<VisualOptions & Fixtures>({
  theme: ['cyberpunk', { option: true }],
  board: async ({ page, theme, baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL is not configured');
    await openBoard(page, theme, baseURL);
    await use(page);
  },
});

export { expect };
