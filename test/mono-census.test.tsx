// @vitest-environment jsdom
//
// THE SIGNATURE'S OWN SENTENCE, ASSERTED — *if it is monospaced, the machine measured it; if it is not,
// a person wrote it.* Phase 12 of docs/design-system.md.
//
// `npm run check:shape-coverage` counts the rules outside `ui/primitives.css` that declare
// `font-family: var(--font-mono)`, and a count is all it can be: a ratchet at 7 reads exactly the same
// whether the seven are the seven that were reasoned about or seven somebody added last week. So the
// test here is not the number. It is the two halves of the sentence:
//
//   1. EVERY SURVIVOR IS NAMED, with the category that excuses it. A rule that appears in the census and
//      not in the table below fails, and so does one in the table that has left the stylesheet — which
//      is what makes this the place a reader finds the reason rather than a place they find a total.
//   2. EVERY FACT THAT MOVED STILL READS AS ONE. The three rules Phase 12 migrated are asserted through
//      what the CALL SITE now renders, not through a hand-written class list. The tool name is here;
//      the run status is in test/chip-boxes.test.tsx beside the three chips Phase 8 migrated the same
//      way, and the report meta list is in test/report-views.test.tsx, where that pane's props already
//      live. A claim asserted where its own suite is, rather than gathered into one file that then has
//      to rebuild three sets of mocks.
//
// The survivors are ALL THE SAME EXCEPTION, which is why the table has a category column and not a
// sentence per row: the CONTENT is machine text rather than a measurement. That is a weaker claim than
// the signature's, and it is the honest one for a card's file, a config file, a prompt, a User-Agent
// string and an inline `<code>` in prose. Four of the seven are `<input>`/`<textarea>` and could not be
// a `Readout` at all — a `Readout` is a `<span>` — which is a structural reason rather than a judgement.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { box } from './css-box.js';

const api = vi.hoisted(() => ({
  getModelStatus: vi.fn().mockResolvedValue(null),
  listModels: vi.fn().mockResolvedValue([]),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { CopilotPanel } = await import('../web/src/copilot/CopilotPanel.js');

afterEach(cleanup);

// jsdom implements no scrolling and the copilot transcript scrolls itself to the bottom on mount.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? ((): void => {});

// ---------------------------------------------------------------------------------------------------
// 1. THE SURVIVORS, EACH WITH THE CATEGORY THAT EXCUSES IT.
const CONTENT_IS_MACHINE_TEXT = 'the content is machine text, not a measurement';

const SURVIVORS = new Map([
  ['.raw-area', `a whole card FILE in a textarea — ${CONTENT_IS_MACHINE_TEXT}`],
  ['.control-textarea', `a config file in the editor body — ${CONTENT_IS_MACHINE_TEXT}`],
  ['.skill-editor textarea.vb-input', `a prompt, edited like code — ${CONTENT_IS_MACHINE_TEXT}`],
  [
    '.confirm-require .vb-input',
    'the exact string the machine demands back, typed character by character — a box you cannot render a <span> in',
  ],
  ['.gate-preview code, .ap-help-body code', `inline code in prose — ${CONTENT_IS_MACHINE_TEXT}`],
  [
    '.markdown code',
    `inline code in rendered prose, and the one chip exemption — ${CONTENT_IS_MACHINE_TEXT}`,
  ],
  ['.signin-label', `a browser's own User-Agent string — ${CONTENT_IS_MACHINE_TEXT}`],
]);

// The census's own question, asked here the same way `tools/check-shape-coverage.mjs` asks it: which
// rules outside the primitive stylesheet declare the monospaced face. Comments are stripped, because a
// rule quoted in prose is not a rule — the defect `check-type-scale.mjs` had before it blanked them.
function monoRules(): string[] {
  const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const out: string[] = [];
  const stack: { selector: string; start: number }[] = [];
  let from = 0;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === '{') {
      stack.push({ selector: css.slice(from, i).trim(), start: i + 1 });
      from = i + 1;
    } else if (c === '}') {
      const open = stack.pop();
      if (open && !open.selector.startsWith('@') && open.selector !== '') {
        if (/font-family\s*:\s*var\(--font-mono\)/.test(css.slice(open.start, i))) out.push(open.selector);
      }
      from = i + 1;
    } else if (c === ';') from = Math.max(from, i + 1);
  }
  return out;
}

describe('every hand-rolled monospaced rule is a named exception', () => {
  it('the census and the table are the same set', () => {
    expect(monoRules().sort()).toEqual([...SURVIVORS.keys()].sort());
  });

  // A reason nobody can read is a reason nobody re-examines, and an empty string would satisfy the set
  // comparison above. Both halves of the sentence have to be present.
  it.each([...SURVIVORS])('%s says why in the same breath', (_selector, reason) => {
    expect(reason.length).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------------------------------------------
// 2. ONE OF THE THREE THAT MOVED — the other two are asserted in their own suites, named above.
const copilotProps = (items: unknown[]) =>
  ({
    copilot: {
      items,
      running: false,
      model: 'opus',
      stats: { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 },
      chats: [],
      currentChatId: null,
      send: vi.fn(),
      compact: vi.fn(),
      newSession: vi.fn(),
      openChat: vi.fn(),
      deleteChat: vi.fn(),
      cancel: vi.fn(),
    },
    backend: 'claude-code',
    mode: 'bypassPermissions',
    model: 'opus',
    effort: 'high',
    onMode: vi.fn(),
    onModel: vi.fn(),
    onEffort: vi.fn(),
    onBackend: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    overridden: false,
    contextBudget: 200_000,
    // biome-ignore lint/suspicious/noExplicitAny: the panel's props are twenty deep and this file cares about one line of its transcript.
  }) as any;

describe("a tool call's name is a Readout", () => {
  const line = () => {
    render(<CopilotPanel {...copilotProps([{ id: 't1', kind: 'tool', text: '', toolName: 'Edit' }])} />);
    const el = screen.getByText(/Edit/);
    return el;
  };

  // `.msg-tool` WAS `Readout` `small` `accent` VALUE FOR VALUE — `color: var(--accent);
  // font-family: var(--font-mono); font-size: var(--t-small)` — and the rule is gone.
  it('renders the primitive rather than a class of its own', () => {
    expect([...line().classList].sort()).toEqual(['vb-readout', 'vb-readout-accent', 'vb-readout-small']);
  });

  it('still resolves to the monospaced face, at the small step, in the accent ink', () => {
    const drawn = box(line());
    expect(drawn['font-family']).toBe('var(--font-mono)');
    expect(drawn['font-size']).toBe('0.75rem');
    expect(drawn.color).toBe('var(--accent)');
  });
});
