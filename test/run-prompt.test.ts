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
import type { Skill } from '../src/core/skills.js';
import type { BoardName, Card } from '../src/core/types.js';
import { type BoardColumns, buildRunPrompt, type PromptInputs } from '../src/server/run-prompt.js';

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
  projectRoot: ROOT,
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
      inputs({ credential: { token: 'tok-123', apiBase: 'http://127.0.0.1:4610' } }),
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
    const text = buildRunPrompt(inputs({ credential: { token: 'tok', apiBase: 'http://x' } }));
    expect(text).toContain('E-010');
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

// A run asked to JUDGE rather than to build. `inputs(over)` above is this file's fixture function.
describe('the judging contract', () => {
  const judging = () => buildRunPrompt(inputs({ verdict: { threshold: 0.6 } }));

  it('is told to report a score, and what it will be compared against', () => {
    const text = judging();
    expect(text).toContain('score:');
    // The bar is stated because a judge that does not know it cannot calibrate to it — and a bar
    // nobody can see is one nobody can argue with afterwards.
    expect(text).toMatch(/at or above 0\.6/i);
  });

  it('asks an ordinary run for no score at all', () => {
    expect(buildRunPrompt(inputs())).not.toContain('score:');
  });

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
        verdict: { threshold: 0.6 },
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
  // derive-features, break-down and design all legitimately touch nothing on disk. Five of the seven default
  // routes, and every critic-verified one, would have had to score 0. Caught in review; the exact bytes are
  // asserted, because this is a rule whose meaning turns on one word.
  it('tells it to score nothing at all as zero, and only nothing at all', () => {
    const text = judgingRun();
    expect(text).toContain(
      'it failed AND wrote no report AND produced\nnothing — then the score is 0, however good the card looks otherwise.',
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

  // A critic a person dispatches from the card has no run under judgement, and the general wording is right
  // for it. A sentence naming a run that was never passed would be worse than no sentence.
  it('names no run when there is none, rather than inventing one', () => {
    const text = judging();
    expect(text).not.toContain('## The run you are judging');
    expect(text).toMatch(/change nothing/i);
  });

  // The review's HIGH. A judging run was handed BOTH required contracts: "Changing the board" granting
  // PATCH and POST on cards, then "Judging" saying do not edit the card. The exclusivity that was
  // claimed held only between the two REPORTING contracts, and the judging test supplied no credential,
  // so nothing noticed. A judge needs no write endpoint at all — it reads the work and reports a score.
  it('is not also told how to change the board', () => {
    const text = buildRunPrompt(
      inputs({ verdict: { threshold: 0.6 }, credential: { token: 'T', apiBase: 'http://127.0.0.1:4610' } }),
    );
    expect(text).not.toContain('## Changing the board (required)');
    expect(text).not.toContain('POST /api/cards');
    expect(text).not.toContain('PATCH /api/cards');
  });

  // The token is still named, because the run has one and an agent that finds a credential in its
  // environment with no explanation is an agent that will experiment with it.
  it('says what its credential is for, and that changing the board is not it', () => {
    const text = buildRunPrompt(
      inputs({ verdict: { threshold: 0.6 }, credential: { token: 'T', apiBase: 'http://127.0.0.1:4610' } }),
    );
    expect(text).toContain('## Your credential');
    expect(text).toMatch(/read/i);
  });

  // An ordinary run is unaffected: it still gets the endpoints it needs to do its job.
  it('leaves a working run’s board instructions alone', () => {
    const text = buildRunPrompt(inputs({ credential: { token: 'T', apiBase: 'http://127.0.0.1:4610' } }));
    expect(text).toContain('## Changing the board (required)');
    expect(text).toContain('POST /api/cards');
  });

  // A score of 0 is the answer to "this does not meet the card", and the contract has to ask for it
  // explicitly: a judge that stays silent when the work is bad produces an absent score, which fails
  // closed but says nothing anyone can act on.
  it('asks for an answer even when the answer is zero', () => {
    expect(judging()).toMatch(/even when the answer is 0/);
  });
});
