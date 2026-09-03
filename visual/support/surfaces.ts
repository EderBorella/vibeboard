import { expect, type Page } from '@playwright/test';

// EVERY SURFACE THE BROWSER CAN REACH, and how to get to each one.
//
// Before Phase 6 the whole of this harness's navigation was `page.goto('/')` — one line in
// fixtures.ts — so every claim Part One of docs/design-system.md makes about the browser is a claim
// about the BOARD VIEW ALONE. Thirteen gates, one page. Four other top-level views, an open card, the
// archive drawer, settings, the model picker and the confirm dialog were never rendered at all, which
// is also why Phase 0 measured 15 computed font sizes against 27 authored.
//
// THE TRAP, AND WHY EVERY SURFACE CARRIES A `prove`. A harness that measures the board ten times and
// reports it as ten surfaces is WORSE than one that measures it once, because the numbers would look
// like coverage. So each surface names something only it renders, and the four top-level views
// additionally assert the board is GONE — a `goto` that silently landed back on the board, or an
// `open` step whose selector stopped matching, then fails the assertion instead of measuring the wrong
// page. That is the same construction `openBoard` in fixtures.ts already uses to tell the board apart
// from the sign-in gate, and it was proven there by planting a broken `lastProject`.
export interface Surface {
  name: string;
  // What this surface IS, for the report.
  what: string;
  // The element whose subtree is measured, or null for the whole document.
  //
  // Null for the five top-level views, because a view IS the page. A selector for the five surfaces
  // that render OVER a page — the open card in the dock, the archive drawer, settings, the model
  // picker, the confirm dialog — all of which leave the board behind them, so a whole-document walk
  // would report the board's numbers again under a second name.
  root: string | null;
  // Getting there from a proven board. Kept separate from `prove` so a planted navigation failure has
  // somewhere to be planted.
  open: (page: Page) => Promise<void>;
  // Something only this surface renders. Assertions, not booleans: the failure has to name what was
  // missing, because "the checks measured the board again" is invisible in a passing number.
  prove: (page: Page) => Promise<void>;
  // ABSOLUTE minimums, beside the recorded examined counts.
  //
  // Both are needed and neither is enough. The recorded count catches a surface that shrank; these
  // catch a surface that was recorded EMPTY in the first place — `npm run visual:record` on a fixture
  // with no runs would write `elements: 0` for the Execution view and every check would then agree
  // with every claim made about it. A check that examines nothing passes.
  floor: { elements: number; text: number; contrast: number; focus: number };
}

// The tab buttons carry a badge when the Execution view has runs needing attention, so the accessible
// name is "Execution 1" rather than "Execution" — anchored at the start rather than matched exactly for
// that reason. It is not a loose match: `Project Log` and `Project Control` share a first word and both
// are anchored past it.
function tab(page: Page, label: string) {
  // `.vb-menu` and not `.topbar-tabs`: the five destinations are a `Menu` row as of the molecule layer.
  return page.locator('.vb-menu button').filter({ hasText: new RegExp(`^${label}`) });
}

async function gone(page: Page, selector: string): Promise<void> {
  await expect(
    page.locator(selector),
    `${selector} is still rendered — this is not a new surface`,
  ).toHaveCount(0);
}

export const SURFACES: Surface[] = [
  {
    name: 'boards',
    what: 'the board view — three boards, their columns and their tiles',
    root: null,
    // Already there: the `board` fixture proves it. This entry exists so the surface table has a row
    // for the one page Part One measured, at the same floors as the nine it did not.
    open: async () => {},
    prove: async (page) => {
      await expect(page.locator('main.boards')).toBeVisible();
      await expect(page.locator('[data-testid="board"]')).toHaveCount(3);
      await expect(page.locator('.tile').first()).toBeVisible();
    },
    floor: { elements: 150, text: 80, contrast: 80, focus: 30 },
  },
  {
    name: 'execution',
    what: 'the Execution dashboard — three run columns and the project ledger',
    root: null,
    open: async (page) => {
      await tab(page, 'Execution').click();
    },
    prove: async (page) => {
      await expect(page.locator('main.execution')).toBeVisible();
      // Three columns by their aria-labels, which are the view's own copy rather than a class.
      for (const label of ['In progress', 'Requires attention', 'Done']) {
        await expect(page.locator(`section[aria-label="${label}"]`)).toHaveCount(1);
      }
      // RUNS, not merely columns. A greenfield fixture has none, and three empty panels examine
      // almost nothing — see the fixture state written by visual/run.mjs.
      await expect(page.locator('[data-testid="exec-card"]').first()).toBeVisible();
      await gone(page, 'main.boards');
    },
    floor: { elements: 60, text: 25, contrast: 25, focus: 3 },
  },
  {
    name: 'diary',
    what: 'the Project Log — the diary and what agents filed',
    root: null,
    open: async (page) => {
      await tab(page, 'Project Log').click();
    },
    prove: async (page) => {
      await expect(page.locator('.log-split')).toBeVisible();
      await expect(page.locator('section[aria-label="Project log"]')).toHaveCount(1);
      await expect(page.locator('section[aria-label="What agents filed"]')).toHaveCount(1);
      // Entries on both halves, for the reason the Execution view wants runs.
      await expect(page.locator('.diary-list > *').first()).toBeVisible();
      await expect(page.locator('.filed-list > *').first()).toBeVisible();
      await gone(page, 'main.boards');
    },
    floor: { elements: 60, text: 25, contrast: 25, focus: 3 },
  },
  {
    name: 'control',
    what: 'Project Control — the config file list and its editor',
    root: null,
    open: async (page) => {
      await tab(page, 'Project Control').click();
    },
    prove: async (page) => {
      await expect(page.locator('section.control')).toBeVisible();
      // NOT the Explorer, which reuses `.control` and adds `.explorer` to it. Without this the two
      // surfaces would prove each other.
      await gone(page, 'section.control.explorer');
      await expect(page.locator('[data-testid="control-item"]').first()).toBeVisible();
      await expect(page.locator('.vb-editor')).toBeVisible();
      await gone(page, 'main.boards');
    },
    floor: { elements: 40, text: 15, contrast: 15, focus: 3 },
  },
  {
    name: 'explorer',
    what: 'the Explorer — the project file tree and its editor',
    root: null,
    open: async (page) => {
      await tab(page, 'Explorer').click();
    },
    prove: async (page) => {
      await expect(page.locator('section.control.explorer')).toBeVisible();
      await expect(page.locator('[data-testid="explorer-item"]').first()).toBeVisible();
      await gone(page, 'main.boards');
    },
    floor: { elements: 40, text: 15, contrast: 15, focus: 3 },
  },
  {
    name: 'card',
    what: 'an open card in the dock — its tab strip, the card view, its runs and the skill rail',
    root: '[data-testid="dock-body"]',
    open: async (page) => {
      // THE SAMPLE PRODUCT CARD SPECIFICALLY, and not the first tile: it is the one visual/run.mjs
      // writes run records and links against, so it is the only card whose pane renders a report list
      // and a links row. Any other tile opens a pane with two of its own sections missing.
      await page.locator('.tile').filter({ hasText: 'Sample product card' }).first().click();
      await page.locator('.cardview').waitFor({ state: 'visible' });
    },
    prove: async (page) => {
      // The dock body exists on the board too, holding "No card open." — so the drawer's own contents
      // are the proof, not the drawer.
      await expect(page.locator('[data-testid="dock-body"] .cards-pane')).toBeVisible();
      await expect(page.locator('.cardview .cv-title')).toBeVisible();
      // KEYED ON THE TEST HANDLE, not on `.cards-gone`. Selecting a style class here was the only thing
      // keeping that class alive — the same fault as check 14 and `.ap-bar-end`, in the same sweep.
      await gone(page, '[data-testid="cards-gone"]');
      // Tabs of its own, which is the half of this surface a board-only harness could never see.
      await expect(page.locator('.cards-tabs .vb-tab').first()).toBeVisible();
      // The skill rail, and the card's own run list — both of which only exist beside an open card.
      await expect(page.locator('aside.card-skills')).toBeVisible();
      await expect(page.locator('section.reports')).toBeVisible();
    },
    floor: { elements: 30, text: 10, contrast: 10, focus: 3 },
  },
  {
    name: 'archive',
    what: 'the archive drawer under a board — archived cards and their restore controls',
    root: '[data-testid="archive-drawer"]',
    open: async (page) => {
      await page.locator('.board-archive').first().click();
      await page.locator('[data-testid="archive-drawer"]').waitFor({ state: 'visible' });
    },
    prove: async (page) => {
      // The testid is only on the POPULATED drawer: the loading, error and empty states are their own
      // Panels without it, so an empty archive cannot be mistaken for a measured one.
      await expect(page.locator('[data-testid="archive-drawer"]')).toBeVisible();
      await expect(page.locator('[data-testid="archive-drawer"] > .vb-row').first()).toBeVisible();
      // KEYED ON THE TEST HANDLE, not on `.archive-title`. This selector was the only thing keeping that
      // class alive — it is one declaration (`color: var(--text)`) and a `<Text ink="strong">` inside the
      // bare Button says it. Fifth time in this sweep a conformance check has been the reason a style
      // class exists, after `.ap-bar-end`, `.cards-gone`, `NOT_AN_ATOM_YET` and `section.board`.
      await expect(page.locator('[data-testid="archive-title"]').first()).toBeVisible();
    },
    floor: { elements: 8, text: 4, contrast: 4, focus: 2 },
  },
  {
    name: 'settings',
    what: 'the settings modal — three sections of fields, hints and notices',
    root: '.vb-modal[data-size="lg"]',
    open: async (page) => {
      // The top bar's cog, not the auto-pilot bar's "Settings" link: both open this modal, and
      // scoping says which control this surface is reached through.
      await page.locator('header.topbar [title="Settings"]').click();
      await page.locator('.vb-modal[data-size="lg"]').waitFor({ state: 'visible' });
    },
    prove: async (page) => {
      await expect(page.locator('.vb-modal[data-size="lg"] .vb-modal-head > .vb-clip')).toHaveText(
        'Settings',
      );
      // AT LEAST three, asserted as "the third one is there" so the assertion retries while the modal
      // mounts. Not an exact count: the modal renders twelve section headings today and pinning that
      // would make adding a setting a failing gate.
      await expect(page.locator('.settings-section').nth(2)).toBeVisible();
      // A field with a control in it, which is what Phase 9 will be measuring here.
      await expect(page.locator('.vb-modal[data-size="lg"] select').first()).toBeVisible();
    },
    floor: { elements: 25, text: 10, contrast: 10, focus: 4 },
  },
  {
    name: 'copilot',
    what: 'the copilot dock — its transcript, the chat switcher and the composer',
    root: '.copilot',
    open: async (page) => {
      // OPEN BY DEFAULT, so this only has to make sure of it rather than toggle it. A blind click on
      // "Hide copilot" would close a dock that was already open and then measure the board instead — the
      // shape of failure this file's `prove` steps exist to refuse.
      if ((await page.locator('.copilot').count()) === 0) {
        await page
          .getByRole('button', { name: /copilot/i })
          .first()
          .click();
      }
      await page.locator('.copilot').waitFor({ state: 'visible' });
      // The seeded chat, not an empty dock: `visual/run.mjs` writes one under `.vibeboard/chat/`, and a
      // transcript with nothing in it measures the composer and calls it a surface.
      await page.locator('.msg-user').first().waitFor({ state: 'visible' });
    },
    prove: async (page) => {
      // ALL FOUR KINDS. They are four bubbles with four inks, and a fixture that rendered two of them
      // would report a floor over half a surface as though it were whole.
      for (const kind of ['msg-user', 'msg-assistant', 'msg-tool']) {
        await expect(page.locator(`.${kind}`).first()).toBeVisible();
      }
      // THE ERROR LINE IS NOT `.msg-error`. That class was deleted when the state tones landed — an error
      // is `.msg` plus `data-state="error"`, and the tone table decides its ink. Written down because the
      // first version of this check asked for `.msg-error` and failed: the name is still in the source, in
      // the comment that records its removal, which is exactly the kind of match that reads as proof.
      await expect(page.locator('.msg[data-state="error"]').first()).toBeVisible();
      // The composer, which is the one control in the dock a person types into.
      await expect(page.locator('.copilot-input')).toBeVisible();
    },
    // WHAT THIS SURFACE CANNOT SEE, said here so nobody reads its passing as cover for the whole dock.
    // The THINKING INDICATOR renders only while a turn is in flight — it is driven by a `copilot:state`
    // frame over the socket, so there is no fixture on disk that produces it and no way to reach it
    // without a real model call. It is covered by `docs/smoke-test.md` (A4), which drives a live turn.
    floor: { elements: 25, text: 10, contrast: 10, focus: 3 },
  },
  {
    name: 'model-picker',
    what: 'the model picker — a filtered list of models with their prices and capability badges',
    root: '.vb-modal[data-tone="accent"]',
    open: async (page) => {
      await page.locator('.copilot .mp .vb-trigger').click();
      await page.locator('.vb-modal[data-tone="accent"]').waitFor({ state: 'visible' });
    },
    prove: async (page) => {
      await expect(page.locator('.vb-modal[data-tone="accent"] .vb-modal-head > .vb-clip')).toHaveText(
        'Choose a model',
      );
      // Models, not an empty state. The default backend's catalogue is the four Claude aliases and
      // needs no network, so this is a real list rather than `.mp-empty`.
      await expect(page.locator('[data-testid="mp-pick"]').first()).toBeVisible();
      await gone(page, '.mp-empty');
    },
    floor: { elements: 20, text: 8, contrast: 8, focus: 4 },
  },
  {
    name: 'confirm',
    what: 'the confirm dialog — the question asked before anything irreversible',
    root: '.vb-modal[data-size="sm"]',
    open: async (page) => {
      // A tile's archive ✕, which is the cheapest reversible thing in the app that asks first.
      await page.locator('.tile [title="Archive"]').first().click();
      await page.locator('.vb-modal[data-size="sm"]').waitFor({ state: 'visible' });
    },
    prove: async (page) => {
      await expect(page.locator('.vb-modal[data-size="sm"]')).toBeVisible();
      await expect(page.locator('#confirm-title')).toBeVisible();
      await expect(page.locator('.vb-modal[data-size="sm"] .vb-text-lead')).toBeVisible();
      // Both buttons, because the pair being at two different sizes is a real defect this codebase has
      // already had — see the note at `.confirm-go` in useConfirm.tsx.
      await expect(page.locator('.vb-modal-foot .vb-btn')).toHaveCount(2);
    },
    floor: { elements: 8, text: 3, contrast: 3, focus: 2 },
  },
];
