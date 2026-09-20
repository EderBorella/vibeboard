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
// like coverage. So each surface names something only it renders, and the five top-level views that
// are not the board additionally assert the board is GONE — a `goto` that silently landed back on the board, or an
// `open` step whose selector stopped matching, then fails the assertion instead of measuring the wrong
// page. That is the same construction `openBoard` in fixtures.ts already uses to tell the board apart
// from the sign-in gate, and it was proven there by planting a broken `lastProject`.
export interface Surface {
  name: string;
  // What this surface IS, for the report.
  what: string;
  // The element whose subtree is measured, or null for the whole document.
  //
  // Null for the six top-level views, because a view IS the page. A selector for the six surfaces
  // that render OVER a page — the open card in the dock, the archive drawer, settings, the copilot
  // dock, the model picker, the confirm dialog — all of which leave the board behind them, so a
  // whole-document walk would report the board's numbers again under a second name.
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
    name: 'wizard',
    what: 'the setup wizard — its identity step, reached through the New project door on the picker',
    root: null,
    open: async (page) => {
      // THE DOORS ARE PART OF THE PATH ON PURPOSE. The wizard has no URL of its own, and the only way a
      // person reaches it is the one walked here: the top bar puts the picker up, and pressing a door is
      // what takes the picker down again — `chooseContent` gives the gate precedence, so a door that
      // failed to dismiss it would leave this measuring the picker under the wizard's name.
      await page.locator('header.topbar').getByRole('button', { name: 'Switch project' }).click();
      await page.locator('.gate').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'New project' }).click();
      await page.locator('.wizard-card').waitFor({ state: 'visible' });
    },
    prove: async (page) => {
      await expect(page.locator('.wizard-card')).toBeVisible();
      // THE PICKER IS GONE, and this is the assertion the wizard's own class exists for: `openBoard`
      // proves the board by counting `.gate` at zero, so a setup screen wearing the picker's frame would
      // make one proof answer for two screens. Asserted here as well as there, in both directions.
      await gone(page, '.gate');
      await gone(page, 'main.boards');
    },
    floor: { elements: 40, text: 15, contrast: 15, focus: 3 },
  },
  {
    name: 'wizard-stack',
    what: "the setup wizard's stack step — the proposal, the box to overrule it and what the sandbox installs",
    // This surface records a THIRD control height, 32px, beside --ctl-h's 28px and --mark-h's 16px:
    // the two-row `Or name your own stack` textarea, an intrinsic height no gate reads. Named here so
    // the next reader of the baseline diff does not hunt for it.
    root: null,
    open: async (page) => {
      // A DIFFERENT PROJECT, AND THAT IS THE ONLY WAY IN. These steps have no door of their own: the
      // wizard resumes at the step its file names when a project with an unfinished setup is opened
      // (`useWizard`), so the path is the picker and the second project visual/run.mjs scaffolds — the
      // board-proof one must never carry that file, or every other check would measure this screen.
      await page.locator('header.topbar').getByRole('button', { name: 'Switch project' }).click();
      await page.locator('.gate').waitFor({ state: 'visible' });
      // By NAME, not by position: the picker sorts on it, and a row keyed on the temp root's path
      // would name a directory that is different on every run.
      await page.locator('.gate li').filter({ hasText: 'Setup in progress' }).click();
      await page.locator('.wizard-card').waitFor({ state: 'visible' });
      // THE ENGINEER'S FOLD, OPENED, because a closed `<details>` renders none of its contents: the
      // packages field the run prefilled is the only control on this screen that is neither prose nor a
      // button, and every check would walk straight past it.
      await page.locator('.wizard-card details summary').click();
    },
    prove: async (page) => {
      // THE PROPOSAL ITSELF, and it is the assertion that makes this surface distinguishable from the
      // step failing to load its state. `Use this stack` renders on the answered screen whether or not
      // anything was proposed — disabled, over an empty screen — so proving the button alone would pass
      // on a run that proposed nothing, which is exactly what this harness gets: it has no agents.
      await expect(page.locator('[data-testid="verbatim-stack"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Use this stack' })).toBeEnabled();
      // Open, and with its field in it: `toBeVisible` on a control inside a closed fold is false, so
      // this is also what says the click in `open` still lands.
      await expect(page.locator('.wizard-card details input.vb-ctl')).toBeVisible();
      await gone(page, '.gate');
      await gone(page, 'main.boards');
    },
    // 51 elements are measured here. The floor is set close because the failure it has to catch is a
    // near miss: the waiting screen this step shows while a run is choosing is the same card with a
    // spinner and four fewer controls in it, and a loose floor would record it as a surface.
    floor: { elements: 40, text: 15, contrast: 15, focus: 10 },
  },
  {
    name: 'wizard-review',
    what: "the setup wizard's review — six summaries beside the conversation that wrote them",
    // The baseline records a 47px control height here beside --ctl-h's 28px and --mark-h's 16px, and it
    // is the DOCK'S composer arriving with the embedded panel rather than anything setup declares —
    // already recorded on `copilot` and on the five whole-document surfaces the dock is open on. Named
    // here for the reason `wizard-stack`'s 32px is: so the next reader of a baseline diff does not hunt.
    root: null,
    open: async (page) => {
      // A THIRD PROJECT, AND IT RESUMES STRAIGHT INTO THE REVIEW. Its `wizard.yaml` names the documents
      // step and already carries all six summaries, which is the resume the loop is built around: the
      // step offers to write nothing, dispatches nothing and raises no confirm when it opens on a
      // project that has them — so this screen renders from the file alone, which is the only reason a
      // harness with no agents can measure it. See visual/run.mjs.
      await page.locator('header.topbar').getByRole('button', { name: 'Switch project' }).click();
      await page.locator('.gate').waitFor({ state: 'visible' });
      await page.locator('.gate li').filter({ hasText: 'Drafts to read' }).click();
      await page.locator('.wizard-card').waitFor({ state: 'visible' });
      // The cards, not merely the card: the step renders its heading before the summaries land.
      await page.locator('[data-testid="doc-card"]').first().waitFor({ state: 'visible' });
    },
    prove: async (page) => {
      // THE PERSON'S OWN BUTTON, which is the whole ruling this screen exists for (W3, decision 78):
      // nothing else advances setup from here. Enabled, because a turn in flight shuts it and there
      // is no turn.
      await expect(page.getByRole('button', { name: 'It reads right — continue' })).toBeEnabled();
      // ALL SIX, AND ONE OF THEM BY ITS PLAIN NAME. The count says the full set is on screen — a
      // résumé map with gaps renders placeholder cards, which is a different screen — and the name
      // says these are the WIZARD'S cards and not a filename list (W7).
      // SCOPED TO THE CARDS, because the selector below offers the same six plain names and a bare
      // text match resolves to two elements — which is itself the point: the card face and the
      // `Talking about` options are one vocabulary, so proving the name on a card has to say card.
      await expect(page.locator('[data-testid="doc-card"]')).toHaveCount(6);
      await expect(page.locator('[data-testid="doc-card"]').filter({ hasText: 'Quality gates' })).toHaveCount(
        1,
      );
      // SIX SUMMARIES AND NOT SIX CARDS, which the count above cannot tell apart: a card with nothing
      // filed renders the quiet placeholder and NO `Read it all`, so a fixture that lost its résumés
      // would still be six cards and would still be a different screen. This is the one assertion here
      // that distinguishes the review from the writing screen by what is ON the cards.
      await expect(page.getByRole('button', { name: 'Read it all' })).toHaveCount(6);
      // The subject selector above the chat, which is the other half of "this document" having a
      // visible answer.
      await expect(page.getByLabel('Talking about')).toBeVisible();
      // THE DOCK'S OWN PANEL, EMBEDDED, AND WEARING NONE OF THE DOCK (ruling W11). The transcript's
      // handle used to be on a wrapper AROUND the panel and is inside it now — narrowing the
      // plain-words exemption to the model's own words — so the selector is the other way up. Both
      // halves are asserted: the conversation is here, and the chrome that belongs to the dock is not.
      // `.copilot-title` is the header's own class, which is the cheapest thing on the surface that
      // exists in one mode and not the other.
      await expect(page.locator('.copilot [data-testid="verbatim-conversation"]')).toBeVisible();
      await gone(page, '.copilot-title');
      // THE PROSE KEEPS THE MEASURE THE CARD GAVE UP, and this surface is the only thing in the
      // repository that can see it: `.wizard-wide` takes the step off `--measure` so the cards have
      // room, which took the heading and the hint with it — 1198px of hint at this viewport, measured
      // here before the rule existed. Both halves are asserted because either alone passes on the
      // fault: a live `max-width` that resolved to the window, or a narrow box with no rule behind it.
      const prose = await page
        .locator('.wizard-prose')
        .evaluate((el) => ({ width: el.clientWidth, max: getComputedStyle(el).maxWidth }));
      expect(prose.max, 'the prose container is back on the window’s width').not.toBe('none');
      expect(prose.width, `the heading and hint measure ${prose.width}px`).toBeLessThan(700);
      // AND NOTHING ASKED ANYTHING. The authorise confirm is what a documents step raises when it is
      // about to write, and a resume that raised it would be the Plan C fault this step was changed to
      // remove — measured here because it is also what would make every number below the dialog's.
      await gone(page, '.vb-modal[data-size="sm"]');
      await gone(page, '.gate');
      await gone(page, 'main.boards');
    },
    // 95 elements are measured here and the floor is 85. Both numbers moved when the embedded panel
    // went `compact` (ruling W11) and the re-derivation is the point, because the old floor of 120 was
    // argued from a conversation that is no longer this size: the dock is 65 elements where the
    // `copilot` surface measures it, and the panel on THIS surface is 12 — measured, not estimated.
    //
    // The near miss is unchanged and is still what sets the number: this step's OTHER screen renders
    // the same six cards in the same card and differs by the conversation (12), the subject selector
    // above it with its seven options (~11) and the advance under them (~3), which puts the writing
    // screen near 69. 85 sits above that and ten under what is measured here.
    floor: { elements: 85, text: 35, contrast: 35, focus: 25 },
  },
  {
    name: 'wizard-import',
    what: "the setup wizard's import step — the list box, the one-liner about it and the way to send them",
    // This surface records a 122px control height beside --ctl-h's 28px and --mark-h's 16px: the
    // eight-row paste box, an intrinsic height no gate reads — `wizard-stack`'s 32px textarea with
    // six more rows in it. Named here for that entry's reason, so the next reader of a baseline diff
    // does not go hunting for a rule that sets it.
    root: null,
    open: async (page) => {
      // A FOURTH PROJECT, for the reason the stack and the review steps each need one of their own:
      // a wizard step has no URL, and the only way in is opening a project whose file names it.
      await page.locator('header.topbar').getByRole('button', { name: 'Switch project' }).click();
      await page.locator('.gate').waitFor({ state: 'visible' });
      await page.locator('.gate li').filter({ hasText: 'Bring in a list' }).click();
      await page.locator('.wizard-card').waitFor({ state: 'visible' });
      // THE YES-DOOR, OPENED, and it is the stack step's `<details>` click exactly: the two boxes this
      // step is about do not exist until it is pressed, so without this every check would walk past
      // the only controls on the screen and measure two buttons under a question.
      await page.getByRole('button', { name: 'Yes — bring it in' }).click();
    },
    prove: async (page) => {
      // THE TWO BOXES, which nothing else in the product renders. The paste is a textarea and the
      // one-liner is a single line, and proving both is what says the yes-door really opened —
      // the question screen behind it has neither.
      await expect(page.getByLabel('Paste your list, or say where it lives')).toBeVisible();
      await expect(
        page.getByLabel('Anything the assistant should know about how you keep it?'),
      ).toBeVisible();
      // DISABLED, and that is the assertion rather than an oversight: the send is gated on there
      // being words to send, and nothing has been typed. It is the state this surface measures.
      await expect(page.getByRole('button', { name: 'Bring it in' })).toBeDisabled();
      await gone(page, '.gate');
      await gone(page, 'main.boards');
    },
    // WHAT THIS SURFACE CANNOT SEE, said here so nobody reads its passing as cover for the whole
    // step: once the turn is sent this screen carries the dock's panel worn compact, inside the
    // card's own measure — and that state needs a real model, exactly as the thinking indicator does
    // on the `copilot` surface. `docs/smoke-test.md`'s C7, "The import, with a real list", is what
    // drives it — including the two states no fixture can reach, a turn the person stopped and a
    // turn refused outright.
    //
    // 46 elements are measured here, 45 until the no-door started standing behind the yes-door as
    // well — one button, and the baseline moved by exactly one element, one text element and one
    // focusable in all three themes. The near miss is the QUESTION screen in front of it: the same
    // card with the two boxes replaced by nothing, measured at 39 by removing the click in `open`
    // and running this surface, and untouched by that button since it always carried both doors.
    // The floor sits between them, as `wizard-stack`'s does. Focus barely separates the two (15
    // here against the question's 14), so that number is an anti-vacuity floor only.
    floor: { elements: 42, text: 17, contrast: 17, focus: 12 },
  },
  {
    name: 'wizard-ready',
    what: "the setup wizard's last screen — what was set up, whether anything is missing, and the way out",
    root: null,
    open: async (page) => {
      await page.locator('header.topbar').getByRole('button', { name: 'Switch project' }).click();
      await page.locator('.gate').waitFor({ state: 'visible' });
      await page.locator('.gate li').filter({ hasText: 'Ready to start' }).click();
      await page.locator('.wizard-card').waitFor({ state: 'visible' });
    },
    prove: async (page) => {
      // THE SUMMARY, AND IT IS WHAT MAKES THIS SCREEN DISTINGUISHABLE FROM A HALF-READ ONE. Each of
      // these three lines is omitted when the wizard cannot say it, so a fixture whose file failed to
      // load would render the heading, the button and nothing else — and that is a different screen
      // measured under this name.
      await expect(page.getByText('Set up as: Web App')).toBeVisible();
      await expect(page.locator('[data-testid="verbatim-stack"]')).toBeVisible();
      await expect(
        page.getByText('6 documents written — read them any time in Project Control'),
      ).toBeVisible();
      // THE READINESS, ANSWERED. This project has its six documents, its gate documents are not
      // flagged and the scaffolder's cards are on the board, so `ok` is the honest answer and this is
      // the sentence the journey's own ending shows. A blocker list here would mean the fixture
      // stopped being the state it claims to be.
      await expect(page.getByText('Everything auto-pilot needs is here.')).toBeVisible();
      await expect(page.locator('[data-testid="verbatim-blockers"]')).toHaveCount(0);
      // THE ENDING, AND THE ONLY THING LEFT TO PRESS. Both halves: completion is the ending here, so
      // the quiet skip and `Stop offering this` are gone — two more endings beside this one would
      // read as a choice between them.
      await expect(page.getByRole('button', { name: 'Open the board' })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Not now — take me to the board' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Stop offering this' })).toHaveCount(0);
      await gone(page, '.gate');
      await gone(page, 'main.boards');
    },
    // WHAT THIS SURFACE CANNOT SEE: the import's closing sentence, which is the model's own and lives
    // in the step that heard it rather than on disk — a setup resumed at this step has no copy of it,
    // and neither does this fixture. The unit suite walks the import into the ending for that line.
    //
    // 40 elements are measured here and the near miss is this same screen with NOTHING TO REPORT —
    // every summary line is omitted when the wizard cannot say it, so a file that failed to load
    // renders the heading, the readiness and the button alone. Measured at 37 by stripping the stack
    // and the résumés from the fixture and running this surface, which is why the floor is 38 and the
    // three summary lines are proved by name above rather than left to the count.
    floor: { elements: 38, text: 16, contrast: 16, focus: 9 },
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
