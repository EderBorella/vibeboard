// @vitest-environment jsdom
//
// THE SIGNATURE'S OWN SENTENCE, ASSERTED — *if it is monospaced, the machine measured it; if it is not,
// a person wrote it.* Phase 12 of docs/design-system.md.
//
// `npm run check:shape-coverage` counts the rules outside the primitive layer that declare
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

// SEVEN BECAME THREE, and the four that went were one row rather than four: a control a person types
// machine text into. `.raw-area`, `.control-textarea`, `.skill-editor textarea` and `.confirm-require`
// each declared `font-family: var(--font-mono)` on a class of their own because this test's own ruling —
// a Readout is a `<span>`, so a control cannot be one — left them nowhere else to say it. The atom layer
// gave them somewhere: `Control` has a `mono` option, said once, inside the primitive layer.
//
// THE THREE THAT REMAIN ARE NOT CONTROLS. They are quoted machine text in prose, and no option on a
// control can reach them.
const SURVIVORS = new Map([
  // A TYPE SELECTOR AS OF THE ORGANISM LAYER. It was `.gate-preview code, .ap-help-body code` — one rule
  // naming two SURFACES from inside an atom's sheet, which the layer gate reads as exactly that.
  ['code', `inline code in prose — ${CONTENT_IS_MACHINE_TEXT}`],
  [
    '.markdown code',
    `inline code in rendered prose, and the one chip exemption — ${CONTENT_IS_MACHINE_TEXT}`,
  ],
  ['.signin-label', `a browser's own User-Agent string — ${CONTENT_IS_MACHINE_TEXT}`],
]);

// The census's own question, asked here the same way `tools/check-shape-coverage.mjs` asks it: which
// rules outside the primitive stylesheet declare the monospaced face. Comments are stripped, because a
// rule quoted in prose is not a rule — the defect `check-scale.mjs` had before it blanked them.
// THE SURFACES, WHICH ARE MANY FILES RATHER THAN ONE — read out of `web/src/styles.ts`, the app's own
// cascade list, so a sheet added by a later phase is censused by existing. The three dropped are the
// ones that are not surfaces: the primitive layer is what this census is asking about the outside of,
// and the two token files declare properties rather than a face. Filtered rather
// than left in for tidiness — `--font-mono` is DEFINED in `design/tokens.css`, so a census that reads it
// as a surface is one `font-family` away from reporting the definition as a hand-rolled exception.
// THE PRIMITIVE LAYER IS THIRTEEN SHEETS since the molecule phase, and every one of them has to be
// dropped here for the reason `ui/primitives.css` always was: this census asks what is OUTSIDE the
// primitive, and `atoms/readout.css` is where the signature is declared. That file is not on the list
// because it no longer exists — what was left of it WAS the molecule layer, and it is seven files now.
// `molecules/notice.css` is one of them and it matters: `.vb-notice code` declares the mono face, and
// counting it would report the primitive that ended five surface copies as a sixth.
// `atoms/prose.css`, `molecules/inline-field.css` and `molecules/popover.css` are deliberately NOT on the
// list — they are surfaces — and two of the three survivors below are `prose.css`'s rules.
const NOT_A_SURFACE = [
  'design/tokens.css',
  'design/themes.css',
  'atoms/button.css',
  'atoms/chip.css',
  'atoms/control.css',
  'atoms/readout.css',
  'atoms/surface.css',
  'atoms/text.css',
  'molecules/tones.css',
  'molecules/status-chip.css',
  'molecules/tabs.css',
  'molecules/menu.css',
  'molecules/field.css',
  'molecules/notice.css',
  'molecules/figure-row.css',
];
const SURFACE_SHEETS = [
  ...readFileSync(join(process.cwd(), 'web', 'src', 'styles.ts'), 'utf8').matchAll(
    /^\s*import\s+'\.\/([^']+\.css)';/gm,
  ),
]
  .map(([, file]) => file)
  .filter((file) => !NOT_A_SURFACE.includes(file));

function monoRules(): string[] {
  const css = SURFACE_SHEETS.map((file) => readFileSync(join(process.cwd(), 'web', 'src', file), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
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
    // ONE CLASS, and it was three: `Readout` lost every option in the atom phase, because a figure takes
    // the step and the ink of the atom it sits in. The tool name reads as the machine's either way — the
    // face is what says so, and the face is the only thing left.
    expect([...line().classList].sort()).toEqual(['vb-readout']);
  });

  // THE FACE IS ALL THAT IS LEFT, AND THE STEP AND THE INK WENT WITH THE OPTIONS. `.msg-tool` was
  // `Readout` `small` `accent` value for value, and the atom phase deleted every Readout option — so the
  // line takes `.msg`'s own `--t-body` and `var(--tone, inherit)`, which is the surface it sits in
  // deciding, exactly as the atom's comment says it should.
  //
  // WHAT THAT COSTS IS RECORDED HERE RATHER THAN SMOOTHED AWAY, because it is bigger than the plan's own
  // argument for it: the plan justified "loses every option" on `tone="text"` having ONE consumer and
  // `size="body"` and `tone="accent2"` having two each, and `tone="accent"` had NINE and `size="small"`
  // twelve. A card id, a created id and a tool name were the accent by a stated decision — *"an id is the
  // accent"* — and they are their surface's ink now. The mono face still says the machine measured it,
  // which is this suite's claim and is unchanged; the emphasis is a separate decision and it is gone.
  it('still resolves to the monospaced face, and takes the step and the ink of the line it sits in', () => {
    const drawn = box(line());
    expect(drawn['font-family']).toBe('var(--font-mono)');
    expect(drawn['font-size']).toBeUndefined();
    expect(drawn.color).toBeUndefined();
    // AND THE LINE IS WHAT DECIDES BOTH, asserted rather than assumed: a claim that the atom declares
    // nothing is only half the sentence, and the half that matters is that something else does.
    const host = document.createElement('div');
    host.className = 'msg';
    const wrapper = box(host);
    expect(wrapper['font-size']).toBe('0.8125rem');
    expect(wrapper.color).toBe('var(--tone, inherit)');
  });
});
