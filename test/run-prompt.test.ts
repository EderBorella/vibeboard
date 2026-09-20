import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_SLUG,
  boardRel,
  DOCS_DIR,
  RESOURCES_DIR,
  RESULTS_DIR,
  RUNS_DIR,
  skillRel,
} from '../src/core/layout.js';
import { phase } from '../src/core/phases.js';
import type { Skill } from '../src/core/skills.js';
import { BOARDS, type BoardName, type Card } from '../src/core/types.js';
import type { Verification } from '../src/core/verify.js';
import { allows, endpointsFor } from '../src/server/auth/auth.js';
import type { Credential, Scope } from '../src/server/auth/credentials.js';
import { BOX_BROWSERS_PATH, BOX_PLAYWRIGHT_VERSION } from '../src/server/boxes/image-tools.js';
import { assistCredentialSection } from '../src/server/runs/prompt/credential.js';
import { type BoardColumns, buildRunPrompt, type PromptInputs } from '../src/server/runs/prompt/index.js';

const ROOT = '/p';

// Engineering has no Todo — asserting against a column the board does not have would describe an
// impossible project, which is how a card came to be written into a folder nothing reads.
const ENGINEERING_COLUMN = 'backlog';

const columns = (...names: string[]): { name: string; slug: string }[] =>
  names.map((name) => ({ name, slug: name.toLowerCase().replace(/ /g, '-') }));

const boardColumns: BoardColumns[] = [
  { board: 'features', columns: columns('Backlog', 'Todo', 'In Progress', 'Done') },
  { board: 'product', columns: columns('Backlog', 'Todo', 'In Progress', 'Done') },
  { board: 'engineering', columns: columns('Backlog', 'In Progress', 'Review', 'Done') },
];

const skill: Skill = {
  slug: 'execute',
  path: skillRel('execute', 'SKILL.md'),
  name: 'Execute',
  description: 'Implement the card',
  boards: ['engineering'],
  columns: [],
  prompt: 'Implement the card below.\nRun the tests before you finish.',
};

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'E-010',
    title: 'Token store',
    description: 'Persist refresh tokens',
    board: 'engineering' as BoardName,
    columnSlug: ENGINEERING_COLUMN,
    order: 10,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: 'Some detail.',
    filePath: `${ROOT}/${boardRel('engineering', ENGINEERING_COLUMN, 'E-010.md')}`,
    ...over,
  }) as Card;

const inputs = (over: Partial<PromptInputs> = {}): PromptInputs => ({
  skill,
  card: card(),
  boardColumns,
  cardFile: '---\nid: E-010\ntitle: Token store\n---\nSome detail.',
  linked: [],
  attachments: [],
  links: [],
  reportPath: `${RUNS_DIR}/r1.report.md`,
  runId: 'r1',
  projectRoot: ROOT,
  // The web layer is the default image, so the default fixture is a box that has the browser.
  browser: true,
  ...over,
});

describe('buildRunPrompt', () => {
  it('leads with the skill: its name as the heading, its body as the instruction', () => {
    const text = buildRunPrompt(inputs());
    expect(text.startsWith('# Execute\n\nImplement the card below.\nRun the tests before you finish.')).toBe(
      true,
    );
  });

  it('includes the card file verbatim, with its project-relative path', () => {
    const text = buildRunPrompt(inputs());
    expect(text).toContain('## The card: E-010');
    expect(text).toContain(`File: ${boardRel('engineering', ENGINEERING_COLUMN, 'E-010.md')}`);
    expect(text).toContain('```markdown\n---\nid: E-010\ntitle: Token store\n---\nSome detail.\n```');
  });

  it('states every column of every board, by name AND by slug', () => {
    // The whole section, exactly: this is a prompt, so the wording IS the behaviour. The agent needs
    // the name to reason with ("the backlog") and the slug to type into a path, and slugging is
    // one-way — a prompt carrying only one of the two leaves it deriving the other.
    const text = buildRunPrompt(inputs());
    expect(text).toContain(
      [
        "## The project's columns",
        '',
        'Every column this project has, by board — the name, then the folder slug you write in a path:',
        '',
        '- **features**: Backlog (backlog), Todo (todo), In Progress (in-progress), Done (done)',
        '- **product**: Backlog (backlog), Todo (todo), In Progress (in-progress), Done (done)',
        '- **engineering**: Backlog (backlog), In Progress (in-progress), Review (review), Done (done)',
      ].join('\n'),
    );
  });

  it('forbids inventing a column, and rules out the two folders that are not columns', () => {
    // The actual failure mode: asked for cards "in the right column" with no list to choose from, an
    // agent wrote to `engineering/backlog/` — and because column = folder the write CREATED it, so
    // four cards sat where readBoard never looks. `archive/` and `results/` are the next wrong guess,
    // being real folders beside the real columns.
    const text = buildRunPrompt(inputs());
    expect(text).toContain(
      'A card must go in one of the columns listed above, named by its slug. Do NOT create a new column\nfolder: a column IS a folder,',
    );
    expect(text).toContain(
      `\`${ARCHIVE_SLUG}/\` and \`${RESULTS_DIR}/\` sit beside the\ncolumns on disk but are NOT columns; no card belongs in either.`,
    );
  });

  it('lists boards the skill is NOT scoped to, because that is where it writes', () => {
    // The skill fixture is scoped to engineering and the card is an engineering card, yet features and
    // product are still listed. The seeded break-down skill is the reverse case and the reason: scoped
    // to features and product, its whole job is creating ENGINEERING cards. A prompt listing only the
    // skill's own boards would omit precisely the board being written to.
    const text = buildRunPrompt(inputs());
    expect(skill.boards).toEqual(['engineering']);
    for (const line of [
      '- **features**: Backlog (backlog)',
      '- **product**: Backlog (backlog)',
      '- **engineering**: Backlog (backlog)',
    ]) {
      expect(text).toContain(line);
    }
  });

  it('omits the section rather than promising columns it was given none of', () => {
    const text = buildRunPrompt(inputs({ boardColumns: [] }));
    expect(text).not.toContain("## The project's columns");
    expect(text).not.toContain('Do NOT create a new column');
  });

  // WHAT THE BOX HAS DEPENDS ON WHICH BOX IT IS, as of the kind split: the browser lives in the web
  // layer, so a `game` or `research` project's box is created from the base and has none. The section
  // was written when there was one image and asserted the browser unconditionally — which on those
  // projects is a prompt telling an agent a 656MB download is already done when it is not. decision 75.
  it('tells a web box it already has the browser, with the version that answers for it', () => {
    const text = buildRunPrompt(inputs({ browser: true }));
    expect(text).toContain('## What this container already has');
    expect(text).toContain(`A **Chromium for Playwright ${BOX_PLAYWRIGHT_VERSION}** is already installed`);
    expect(text).toContain(BOX_BROWSERS_PATH);
  });

  it('claims no browser to a box built from the base, and says what to do instead of fetching one', () => {
    const text = buildRunPrompt(inputs({ browser: false }));
    expect(text).toContain('## What this container already has');
    // The false claim itself, in both the forms it appears in: the sentence and the path it names.
    expect(text).not.toContain('Chromium for Playwright');
    expect(text).not.toContain('already installed');
    expect(text).not.toContain(BOX_BROWSERS_PATH);
    expect(text).toContain('No browser is installed in this container');
    // The wrapping is asserted with it: this is a prompt, so the wording IS the behaviour.
    expect(text).toContain('say so in the report rather than\ndownloading a browser');
  });

  it('puts the columns straight after the card, before the linked cards', () => {
    // Next to the one column the prompt already names — the card's own — so the example and the full
    // set are read together.
    const text = buildRunPrompt(inputs({ linked: [card({ id: 'P-001', board: 'product' })] }));
    const at = (needle: string): number => text.indexOf(needle);
    expect(at('## The card: E-010')).toBeLessThan(at("## The project's columns"));
    expect(at("## The project's columns")).toBeLessThan(at('## Linked cards'));
  });

  it('always ends with the report contract, naming the exact path', () => {
    const text = buildRunPrompt(inputs({ reportPath: `${RUNS_DIR}/xyz.report.md` }));
    expect(text).toContain('## Reporting (required)');
    expect(text).toContain(`${RUNS_DIR}/xyz.report.md`);
    expect(text).toContain('outcome: success');
    expect(text).toContain('A run with no report file counts as needing attention');
    // The contract is last: nothing may come after the instruction on how to report.
    expect(text.trimEnd().endsWith('the run record itself belongs to VibeBoard.')).toBe(true);
  });

  it('omits every optional section when there is nothing to say', () => {
    const text = buildRunPrompt(inputs());
    for (const heading of [
      '## Linked cards',
      '## Attached material',
      '## Reference links',
      '## The previous run on this card',
      '## What the user asked for',
    ]) {
      expect(text).not.toContain(heading);
    }
  });

  it('identifies every linked card with its board, column and file', () => {
    const text = buildRunPrompt(
      inputs({
        linked: [
          card({
            id: 'F-002',
            board: 'features',
            columnSlug: 'todo',
            title: 'Auth',
            description: undefined,
            filePath: `${ROOT}/${boardRel('features', 'todo', 'F-002.md')}`,
            body: '',
          }),
        ],
      }),
    );
    expect(text).toContain('- **F-002** (features/todo) — Auth');
    expect(text).toContain(`file: ${boardRel('features', 'todo', 'F-002.md')}`);
  });

  it('quotes a linked PRODUCT card in full, because it carries the intent', () => {
    // An engineering card carries the mechanics; the product card says why. That is the thing an
    // agent is least likely to go and read on its own.
    const text = buildRunPrompt(
      inputs({
        linked: [
          card({
            id: 'P-001',
            board: 'product',
            columnSlug: 'in-progress',
            title: 'Stay signed in',
            body: 'Users lose their session daily.',
            filePath: `${ROOT}/${boardRel('product', 'in-progress', 'P-001.md')}`,
          }),
          card({
            id: 'E-011',
            board: 'engineering',
            columnSlug: 'review',
            title: 'Rotate keys',
            body: 'Rotate on the hour.',
            filePath: `${ROOT}/${boardRel('engineering', 'review', 'E-011.md')}`,
          }),
        ],
      }),
    );
    expect(text).toContain('### P-001 — Stay signed in\n\nUsers lose their session daily.');
    // The engineering card is listed but not quoted — its file path is enough.
    expect(text).toContain('- **E-011** (engineering/review) — Rotate keys');
    expect(text).not.toContain('Rotate on the hour.');
  });

  it('skips the quote for a product card with an empty body', () => {
    const text = buildRunPrompt(
      inputs({ linked: [card({ id: 'P-002', board: 'product', title: 'Empty', body: '   ' })] }),
    );
    expect(text).toContain('- **P-002**');
    expect(text).not.toContain('### P-002');
  });

  it('passes attachments as paths, not content', () => {
    const text = buildRunPrompt(inputs({ attachments: [`${DOCS_DIR}/api.md`, `${RESOURCES_DIR}/spec.md`] }));
    expect(text).toContain('## Attached material');
    expect(text).toContain(`- ${DOCS_DIR}/api.md`);
    expect(text).toContain(`- ${RESOURCES_DIR}/spec.md`);
  });

  it('renders reference links as links', () => {
    const text = buildRunPrompt(inputs({ links: [{ title: 'RFC 6749', url: 'https://example.test/rfc' }] }));
    expect(text).toContain('- [RFC 6749](https://example.test/rfc)');
  });

  it('carries the previous run report so an iteration does not start cold', () => {
    const text = buildRunPrompt(
      inputs({
        previous: {
          run: 'R-EARLIER',
          skill: 'implement',
          status: 'success',
          report: '## What I found\n\nThree cards, not one.',
        },
      }),
    );
    expect(text).toContain('## The previous run on this card');
    expect(text).toContain('This continues earlier work.');
    expect(text).toContain('Three cards, not one.');
  });

  // PREMISE CHANGED, deliberately (2026-08-06). This used to assert that a previous run with no report got no
  // section at all — the guard was against an empty heading. A run that produced NO report is now the case the
  // section exists for, so the property is restated rather than dropped: the section is never empty, because
  // how the run ended is itself the evidence.
  it('says a previous run wrote no report, rather than saying nothing about it', () => {
    const text = buildRunPrompt(
      inputs({
        previous: { run: 'R-EARLIER', skill: 'implement', status: 'failed', report: '   \n  ' },
      }),
    );
    expect(text).toContain('## The previous run on this card');
    expect(text).toContain('R-EARLIER');
    expect(text).toContain('`failed`');
    expect(text).toContain('It wrote no report.');
  });

  it('puts the user prompt last of the context, immediately before the contract', () => {
    // It is the most specific instruction in the prompt; buried above the card it competes with
    // the skill instead of qualifying it.
    const text = buildRunPrompt(
      inputs({
        userPrompt: 'only the token store',
        linked: [card({ id: 'P-001', board: 'product' })],
        attachments: [`${DOCS_DIR}/a.md`],
        previous: { run: 'R-EARLIER', skill: 'implement', status: 'success', report: 'earlier' },
      }),
    );
    const at = (needle: string): number => text.indexOf(needle);
    expect(at('## The card: E-010')).toBeLessThan(at('## Linked cards'));
    expect(at('## Linked cards')).toBeLessThan(at('## Attached material'));
    expect(at('## Attached material')).toBeLessThan(at('## The previous run on this card'));
    expect(at('## The previous run on this card')).toBeLessThan(
      at('## What the user asked for on top of the skill'),
    );
    expect(at('## What the user asked for on top of the skill')).toBeLessThan(at('## Reporting (required)'));
    expect(text).toContain('only the token store');
  });

  it('ignores a blank user prompt', () => {
    expect(buildRunPrompt(inputs({ userPrompt: '  ' }))).not.toContain('## What the user asked for');
  });

  it('says nothing about VIBEBOARD.md or INSTRUCTIONS.md', () => {
    // Both are already appended to the system prompt by agent-turn.ts. Repeating them here would
    // pay twice for the same words.
    const text = buildRunPrompt(inputs());
    // The basenames, not the constants: a mention without the `.vibeboard/` prefix is still a
    // mention, and the two documents kept their names when they moved.
    expect(text).not.toContain('VIBEBOARD.md');
    expect(text).not.toContain('INSTRUCTIONS.md');
  });
});

// The credential is the only way an agent can change the board once the sandbox lands, and it
// cannot arrive by environment variable: the OpenCode backend is one long-lived `opencode serve`
// spawned before any run exists, so its environment is fixed. It travels in the prompt instead.
describe('the run credential', () => {
  it('names the token and the base URL when the run has one', () => {
    const text = buildRunPrompt(
      inputs({ credential: { token: 'tok-123', apiBase: 'http://127.0.0.1:4610', scope: 'work' as const } }),
    );
    expect(text).toContain('tok-123');
    expect(text).toContain('http://127.0.0.1:4610');
  });

  it('says nothing about credentials when the run has none', () => {
    // A heading promising a credential above no token would send the agent looking for one.
    const text = buildRunPrompt(inputs());
    expect(text.toLowerCase()).not.toContain('credential');
  });

  it('tells the agent which card its credential is confined to', () => {
    // Confinement is enforced server-side, but an agent that does not know about it reads a 403 as
    // a broken tool and starts writing files instead.
    const text = buildRunPrompt(
      inputs({ credential: { token: 'tok', apiBase: 'http://x', scope: 'work' as const } }),
    );
    expect(text).toContain('E-010');
  });
});

// THE ASSEMBLED PROMPT AGAINST THE SCOPE TABLE, which nothing else in the tree checks. Two tests come
// close and neither covers it: `test/copilot-authority.test.ts` asserts `endpointsFor`'s output without
// ever building a prompt, and `test/lifecycle-trace.test.ts` drives the loop end to end without reading
// one. So a section dropped from the assembly, or the wrong `scope` handed to the generator, changes the
// list of endpoints an agent is TOLD it may call and nothing fails.
//
// It is not privilege escalation — `allows()` still fails closed on every request — which is exactly what
// makes it hard to find. The agent is told it may call something it may not, tries it, gets a 403 it reads
// as a broken tool, and falls back to writing card files into folders no column maps to.
//
// Asserted in BOTH directions, and the two are different questions. FORWARDS through `allows()`, the
// enforcement function itself, so every endpoint the prompt names is one the table would really permit.
// BACKWARDS against `endpointsFor` as exact bytes in order, so a row the scope holds and the prompt omits
// fails too: a catalogue that is merely a subset denies a run authority it was minted with, and an agent
// denied the endpoint does the job by writing files instead.
describe('the endpoint catalogue the assembled prompt hands an agent', () => {
  // The generated catalogue is the only place the prompt puts a method and a route inside one backtick
  // pair at the head of a list item. Anchored for that reason: `GET /api/state` is also named in the
  // prose sentence below the list, and counting that as a granted row would make the comparison lie.
  const CATALOGUE_LINE = /^- `([A-Z]+) (\/\S*)` — /;
  const catalogue = (prompt: string): string[] =>
    prompt.split('\n').filter((line) => CATALOGUE_LINE.test(line));

  // The scopes a RUN can be dispatched under. `assist` is the copilot's, which has its own section below,
  // and `admin` is a person rather than a run.
  const RUN_SCOPES: Scope[] = ['work', 'checkup', 'service'];

  const cred = (scope: Scope, card?: string): Credential => ({ token: 'T', scope, project: ROOT, card });

  const withCredential = (scope: Scope, over: Partial<PromptInputs> = {}): PromptInputs =>
    inputs({ credential: { token: 'T', apiBase: 'http://127.0.0.1:4610', scope }, ...over });

  for (const scope of RUN_SCOPES) {
    it(`hands a ${scope} run exactly the rows the table grants it, in the table's own order`, () => {
      const lines = catalogue(buildRunPrompt(withCredential(scope)));
      // An empty catalogue satisfies every per-line assertion below vacuously, and losing the section is
      // the regression this whole describe exists for — so the count is asserted first, every time.
      expect(lines.length).toBeGreaterThan(0);
      expect(lines).toEqual(endpointsFor(scope, 'E-010'));
    });

    it(`names a ${scope} run nothing the table would refuse it`, () => {
      const lines = catalogue(buildRunPrompt(withCredential(scope)));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const [, method, url] = CATALOGUE_LINE.exec(line) as RegExpExecArray;
        expect(allows(cred(scope, 'E-010'), method, url, ROOT, 'E-010'), `${scope}: ${line}`).toBe(true);
      }
    });
  }

  // A PROJECT run is `work` scope with no card at all, and `allows` denies the own-card rows to a
  // credential minted without one. So they are left out rather than listed unconfined, and this asserts
  // the omission is exactly the table's — not one row more, not one fewer.
  it('drops the card-confined rows for a project run, and only those', () => {
    const { card: _card, cardFile: _cardFile, ...rest } = withCredential('work');
    const lines = catalogue(buildRunPrompt(rest as PromptInputs));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines).toEqual(endpointsFor('work', undefined));
    for (const line of lines) {
      const [, method, url] = CATALOGUE_LINE.exec(line) as RegExpExecArray;
      expect(allows(cred('work'), method, url, ROOT, undefined), line).toBe(true);
    }
  });

  // A judging run goes down the ordinary run path and is minted `work` like any other card run. What stops
  // it changing the board is that it is handed NO catalogue at all — so the empty list IS the property, and
  // one line appearing here is a judge told it may edit the thing it is judging.
  it('hands a judging run no endpoint whatsoever', () => {
    const prompt = buildRunPrompt(
      withCredential('work', { review: { gatesPassed: true, setupSubtree: false } }),
    );
    expect(catalogue(prompt)).toEqual([]);
  });

  // The copilot's section, the same generator's fourth caller and the only one reaching the foundation
  // write. Asserted the same way in both directions, because its authority is a row in the same table.
  it('hands the copilot exactly what the assist scope grants, and nothing it would be refused', () => {
    const lines = catalogue(assistCredentialSection('http://127.0.0.1:4610', 'T'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines).toEqual(endpointsFor('assist'));
    for (const line of lines) {
      const [, method, url] = CATALOGUE_LINE.exec(line) as RegExpExecArray;
      expect(allows(cred('assist', 'E-010'), method, url, ROOT, 'E-010'), line).toBe(true);
    }
  });
});

// The documents a run is bound by. Four as paths — the agent has a Read tool, and inlining one it may
// not need is tokens spent on nothing — and the gates in full, because an agent asked to go and
// fetch the bar will sometimes not bother.
describe('the foundation section', () => {
  const foundation = {
    paths: ['.vibeboard/foundation/STACK.md', '.vibeboard/foundation/CODE-QUALITY.md'],
    codeQuality: '---\ngates:\n  - name: tests\n    command: npm test\n---\nThe bar.',
  };

  it('lists the documents by path and inlines the gates', () => {
    const text = buildRunPrompt(inputs({ foundation }));
    expect(text).toContain("## The project's foundation");
    expect(text).toContain('- .vibeboard/foundation/STACK.md');
    expect(text).toContain('command: npm test');
  });

  it('says they are binding and read-only, not background reading', () => {
    const text = buildRunPrompt(inputs({ foundation }));
    expect(text).toContain('These decisions are already made for this project.');
    // An agent that does not know the denial is coming reads a permission error as a broken tool.
    expect(text).toContain('read-only to you at the operating-system level');
  });

  it('says nothing at all when the project has no foundation yet', () => {
    expect(buildRunPrompt(inputs())).not.toContain('foundation');
    // An empty list is the same lie as a heading over nothing.
    expect(buildRunPrompt(inputs({ foundation: { paths: [] } }))).not.toContain('foundation');
  });

  it('omits the gates block when CODE-QUALITY.md is not among them', () => {
    const text = buildRunPrompt(inputs({ foundation: { paths: ['.vibeboard/foundation/UX.md'] } }));
    expect(text).toContain('- .vibeboard/foundation/UX.md');
    expect(text).not.toContain('The gates your work must pass');
  });

  // Before the card's links and everything after them: the stack and the gates are the frame the
  // work is read inside, and a constraint met after the task has been described is one the agent has
  // already reasoned past.
  it('comes after the columns and before the linked cards', () => {
    const text = buildRunPrompt(
      inputs({ foundation, linked: [card({ id: 'P-001', board: 'product', title: 'Why' })] }),
    );
    expect(text.indexOf("## The project's columns")).toBeLessThan(
      text.indexOf("## The project's foundation"),
    );
    expect(text.indexOf("## The project's foundation")).toBeLessThan(text.indexOf('## Linked cards'));
  });
});

// A run asked to JUDGE rather than to build, and WHICH RUN it is judging. `inputs(over)` above is this
// file's fixture function. The critic's own half of this describe — a score, and the threshold stated for it
// to calibrate against — went with decision 40; everything here is about the judged-run section and the
// preamble, which the surviving review contract shares.
describe('the judging contract', () => {
  const judging = () => buildRunPrompt(inputs({ review: { gatesPassed: true, setupSubtree: false } }));

  // The judge must not fix what it is judging, or the verdict becomes an opinion about its own work.
  it('tells a judging run to change nothing', () => {
    expect(judging()).toMatch(/change nothing/i);
  });

  // The two contracts are ALTERNATIVES. Both present, a judging run would be told to report an
  // outcome and to score, and whichever heading it read first would decide what it wrote.
  it('replaces the ordinary reporting contract rather than adding to it', () => {
    const text = judging();
    expect(text).toContain('## Judging (required)');
    expect(text).not.toContain('## Reporting (required)');
  });

  it('still tells it where to write, in the one place that is not the run record', () => {
    expect(judging()).toContain(`${RUNS_DIR}/r1.report.md`);
  });

  // THE FIRST HAND-RUN (2026-08-06). A critic dispatched after a `break-down` run that died with
  // `[opencode failed: fetch failed]` scored the card 1 — and said in its own report: "I did not mark down
  // the later, separate break-down run … that is a different card's task." It had never been told which run
  // it was judging, so it judged the PREVIOUS, successful one, and a card advanced on a run that exited 1.
  const judgingRun = (over: Partial<NonNullable<PromptInputs['previous']>> = {}) =>
    buildRunPrompt(
      inputs({
        review: { gatesPassed: true, setupSubtree: false },
        previous: { run: 'R-JUDGED', skill: 'break-down', status: 'failed', ...over },
      }),
    );

  it('names the one run it is judging', () => {
    const text = judgingRun();
    expect(text).toContain('## The run you are judging');
    expect(text).toContain('R-JUDGED');
    // Not the hand-over wording: "this continues earlier work" invites a judge to treat that work as its own.
    expect(text).not.toContain('This continues earlier work.');
  });

  // THE CONTRACT SENTENCE, asserted separately from the section above it. A review found that every assertion
  // here was satisfied by strings `previousSection` renders — the run id, the heading — so the whole of
  // `judgedLines` could be deleted with the full suite green. The instruction and the evidence are two
  // different things and need two different tests.
  it('tells the judge to judge that one run and nothing else', () => {
    expect(judgingRun()).toMatch(/judging ONE run: \*\*R-JUDGED\*\*/);
    expect(judgingRun()).toMatch(/Judge what THAT\nrun did, and nothing else/);
  });

  it('tells it that an earlier run’s success is not this run’s', () => {
    expect(judgingRun()).toMatch(/is not this run’s work/i);
  });

  // The rule that would have caught the hand-run — but as a CONJUNCTION. Written as "it failed, it wrote no
  // report, or it changed no files", it told a judge to score 0 whenever the judged run changed no files, and
  // zero files is the SUCCESSFUL shape of every card-producing skill: cards go through the API, so
  // derive-features and break-down all legitimately touch nothing on disk. Caught in review; the exact bytes
  // are asserted, because this is a rule whose meaning turns on one word.
  it('tells it to send back nothing at all, and only nothing at all', () => {
    const text = judgingRun();
    expect(text).toContain(
      'it failed AND wrote no report AND produced\nnothing — then the verdict is `sent-back`, however good the card looks otherwise.',
    );
    expect(text).not.toMatch(/or it changed no/i);
  });

  // The other half of the same correction, stated positively so a future edit cannot quietly reinstate a
  // files-based rule: the prompt has to say that zero files is not zero work.
  it('tells it that a run which changed no files may still have produced something', () => {
    const text = judgingRun({ status: 'success', filesChanged: 0 });
    expect(text).toContain('It changed 0 files.');
    expect(text).toMatch(/has not necessarily done nothing/i);
    expect(text).toMatch(/never how many files it touched/i);
  });

  // The evidence, when there is no report to read: how it ended, what VibeBoard noted, what it changed.
  it('shows how a failed run ended when it left no report behind', () => {
    const text = judgingRun({ note: 'The agent exited with code 1 and wrote no report.', filesChanged: 0 });
    expect(text).toContain('`failed`');
    expect(text).toContain('It changed 0 files.');
    expect(text).toContain('The agent exited with code 1 and wrote no report.');
    expect(text).toContain('It wrote no report.');
  });

  // A review a person dispatches from the card has no run under judgement, and the general wording is right
  // for it. A sentence naming a run that was never passed would be worse than no sentence.
  it('names no run when there is none, rather than inventing one', () => {
    const text = judging();
    expect(text).not.toContain('## The run you are judging');
    expect(text).toMatch(/change nothing/i);
  });

  // The token is still named, because the run has one and an agent that finds a credential in its
  // environment with no explanation is an agent that will experiment with it. The half of this that
  // asserted a judge is NOT also handed "Changing the board" lives in the review contract's own
  // 'grants a review run nothing on the board' — one statement of it, not two.
  it('says what its credential is for, and that changing the board is not it', () => {
    const text = buildRunPrompt(
      inputs({
        review: { gatesPassed: true, setupSubtree: false },
        credential: { token: 'T', apiBase: 'http://127.0.0.1:4610', scope: 'work' as const },
      }),
    );
    expect(text).toContain('## Your credential');
    expect(text).toMatch(/read/i);
  });

  // An ordinary run is unaffected: it still gets the endpoints it needs to do its job.
  it('leaves a working run’s board instructions alone', () => {
    const text = buildRunPrompt(
      inputs({ credential: { token: 'T', apiBase: 'http://127.0.0.1:4610', scope: 'work' as const } }),
    );
    expect(text).toContain('## Changing the board (required)');
    expect(text).toContain('POST /api/cards');
  });
});

// WHAT A `fix` RUN IS TOLD ABOUT WHY ITS CARD CAME BACK. Spec §6: a `fix` receives "the failing verdict —
// either a gate's own command and output, or the reviewer's findings — rendered from the `previous` run".
//
// A fix that is not told what failed will GUESS, and that makes the review loop a random walk bounded only by
// `attemptCap`: the review sends it back, the fix changes something unrelated, the review sends it back again,
// three times, and the task is blocked for a reason nobody can read.
describe('the failing verdict a fix run is handed', () => {
  const withVerdict = (verification: Verification, over: Record<string, unknown> = {}) =>
    buildRunPrompt(
      inputs({
        previous: { run: 'IMPL-1', skill: 'implement', status: 'success', verification, ...over },
      }),
    );

  it('tells a fix run which gate failed and what it printed', () => {
    const prompt = withVerdict({
      mode: 'gates',
      passed: false,
      at: 'T',
      command: 'npm test',
      output: 'Tests  1 failed | 40 passed',
      reason: '`npm test` exited with 1.',
    });
    expect(prompt).toContain('npm test');
    expect(prompt).toContain('Tests  1 failed | 40 passed');
    expect(prompt).toContain('`npm test` exited with 1.');
  });

  it('tells a fix run what the reviewer asked for when no gate failed', () => {
    // The OTHER rendering, and it needs its own test: a gate failure carries a command and a review carries
    // words, so a single assertion over either would pass with the other half deleted.
    const prompt = withVerdict({
      mode: 'review',
      passed: false,
      at: 'T',
      by: 'REV-1',
      reason: 'the --json flag is parsed but never used',
    });
    expect(prompt).toContain('the --json flag is parsed but never used');
    // And the run whose report holds the findings in full, so a fix that needs more can go and read them.
    expect(prompt).toContain('REV-1');
  });

  it('says which of the two sent it back, so the fix knows what kind of failure it is', () => {
    // A failing command and a reviewer's opinion are different things to address, and a fix told only "this
    // failed" cannot tell whether to make a test pass or to change what the code does.
    expect(withVerdict({ mode: 'gates', passed: false, at: 'T', command: 'npm test' })).toMatch(/gates/i);
    expect(
      withVerdict({ mode: 'review', passed: false, at: 'T', reason: 'not what the card asked' }),
    ).toMatch(/review/i);
  });

  it('does not describe a passing verdict as something to fix', () => {
    const prompt = withVerdict({ mode: 'review', passed: true, at: 'T', by: 'REV-1' });
    expect(prompt).not.toMatch(/did NOT pass/);
    expect(prompt).toMatch(/passed/i);
  });

  it('renders nothing about a verdict when the previous run carries none', () => {
    // The ordinary hand-over case: a run that continues earlier work, with nothing yet decided about it.
    const prompt = buildRunPrompt(
      inputs({ previous: { run: 'IMPL-1', skill: 'implement', status: 'success' } }),
    );
    expect(prompt).not.toMatch(/did NOT pass/);
    expect(prompt).toContain('This continues earlier work.');
  });
});

// THE REVIEW CONTRACT. Decision 51's second step: the loop has already run the gates, and a model is asked
// only for what a command's exit code cannot express — does this do what the card asked.
//
// Asserted on the CONTRACT, never on what a neighbouring section happens to render. A review found every
// assertion about the judging contract satisfied by strings the evidence section produced, which made the
// contract itself deletable with the suite green.
describe('the review contract', () => {
  const reviewing = (over: Partial<NonNullable<PromptInputs['review']>> = {}) =>
    buildRunPrompt(
      inputs({
        review: { gatesPassed: true, setupSubtree: false, ...over },
        previous: { run: 'RUN-2', skill: 'implement', status: 'success' },
      }),
    );

  it('asks a review run for a verdict, and names both values', () => {
    const prompt = reviewing();
    expect(prompt).toContain('verdict: done');
    expect(prompt).toContain('sent-back');
    // A review that stays silent has decided nothing, and an absent verdict is what the review bound counts.
    expect(prompt).toContain('A report with no `verdict` cannot pass anything');
  });

  it('names the ONE run under judgement', () => {
    expect(reviewing()).toContain('You are judging ONE run: **RUN-2**');
  });

  // `story-review` KEEPS THE CHECKUP'S AUTHORITY TO WRITE SIBLING STORIES (decision 80), and its skill body
  // asks it to list what it created — which this frontmatter gave it no field for, so `ActiveReport` showed
  // no created cards for the one judging phase allowed to create any.
  it('gives a review somewhere to name the cards it created', () => {
    expect(reviewing()).toContain('created: [P-041]');
  });

  // DECISION 51'S TWO STEPS, and the reviewer has to be told the first one happened: a judge that does not
  // know the suite is already green spends its turn running it again.
  it('tells the review run the gates have already passed', () => {
    expect(reviewing()).toContain('gates have already passed');
  });

  it('states the setup-subtree exception only when the card is in it', () => {
    // The exception the old spec asserted and never built: `verify` was a property of a route, so it could
    // not vary per feature. Installing the test runner is what a setup card is FOR, so an absent gate set is
    // expected there and the judgement is by reading.
    const inSetup = reviewing({ setupSubtree: true });
    expect(inSetup).toContain('no gate set yet');
    expect(inSetup).toContain('the judgement is by reading');
    const ordinary = reviewing();
    expect(ordinary).not.toContain('no gate set yet');
    // And the two are exclusive: a setup card with nothing to run must not also be told the suite is green.
    expect(inSetup).not.toContain('gates have already passed');
  });

  // The honest third state. A person dispatching a review by hand gets no gate result, because those two
  // facts are the loop's and are refused from every other scope (ruling 63) — so the prompt says so rather
  // than implying a pass nobody produced.
  it('says plainly when nothing has run the gates', () => {
    const prompt = reviewing({ gatesPassed: false });
    expect(prompt).not.toContain('gates have already passed');
    expect(prompt).toMatch(/nobody has run the gates/i);
  });

  it('grants a review run nothing on the board', () => {
    const prompt = buildRunPrompt(
      inputs({
        review: { gatesPassed: true, setupSubtree: false },
        credential: { token: 'T', apiBase: 'http://127.0.0.1:4610', scope: 'work' as const },
      }),
    );
    expect(prompt).toContain('## Your credential');
    expect(prompt).not.toContain('## Changing the board (required)');
    expect(prompt).not.toContain('PATCH /api/cards');
    expect(prompt).not.toContain('POST /api/cards');
  });

  it('replaces the ordinary reporting contract rather than adding to it', () => {
    const prompt = reviewing();
    expect(prompt).toContain('## Judging (required)');
    expect(prompt).not.toContain('## Reporting (required)');
  });

  // ONE CONTRACT OR THE OTHER, NEVER BOTH: whichever heading a run read first would decide what it wrote.
  it('asks an ordinary run for an outcome and never for a verdict', () => {
    const prompt = buildRunPrompt(inputs());
    expect(prompt).toContain('outcome: success');
    expect(prompt).not.toContain('verdict:');
  });

  it('renders nothing about a review for any other run', () => {
    const prompt = buildRunPrompt(inputs());
    expect(prompt).not.toContain('gates have already passed');
    expect(prompt).not.toContain('no gate set yet');
  });

  // Over-delivery passes (decision 5). Failing a card for it throws away working code and spends an attempt
  // rebuilding it.
  it('tells the reviewer that work doing MORE than the card asked still passes', () => {
    expect(reviewing()).toMatch(/does MORE/);
  });
});

// THE CHECKUP'S EVIDENCE, ASSEMBLED BY THE LOOP (ruling 60). Three of the four inputs a checkup needs are
// unreachable from the `work` scope every card run is minted with — `GET /api/suggestions`, `GET /api/runs` and
// the diary, which has no read row at all — and widening the table would grant an agent authority to solve a
// problem the loop can solve. So the loop gathers them and puts them here.
describe('the checkup’s evidence', () => {
  const evidence = (over: Partial<NonNullable<PromptInputs['checkup']>> = {}) => ({
    children: [
      { id: 'E-001', column: 'done', outcome: 'success', blocked: false },
      { id: 'E-002', column: 'blocked', outcome: 'failed', blocked: true },
    ],
    blocked: ['E-002'],
    suggestions: [{ id: 'S-1', title: 'the config loader has no tests' }],
    ...over,
  });

  const checkingUp = (over: Partial<NonNullable<PromptInputs['checkup']>> = {}) =>
    buildRunPrompt(inputs({ checkup: evidence(over) }));

  it('lists every child with its column and whether it is blocked', () => {
    const prompt = checkingUp();
    expect(prompt).toContain('E-001');
    expect(prompt).toContain('done');
    expect(prompt).toContain('E-002');
    // How its last run ended, which is the fact `GET /api/runs` would have been asked for.
    expect(prompt).toContain('success');
    expect(prompt).toContain('failed');
  });

  it('names the blocked children separately, so the report can name them without being asked', () => {
    // A checkup told only the columns would have to know which slug means blocked, which is a config fact it
    // has no way to read. Named as a list, it can name them in its report without being asked to work it out.
    const prompt = checkingUp();
    expect(prompt).toMatch(/blocked and waiting for a person: E-002/i);
  });

  it('says so plainly when nothing under the card is blocked', () => {
    // An empty list rendered as a heading over nothing would read as "the blocked ones are missing from this
    // prompt" rather than "there are none".
    const prompt = checkingUp({ blocked: [], children: [{ id: 'E-001', column: 'done', blocked: false }] });
    expect(prompt).toMatch(/nothing under this card is blocked/i);
    expect(prompt).not.toMatch(/blocked and waiting for a person:/i);
  });

  it('lists the open suggestions', () => {
    expect(checkingUp()).toContain('the config loader has no tests');
  });

  it('says there are no open suggestions rather than leaving the reader to wonder', () => {
    expect(checkingUp({ suggestions: [] })).toMatch(/no open suggestions/i);
  });

  // RULING 55, with the shape ruling of 2026-08-13: the smoke result is a `Verification`, the same shape the
  // gate evidence wears, because "a command ran and here is what happened" is one fact and not two.
  it('renders the smoke result with its command and its output', () => {
    const prompt = checkingUp({
      smoke: {
        mode: 'smoke',
        passed: false,
        at: 'T',
        command: 'npm run smoke',
        output: 'Error: no such flag --json',
        reason: '`npm run smoke` exited with 1.',
      },
    });
    expect(prompt).toContain('npm run smoke');
    expect(prompt).toContain('Error: no such flag --json');
  });

  it('says the smoke command could not be run rather than implying it passed', () => {
    // `reason` is what carries the three endings apart: a command that was KILLED, one that could not be
    // spawned, and one that exited non-zero are different facts, and the first two are not failures of the
    // code. `commandReason` writes them (core/verify.ts), and this prompt shows them.
    const prompt = checkingUp({
      smoke: { mode: 'smoke', passed: false, at: 'T', reason: 'foundation/TESTING.md declares no command.' },
    });
    expect(prompt).toContain('foundation/TESTING.md declares no command.');
    expect(prompt).not.toMatch(/the smoke command passed/i);
  });

  it('says the smoke command passed when it did', () => {
    expect(checkingUp({ smoke: { mode: 'smoke', passed: true, at: 'T' } })).toMatch(
      /the smoke command passed/i,
    );
  });

  // RULING 55 STILL HOLDS FOR A PASSING SMOKE: the model is told what the command did and decides what it means.
  it('leaves a passing smoke to the checkup to interpret', () => {
    expect(checkingUp({ smoke: { mode: 'smoke', passed: true, at: 'T' } })).toMatch(
      /what it means is yours to decide/i,
    );
  });

  // DECISION 69 CHANGED THE FAILING HALF, and this pins the change rather than the wording: a failed smoke is
  // no longer an invitation to interpret. The premise of the test this replaces — "does not tell the checkup
  // what the smoke result means" — is the defect: told to decide, models decided "environmental".
  it('asks a failed smoke to be carded rather than interpreted, on the last feature', () => {
    const prompt = checkingUp({
      smokeGates: true,
      smoke: {
        mode: 'smoke',
        passed: false,
        at: 'T',
        command: 'npm run smoke',
        output: 'Expected 56. got 3.',
      },
    });
    expect(prompt).toMatch(/create one card for each distinct/i);
    expect(prompt).toMatch(/this feature is\s+not finished/i);
    // The output is quoted, because a card written from the real strings reproduces the failure.
    expect(prompt).toContain('Expected 56. got 3.');
    // AND THE INVITATION IS GONE. Without this the new sentences could sit beside the old one and both ship.
    expect(prompt).not.toMatch(/what it means is yours to decide/i);
  });

  // THE BOARD THAT DEMAND NAMES, and it was wrong — the whole mechanism decision 69 built was dead on the
  // only branch that reaches it.
  //
  // `smokeSection` told the checkup to file its findings "on the engineering board". `feature-checkup`
  // declares `creates: 'product'`, and `wrongBoardForRun` (server/boards/cards-routes.ts) enforces exactly
  // that field — so the server refused every card the instruction asked for. The agent created nothing,
  // `boardGrew` was false, decision 69 held the feature open, and the round repeated to the attempt cap.
  //
  // Widening `creates` to engineering is NOT the fix: `derivePosition` walks feature -> story -> task, so an
  // engineering card parented to a feature is an orphan no phase picks up (service/act/outcomes.ts:32).
  //
  // ASSERTED AGAINST THE PHASE TABLE rather than against the string `product`, which is the point of the fix:
  // the prompt now reads the same field the server enforces, so the two cannot drift apart again. A test
  // naming the board itself would be a third copy of the fact, and a third place for it to go wrong.
  it('names the board its own phase may create on, and no other', () => {
    const prompt = checkingUp({
      smokeGates: true,
      smoke: {
        mode: 'smoke',
        passed: false,
        at: 'T',
        command: 'npm run smoke',
        output: 'Expected 56. got 3.',
      },
    });
    const creates = phase('feature-checkup').creates;
    expect(creates).toBeDefined();
    expect(prompt).toContain(`on the ${creates} board`);
    // Not a hardcoded `engineering`: any board but its own is wrong for the same reason, and enumerating
    // them means a future change to the table cannot leave a stale name behind unnoticed.
    for (const other of BOARDS.filter((b) => b !== creates)) {
      expect(prompt).not.toContain(`on the ${other} board`);
    }
  });

  // THE SCOPE OF THAT DEMAND, learned from a greenfield run that stalled three times. A feature whose own
  // work is finished must not be told it is unfinished because a command about the WHOLE product failed on
  // work a later feature owns — a checkup told that spends its one round of creation justifying staying open.
  it('tells a feature that is not the last one that a red smoke is expected', () => {
    const prompt = checkingUp({
      smoke: { mode: 'smoke', passed: false, at: 'T', command: 'npm run smoke', output: 'MODULE_NOT_FOUND' },
    });
    expect(prompt).toMatch(/not, on its own, a reason to keep this feature open/i);
    expect(prompt).toMatch(/expected to fail until the last of them\s+lands/i);
    // The evidence is still handed over — ruling 55's half that stands.
    expect(prompt).toContain('MODULE_NOT_FOUND');
    // And the demanding language is absent, or both would ship and the reader would follow the louder one.
    expect(prompt).not.toMatch(/this feature is\s+not finished/i);
    expect(prompt).not.toMatch(/create one card for each distinct/i);
  });

  it('omits the smoke section entirely for a story checkup', () => {
    // A heading over nothing is worse than no heading — the rule this file already follows. A story checkup
    // has no smoke command to run, so there is nothing to say about one.
    const prompt = checkingUp();
    expect(prompt).not.toContain('The smoke command');
  });

  // RULING 66'S SECOND FIX. A project reached `complete` with every gate green and the tool it built printed
  // nothing: every layer was asking whether the tasks were done, and they were. This is the only run that
  // sees a whole feature against the brief, so it is the only one that can be asked the other question.
  it('asks the FEATURE checkup whether the thing can be used as the README says', () => {
    const prompt = checkingUp({ feature: true });
    expect(prompt).toContain('The question this checkup exists for');
    expect(prompt).toMatch(/can someone use this the way the README says/i);
    // And it names what an answer is NOT, because "the tasks are done" was the answer that shipped.
    expect(prompt).toMatch(/is \*\*not\*\* the answer/i);
    expect(prompt).toMatch(/"The tests pass" is not an answer/i);
  });

  // THE HALF THAT MAKES IT MEAN SOMETHING. A story checkup is about the stories under it, and this question
  // is about a whole feature against the README — put to the wrong run it is noise, and noise in a prompt is
  // how a run learns to skim the parts that matter.
  it('does NOT ask it of a story checkup', () => {
    expect(checkingUp()).not.toContain('The question this checkup exists for');
  });

  // AND IT IS NOT INFERRED FROM THE SMOKE RESULT, which is the tempting shortcut and is wrong in the
  // direction that matters: a project declaring no smoke command has no smoke evidence, and that is exactly
  // the project where nothing else is asking whether the thing runs.
  it('asks it of a feature checkup that has no smoke command at all', () => {
    const prompt = checkingUp({ feature: true });
    expect(prompt).not.toContain('The smoke command');
    expect(prompt).toContain('The question this checkup exists for');
  });

  // LAST OF THE THREE SECTIONS: the children and the smoke evidence are already in view when the question is
  // put, which is the exact combination that was mistaken for an answer.
  it('puts the question after the evidence, not before it', () => {
    const prompt = checkingUp({ feature: true, smoke: { mode: 'smoke', passed: true, at: 'T' } });
    expect(prompt.indexOf('The question this checkup exists for')).toBeGreaterThan(
      prompt.indexOf('The smoke command'),
    );
    expect(prompt.indexOf('The smoke command')).toBeGreaterThan(prompt.indexOf('What is under this card'));
  });

  it('renders nothing about a checkup for any other run', () => {
    const prompt = buildRunPrompt(inputs());
    expect(prompt).not.toContain('What is under this card');
    expect(prompt).not.toContain('The smoke command');
  });

  it('does not tell a checkup to fetch any of it', () => {
    // It cannot: `work` scope reaches none of those endpoints. A prompt that asked would produce 403s and an
    // agent that concludes the tools are broken.
    const prompt = checkingUp();
    expect(prompt).not.toContain('GET /api/suggestions');
    expect(prompt).not.toContain('GET /api/runs');
  });
});

// A run about the PROJECT: no card, and therefore no card section. The absence has to be STATED — a prompt
// that simply lacks the card heading is indistinguishable from one that lost it, and an agent reading a skill
// written for a per-card dispatch will otherwise hunt for the card or invent one.
describe('buildRunPrompt with no card', () => {
  const project = (over: Partial<PromptInputs> = {}): PromptInputs => {
    const { card: _card, cardFile: _cardFile, ...rest } = inputs(over);
    return rest as PromptInputs;
  };

  it('says there is no card, in place of the card section', () => {
    const text = buildRunPrompt(project());
    expect(text).toContain('## This run is about the project, not a card');
    expect(text).not.toContain('## The card:');
    expect(text).toContain('There is no card.');
  });

  it('names the README as the brief, which is the only subject it has', () => {
    expect(buildRunPrompt(project())).toContain('README at the project root is the brief');
  });

  // The awkward half, and the reason this is prose rather than an omission: the seeded skills say "the column
  // this card is in" and "the card below", and rewording every one of them would be five copies of one fact.
  it('fixes how a card-shaped instruction should be read, so the agent invents nothing', () => {
    const text = buildRunPrompt(project());
    expect(text).toContain('do not invent a card to stand in for one');
  });

  it('still states every column, because it has cards to create', () => {
    expect(buildRunPrompt(project())).toContain("## The project's columns");
  });

  // `allows` DENIES the own-card rows to a credential minted without a card — "a run minted without one has no
  // card to be confined to" — so promising them here would describe the one authority this run cannot have.
  it('lists no card-confined endpoint, because the server would refuse every one', () => {
    const credential = { token: 't', apiBase: 'http://127.0.0.1:4610', scope: 'work' as const };
    const text = buildRunPrompt(project({ credential }));
    expect(text).toContain('POST /api/cards');
    expect(text).not.toContain('and no other card');
    expect(text).not.toContain('PATCH /api/cards/:board/:id');
  });
});
