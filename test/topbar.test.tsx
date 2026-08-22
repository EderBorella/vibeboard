// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STOP_REASONS } from '../src/core/dispatch-gate.js';
import {
  LIGHT_STATES,
  type LightState,
  type RecentFailure,
  type RefusalKind,
} from '../web/src/app/connection-light.js';
import type { MainTab } from '../web/src/app/TopBar.js';
import { TopBar } from '../web/src/app/TopBar.js';
import { STATE_TONES } from '../web/src/ui/state-tones.js';

afterEach(cleanup);

const props = {
  showProject: true,
  projectName: 'Demo',
  tab: 'boards' as MainTab,
  onTab: vi.fn(),
  theme: 'cyberpunk',
  onTheme: vi.fn(),
  copilotOpen: true,
  onToggleCopilot: vi.fn(),
  onSettings: vi.fn(),
  onSwitchProject: vi.fn(),
  attentionCount: 0,
  light: 'online' as LightState,
  lightTitle: 'Connected.',
  agentRefusal: null as string | null,
  refusalKind: null as RefusalKind | null,
  recentFailure: null as RecentFailure | null,
};

describe('TopBar', () => {
  it('shows the project chrome when a project is open', () => {
    render(<TopBar {...props} />);
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.getByText('Boards')).toBeTruthy();
    expect(screen.getByText('Project Control')).toBeTruthy();
    expect(screen.getByText('Switch project')).toBeTruthy();
  });

  it('hides everything project-specific when none is open, keeping brand and theme', () => {
    // The gate and the loading state both render through here; offering "Switch project" or the
    // board tabs with nothing open would be dead controls.
    render(<TopBar {...props} showProject={false} projectName={undefined} />);
    expect(screen.getByText('VibeBoard')).toBeTruthy();
    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.queryByText('Boards')).toBeNull();
    expect(screen.queryByText('Switch project')).toBeNull();
    expect(screen.getByTitle('Theme')).toBeTruthy();
  });

  it('marks the active tab and reports clicks', () => {
    const onTab = vi.fn();
    render(<TopBar {...props} tab="control" onTab={onTab} />);
    expect(screen.getByText('Project Control').className).toContain('active');
    expect(screen.getByText('Boards').className).not.toContain('active');
    screen.getByText('Boards').click();
    expect(onTab).toHaveBeenCalledWith('boards');
  });

  it('marks and switches to Execution, the tab the earlier test predated', () => {
    // Three tabs, three separate buttons: the props type here said 'boards' | 'control', so nothing
    // had ever clicked this one or checked that it highlights.
    const onTab = vi.fn();
    render(<TopBar {...props} tab="execution" onTab={onTab} />);
    expect(screen.getByText('Execution').className).toContain('active');
    expect(screen.getByText('Boards').className).not.toContain('active');
    expect(screen.getByText('Project Control').className).not.toContain('active');
    screen.getByText('Execution').click();
    expect(onTab).toHaveBeenCalledWith('execution');
  });

  it('marks and switches to Explorer, which is a different tab from Project Control', () => {
    // The two are easy to conflate: both are file panes, and both carry `.control` in the DOM.
    const onTab = vi.fn();
    render(<TopBar {...props} tab="explorer" onTab={onTab} />);
    expect(screen.getByText('Explorer').className).toContain('active');
    expect(screen.getByText('Project Control').className).not.toContain('active');
    screen.getByText('Explorer').click();
    expect(onTab).toHaveBeenCalledWith('explorer');
  });

  it('switches to Project Control by name, not by position', () => {
    const onTab = vi.fn();
    render(<TopBar {...props} onTab={onTab} />);
    screen.getByText('Project Control').click();
    expect(onTab).toHaveBeenCalledWith('control');
  });

  it('badges the count of runs waiting on you, and shows nothing at zero', () => {
    // The badge is the only ambient signal that a run needs a decision. At zero it must be absent
    // rather than a "0" — an empty badge reads as something to do.
    render(<TopBar {...props} attentionCount={0} />);
    expect(document.querySelector('[data-testid="tab-badge"]')).toBeNull();
    cleanup();
    render(<TopBar {...props} attentionCount={3} />);
    expect(document.querySelector('[data-testid="tab-badge"]')?.textContent).toBe('3');
  });

  it('reports a theme change', () => {
    const onTheme = vi.fn();
    render(<TopBar {...props} onTheme={onTheme} />);
    const select = screen.getByTitle('Theme') as HTMLSelectElement;
    select.value = 'classic-dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onTheme).toHaveBeenCalledWith('classic-dark');
  });

  it('labels the copilot button by what the click will do', () => {
    render(<TopBar {...props} copilotOpen />);
    expect(screen.getByText('Hide copilot')).toBeTruthy();
    cleanup();
    render(<TopBar {...props} copilotOpen={false} />);
    expect(screen.getByText('Copilot')).toBeTruthy();
  });

  // THE WHOLE CHAIN, END TO END. `refusalKind` travels App → TopBar → ConnectionLight → lightAdvice,
  // and a prop dropped at any hop leaves the balloon telling the old lie with every unit test green.
  // This is the hop TopBar owns. Both cases carry the SAME refusal sentence, so a component that read
  // the sentence rather than the kind could not pass both.
  it('passes the cause of the refusal down to the balloon', () => {
    const refusal = 'Agents are disabled: something is wrong.';
    const headingFor = (kind: RefusalKind): string => {
      render(<TopBar {...props} light="offline" agentRefusal={refusal} refusalKind={kind} />);
      fireEvent.click(screen.getByTitle(props.lightTitle));
      const head = screen.getByRole('dialog').querySelector('.vb-status-head')?.textContent ?? '';
      const body = screen.getByRole('dialog').textContent ?? '';
      cleanup();
      return `${head}||${body}`;
    };
    expect(headingFor('credential')).toContain('Rebuild the agent boxes');
    expect(headingFor('credential').split('||')[0]?.toLowerCase()).not.toContain('docker');
    expect(headingFor('docker').split('||')[0]).toBe('Docker is not ready');
  });

  // THE SAME HOP, for the other piece of evidence. `recentFailure` travels App → TopBar →
  // ConnectionLight → lightAdvice, and dropped here the balloon says a run failed without ever saying
  // what it said — which is the entire content of the state.
  it('passes what already failed down to the balloon', () => {
    const note = 'Failed to authenticate: OAuth session expired.';
    render(
      <TopBar
        {...props}
        light="failing"
        agentRefusal={null}
        recentFailure={{ runs: 2, note, at: '2026-08-16T10:05:00.000Z' }}
      />,
    );
    fireEvent.click(screen.getByTitle(props.lightTitle));
    expect(screen.getByRole('dialog').querySelector('.vb-status-detail')?.textContent).toBe(note);
  });

  // A state the stylesheet does not know about is an invisible one: the wrapper's state is what tints the
  // dot and the word, and `failing` must not fall through to the default grey — nor borrow either of the
  // two colours it is there to be distinguished from. Read from the source because jsdom loads no CSS,
  // the same reason the width assertions below do.
  //
  // `failing` MUST NOT LOOK LIKE `online`, and that half of the original claim is the one that mattered:
  // the morning it was added, auto-pilot had stopped itself on two runs that never reached a model and
  // this light said `online` throughout. It said "distinct from online AND offline", and Phase 13
  // withdraws the second half deliberately — `offline` and `failing` are one tone. Both mean something
  // wants your attention while the app keeps working, and the light already leaned on the word to tell
  // them apart in the two themes where `--warn` and `--accent-2` are the same amber, which the deleted
  // rule said in its own comment.
  //
  // READ THROUGH THE TABLE rather than out of the stylesheet, because the stylesheet no longer names a
  // state at all: nine `.conn-status[data-state='…']` rules became one `color: var(--tone)` declaration
  // and one row per state in web/src/ui/state-tones.ts. A regex over styles.css would now match nothing
  // and pass, which is why the assertion moved rather than being deleted.
  it('separates failing from online, and shares its tone with offline', () => {
    expect(STATE_TONES.failing).not.toBe(STATE_TONES.online);
    expect(STATE_TONES.failing).toBe(STATE_TONES.offline);
    // AND THE WORD IS WHAT DISTINGUISHES THE PAIR, which is a claim about the DOM rather than the table
    // — without it "they share a tone" would be an admission rather than a design. Asserted for both,
    // because a shared colour with only one of the two words rendered is the defect.
    for (const state of ['offline', 'failing'] as const) {
      cleanup();
      const { container } = render(<TopBar {...props} light={state} />);
      expect(container.querySelector('.conn-text')?.textContent).toBe(state);
    }
  });

  it('exposes the socket state as an attribute and a title', () => {
    const { container } = render(<TopBar {...props} light="closed" lightTitle="WebSocket closed" />);
    // The state is on the WRAPPER, not the dot: it tints the dot and the word together, and the dot
    // itself is a `Dot` primitive with no state of its own. `data-state` and not a class, because
    // `conn-${light}` built six names no literal grep could see — see docs/design-system.md, *Risks*.
    const status = screen.getByTestId('conn-status');
    expect(status.getAttribute('data-state')).toBe('closed');
    expect(status.getAttribute('title')).toBe('WebSocket closed');
    expect(container.querySelector('.vb-dot')).toBeTruthy();
  });

  // A colour cannot say WHICH failure this is, and two of the four states are failures with different
  // fixes — `closed` means reconnect, `unauthorized` means sign in. Before the word was rendered they
  // were the same grey dot, distinguishable only by a `title` nobody hovers.
  it.each(LIGHT_STATES)('writes the state "%s" beside the dot', (state) => {
    const { container } = render(<TopBar {...props} light={state} />);
    expect(container.querySelector('.conn-text')?.textContent).toBe(state);
  });

  // THE FIXED WIDTH IS GONE, AND ITS TEST BECOMES THE ASSERTION THAT IT STAYS GONE. This was *reserves a
  // fixed width for the label, so a state change cannot move the tabs*, against `width: 12ch` — sized to
  // `unauthorized`, the longest name the light can report, so that a reconnect could not shove the tab row
  // sideways while you were aiming at it.
  //
  // THE OWNER RE-TOOK THAT TRADE, on a measurement: the box reserved 91.6px for a 40.8px word, so half of
  // the app's own health indicator was empty space to the right of it — and as a drawn chip, that emptiness
  // is visible in a way it never was on a bare word. The tabs can now shift by ~50px, but only on the
  // transition between `online` and one of the two longest failure names, which is a moment when the tab
  // you were aiming at is not the thing that just went wrong.
  //
  // ASSERTED AGAINST THE STYLESHEET SOURCE, not through jsdom, for the reason it always was: jsdom loads no
  // CSS and computes no layout, so `getComputedStyle(...).width` answers '' whatever the rule says. A test
  // written that way would pass with the declaration deleted — and would also pass with it restored, which
  // is what this now needs to catch. `nowrap` is asserted in the same breath because it is the half of the
  // old rule that survives: the word must not break, whatever the box does.
  //
  // `process.cwd()` rather than `import.meta.url`: this file runs under jsdom, where import.meta.url is
  // an HTTP URL, so a path built from it reaches readFileSync as `http://localhost/...` and throws. The
  // same trap is called out in vitest.config.ts for the same reason.
  it('reserves no fixed width for the label, so the chip is as wide as its word', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'organisms', 'topbar', 'topbar.css'), 'utf8');
    // ANCHORED TO THE START OF A LINE. Unanchored, `\.conn-text\s*\{` also matches the tail of
    // `.conn-status:hover .conn-text {`, and once that rule was added the test began reading its
    // `color` declaration and failing — a false alarm from a regex that matched the wrong rule.
    const rule = /^\.conn-text\s*\{([^}]*)\}/m.exec(css);
    expect(rule, '.conn-text rule not found in web/src/organisms/topbar/topbar.css').toBeTruthy();
    expect(rule?.[1], 'the fixed width is back').not.toMatch(/width:/);
    expect(rule?.[1]).toMatch(/white-space:\s*nowrap/);
  });

  // The label is LEFT-aligned inside that fixed box, and this is not cosmetic pedantry: a <button>
  // centres its text by UA default, so when the light became one the word jumped 24px away from the dot
  // and then shuffled about as the state name changed length. Measured in a real browser — the gap
  // between the dot's right edge and the first glyph went from an intended 6.4px to 30.7px. jsdom
  // computes no layout, so the stylesheet is again the only place this can be held.
  it('left-aligns the label inside its fixed box, which a button does not do by default', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'organisms', 'topbar', 'topbar.css'), 'utf8');
    const rule = /^\.conn-status\s*\{([^}]*)\}/m.exec(css);
    expect(rule, '.conn-status rule not found').toBeTruthy();
    expect(rule?.[1]).toMatch(/text-align:\s*left/);
  });

  // THE `12` THIS PINNED WAS THE WIDTH'S OWN JUSTIFICATION, and with the width gone the number has nothing
  // to be right about — a length in `ch` says nothing about what it was measured against, which is exactly
  // why it needed a test. What survives is the claim underneath it: every state the light can report is
  // rendered in FULL, whatever the box is, so a longer state name added later cannot be silently truncated.
  // Read from the DOM now rather than from the vocabulary's own lengths, which is the stronger direction —
  // the old version compared `LIGHT_STATES` against a constant and would have passed while the label was
  // being clipped by something else.
  it('renders every state name in full, whatever the box measures', () => {
    expect(LIGHT_STATES.length).toBeGreaterThan(1);
    for (const state of LIGHT_STATES) {
      cleanup();
      const { container } = render(<TopBar {...props} light={state} />);
      const label = container.querySelector('.conn-text');
      expect(label?.textContent, state).toBe(state);
      // AND NOTHING IS CUT. `text-overflow` would be the mechanism, and the assertion is on the absence of
      // one anywhere on the element: an ellipsis here would hide `unauthorized` behind `unauthoriz…`.
      expect(label?.className ?? '', state).not.toContain('ellips');
    }
  });
});

const withProps = (over: Partial<typeof props> = {}): typeof props => ({ ...props, ...over });

describe('TopBar visibility and labels', () => {
  it('hides every project control until a project is open', () => {
    render(<TopBar {...withProps({ showProject: false })} />);
    // The brand, theme picker and connection dot survive; nothing else does.
    expect(screen.getByText('VibeBoard')).toBeTruthy();
    expect(screen.queryByText('Boards')).toBeNull();
    expect(screen.queryByText('Project Control')).toBeNull();
    expect(screen.queryByText('Switch project')).toBeNull();
    expect(screen.queryByTitle('Settings')).toBeNull();
    expect(screen.queryByText('Copilot')).toBeNull();
    expect(screen.queryByText('Hide copilot')).toBeNull();
    expect(screen.getByTitle('Theme')).toBeTruthy();
  });

  it('shows them all once a project is open', () => {
    render(<TopBar {...withProps({ showProject: true, projectName: 'Demo' })} />);
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.getByText('Boards')).toBeTruthy();
    expect(screen.getByText('Project Control')).toBeTruthy();
    expect(screen.getByText('Switch project')).toBeTruthy();
    expect(screen.getByTitle('Settings')).toBeTruthy();
  });

  it.each([
    [true, 'Hide copilot'],
    [false, 'Copilot'],
  ])('labels the copilot toggle %p as %p', (copilotOpen, label) => {
    render(<TopBar {...withProps({ copilotOpen })} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it.each([
    ['boards', 'Boards'],
    ['control', 'Project Control'],
  ] as const)('marks the %s tab active', (tab, label) => {
    render(<TopBar {...withProps({ tab })} />);
    expect(screen.getByText(label).className).toContain('active');
    const other = label === 'Boards' ? 'Project Control' : 'Boards';
    expect(screen.getByText(other).className).not.toContain('active');
  });

  it('offers every theme, with the current one selected', () => {
    render(<TopBar {...withProps({ theme: 'classic-dark' })} />);
    const select = screen.getByTitle('Theme') as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.text])).toEqual([
      ['cyberpunk', 'Cyberpunk'],
      ['classic-dark', 'Classic Dark'],
      ['marshmallow', 'Marshmallow'],
    ]);
    expect(select.value).toBe('classic-dark');
  });

  // THE PICKER AND THE STYLESHEET ARE TWO HOMES FOR ONE FACT, and neither knows about the other. A theme
  // offered here with no `[data-theme]` block in themes.css does not fail — it silently renders the
  // DEFAULT palette, so the user picks "Marshmallow" and gets Cyberpunk with no error anywhere. A block
  // with no entry here is simply unreachable. The file's own header says to do both by hand, which is
  // exactly the instruction that gets half-followed.
  it('offers exactly the themes themes.css defines', () => {
    // `process.cwd()`, not `import.meta.url`: this file runs under jsdom, where import.meta.url is an
    // http URL and any file API on it throws — the same trap vitest.config.ts records for the docker shim.
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'design', 'themes.css'), 'utf8');
    const defined = new Set([...css.matchAll(/\[data-theme="([a-z-]+)"\]/g)].map((m) => m[1]));
    render(<TopBar {...withProps({})} />);
    const offered = new Set(
      [...(screen.getByTitle('Theme') as HTMLSelectElement).options].map((o) => o.value),
    );
    expect([...offered].sort()).toEqual([...defined].sort());
  });

  it('reflects the connection state in a title and an attribute', () => {
    render(<TopBar {...withProps({ light: 'closed', lightTitle: 'WebSocket closed' })} />);
    const dot = screen.getByTitle('WebSocket closed');
    expect(dot.getAttribute('data-state')).toBe('closed');
  });
});

// One word for what auto-pilot is doing. The load-bearing part is which stops read as a success:
// "an error or an exhausted budget never counts as success", so `complete` is styled apart from the
// rest rather than every ended run looking equally finished.
// The permanent way to add a log entry by hand is this tab existing at all.
describe('the tabs', () => {
  it('offers the project log, and reports the switch', () => {
    const onTab = vi.fn();
    render(<TopBar {...props} onTab={onTab} />);
    fireEvent.click(screen.getByText('Project Log'));
    expect(onTab).toHaveBeenCalledWith('diary');
  });

  it('marks only the open tab as active', () => {
    render(<TopBar {...props} tab="diary" />);
    expect(screen.getByText('Project Log').closest('button')?.className).toContain('active');
    expect(screen.getByText('Boards').closest('button')?.className).not.toContain('active');
  });
});

// THE HEADER NO LONGER SAYS ANYTHING ABOUT AUTO-PILOT, and this is what is left of the eleven tests that
// asserted the chip that used to be here. Every one of their claims moved to test/autopilot-bar.test.tsx —
// the word per state, the reason on a stop, `complete` as the only success, the balloon, the tooltip and
// its fallback — because the chip moved, not because the claims stopped mattering. The owner's ruling: two
// indicators for one loop, on two surfaces, with no rule about which was authoritative.
//
// WHAT IS ASSERTED HERE IS THE ABSENCE, over every stop reason and both other states, on the header's TEXT
// rather than on a test id — so bringing a second indicator back under any class, id or wording fails this.
// The old version of this file checked only that the stop SENTENCE was absent; the state word is now
// absent too, and the sentence claim is kept inside it.
describe('the header says nothing about the loop', () => {
  const header = (): HTMLElement | null => document.querySelector('header.topbar');

  it('carries neither the reason nor the sentence, whatever the stop was', () => {
    const said = 'Nothing can move E-004, E-007 — check that every column that holds a card is routed.';
    for (const reason of STOP_REASONS) {
      cleanup();
      render(<TopBar {...props} />);
      const text = header()?.textContent ?? '';
      expect(text, reason).not.toContain(said);
      // The reason word itself. `complete` and `stopped` are the two that could plausibly appear in
      // other chrome, so this is the assertion that would catch a chip returning under a new name.
      expect(text, reason).not.toContain(reason);
    }
  });

  // ANTI-VACUITY, and it is not decoration: `TopBar` no longer takes an `autopilot` prop at all, so the
  // loop above renders the same markup on every iteration and would pass against a header that renders
  // NOTHING. This is what says the header still exists and still carries the things it is supposed to.
  it('still renders the project name, the light and the tabs', () => {
    render(<TopBar {...props} />);
    const text = header()?.textContent ?? '';
    expect(text).toContain('Demo');
    expect(text).toContain('online');
    expect(text).toContain('Boards');
  });
});
