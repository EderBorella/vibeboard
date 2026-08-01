import { describe, expect, it } from 'vitest';
import { boardRel, DOCS_DIR, RESOURCES_DIR, RUNS_DIR, skillRel } from '../src/core/layout.js';
import type { Skill } from '../src/core/skills.js';
import type { BoardName, Card } from '../src/core/types.js';
import { buildRunPrompt, type PromptInputs } from '../src/server/run-prompt.js';

const ROOT = '/p';

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
    columnSlug: 'todo',
    order: 10,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: 'Some detail.',
    filePath: `${ROOT}/${boardRel('engineering', 'todo', 'E-010.md')}`,
    ...over,
  }) as Card;

const inputs = (over: Partial<PromptInputs> = {}): PromptInputs => ({
  skill,
  card: card(),
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
    expect(text).toContain(`File: ${boardRel('engineering', 'todo', 'E-010.md')}`);
    expect(text).toContain('```markdown\n---\nid: E-010\ntitle: Token store\n---\nSome detail.\n```');
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
            columnSlug: 'todo',
            title: 'Rotate keys',
            body: 'Rotate on the hour.',
            filePath: `${ROOT}/${boardRel('engineering', 'todo', 'E-011.md')}`,
          }),
        ],
      }),
    );
    expect(text).toContain('### P-001 — Stay signed in\n\nUsers lose their session daily.');
    // The engineering card is listed but not quoted — its file path is enough.
    expect(text).toContain('- **E-011** (engineering/todo) — Rotate keys');
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
    const text = buildRunPrompt(inputs({ previousReport: '## What I found\n\nThree cards, not one.' }));
    expect(text).toContain('## The previous run on this card');
    expect(text).toContain('Three cards, not one.');
  });

  it('ignores a blank previous report rather than adding an empty section', () => {
    expect(buildRunPrompt(inputs({ previousReport: '   \n  ' }))).not.toContain(
      '## The previous run on this card',
    );
  });

  it('puts the user prompt last of the context, immediately before the contract', () => {
    // It is the most specific instruction in the prompt; buried above the card it competes with
    // the skill instead of qualifying it.
    const text = buildRunPrompt(
      inputs({
        userPrompt: 'only the token store',
        linked: [card({ id: 'P-001', board: 'product' })],
        attachments: [`${DOCS_DIR}/a.md`],
        previousReport: 'earlier',
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
