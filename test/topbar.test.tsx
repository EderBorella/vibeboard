// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STOP_REASONS } from '../src/core/dispatch-gate.js';
import type { AutopilotState } from '../web/src/api.js';
import { LIGHT_STATES, type LightState } from '../web/src/app/connection-light.js';
import type { MainTab } from '../web/src/app/TopBar.js';
import { TopBar } from '../web/src/app/TopBar.js';

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
    expect(document.querySelector('.tab-badge')).toBeNull();
    cleanup();
    render(<TopBar {...props} attentionCount={3} />);
    expect(document.querySelector('.tab-badge')?.textContent).toBe('3');
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

  it('exposes the socket state as a class and a title', () => {
    const { container } = render(<TopBar {...props} light="closed" lightTitle="WebSocket closed" />);
    // The state class is on the WRAPPER, not the dot: it tints the dot and the word together, and the
    // dot itself is now a plain `.conn` with no state of its own.
    const status = container.querySelector('.conn-status');
    expect(status?.className).toContain('conn-closed');
    expect(status?.getAttribute('title')).toBe('WebSocket closed');
    expect(container.querySelector('.conn')).toBeTruthy();
  });

  // A colour cannot say WHICH failure this is, and two of the four states are failures with different
  // fixes — `closed` means reconnect, `unauthorized` means sign in. Before the word was rendered they
  // were the same grey dot, distinguishable only by a `title` nobody hovers.
  it.each(LIGHT_STATES)('writes the state "%s" beside the dot', (state) => {
    const { container } = render(<TopBar {...props} light={state} />);
    expect(container.querySelector('.conn-text')?.textContent).toBe(state);
  });

  // The indicator sits LEFT of the tabs, so a label that resized with its text would shove the tab row
  // sideways on every reconnect — which is the entire reason the width is fixed.
  //
  // ASSERTED AGAINST THE STYLESHEET SOURCE, not through jsdom. jsdom loads no CSS and computes no
  // layout, so `getComputedStyle(...).width` answers '' whatever the rule says: a test written that way
  // passes with the declaration deleted, which is worse than no test. Reading the file is the only thing
  // here that fails when the property goes.
  //
  // `process.cwd()` rather than `import.meta.url`: this file runs under jsdom, where import.meta.url is
  // an HTTP URL, so a path built from it reaches readFileSync as `http://localhost/...` and throws. The
  // same trap is called out in vitest.config.ts for the same reason.
  it('reserves a fixed width for the label, so a state change cannot move the tabs', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles.css'), 'utf8');
    const rule = /\.conn-text\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.conn-text rule not found in web/src/styles.css').toBeTruthy();
    expect(rule?.[1]).toMatch(/width:\s*12ch/);
  });

  // The number 12 is not arbitrary and must not drift from what it is sized for. If a fifth state is
  // added to ConnState, or one is renamed longer, the label starts truncating or the width stops being
  // the longest name — silently, because nothing about a CSS length says what it was measured against.
  // Against LIGHT_STATES, the DISPLAYED vocabulary, not ConnState. It read ConnState until `offline`
  // was added — a word the light shows that the socket has never heard of — at which point the test was
  // measuring the wrong set and would have passed while the label truncated.
  it('sizes that width to the longest state name the light can report', () => {
    expect(LIGHT_STATES.length).toBeGreaterThan(1);
    expect(Math.max(...LIGHT_STATES.map((s) => s.length))).toBe(12);
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
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'themes.css'), 'utf8');
    const defined = new Set([...css.matchAll(/\[data-theme="([a-z-]+)"\]/g)].map((m) => m[1]));
    render(<TopBar {...withProps({})} />);
    const offered = new Set(
      [...(screen.getByTitle('Theme') as HTMLSelectElement).options].map((o) => o.value),
    );
    expect([...offered].sort()).toEqual([...defined].sort());
  });

  it('reflects the connection state in a title and a class', () => {
    render(<TopBar {...withProps({ light: 'closed', lightTitle: 'WebSocket closed' })} />);
    const dot = screen.getByTitle('WebSocket closed');
    expect(dot.className).toContain('conn-closed');
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

describe('the auto-pilot chip', () => {
  const state = (over: Partial<AutopilotState>): AutopilotState => ({
    state: 'stopped',
    iteration: 0,
    ...over,
  });

  const chip = (): HTMLElement | null => document.querySelector('.ap-chip');
  const header = (): HTMLElement | null => document.querySelector('header.topbar');

  // The sentence belongs to `ap-bar-detail`, which wraps it under the auto-pilot bar's row for every state
  // that has one. The header once carried a second copy, as an unbounded flex sibling that pushed the tabs
  // and the buttons right. Asserted on the header's TEXT rather than on the old test id, so bringing the
  // duplicate back under any class or id fails this.
  it('does not repeat the stop sentence in the header, whatever the stop was', () => {
    const said = 'Nothing can move E-004, E-007 — check that every column that holds a card is routed.';
    for (const reason of STOP_REASONS) {
      cleanup();
      render(<TopBar {...props} autopilot={state({ state: 'stopped', reason, detail: said })} />);
      expect(header()?.textContent).not.toContain(said);
    }
    cleanup();
    render(<TopBar {...props} autopilot={state({ state: 'halted', detail: said })} />);
    expect(header()?.textContent).not.toContain(said);
  });

  // The chip keeping the sentence as its `title` is already asserted by 'carries the detail as its tooltip'
  // below, which predates this fix and needs no second copy. What had no cover is the fallback.
  it('falls back to the chip word when the stop said nothing', () => {
    render(<TopBar {...props} autopilot={state({ state: 'stopped', reason: 'exhausted' })} />);
    expect(chip()?.getAttribute('title')).toBe('exhausted');
  });

  it('says nothing at all while the project is idle', () => {
    render(<TopBar {...props} autopilot={state({ state: 'idle' })} />);
    expect(chip()).toBeNull();
  });

  it('says nothing before the first answer', () => {
    render(<TopBar {...props} autopilot={null} />);
    expect(chip()).toBeNull();
  });

  it('says when auto-pilot is running', () => {
    render(<TopBar {...props} autopilot={state({ state: 'running' })} />);
    expect(chip()?.textContent).toBe('auto-pilot running');
    expect(chip()?.className).toContain('ap-running');
  });

  it('says halted, whatever the reason was', () => {
    render(<TopBar {...props} autopilot={state({ state: 'halted', reason: 'killed' })} />);
    expect(chip()?.textContent).toBe('halted');
    expect(chip()?.className).toContain('ap-halted');
  });

  it('names the reason it stopped', () => {
    render(<TopBar {...props} autopilot={state({ state: 'stopped', reason: 'exhausted' })} />);
    expect(chip()?.textContent).toBe('exhausted');
  });

  // The line the study draws, on screen: only one of these ended with the work done.
  // Over STOP_REASONS, not a hand-written list. The list here omitted `killed` and `unreadable` — both
  // added during the slice that wrote it — so the UI half lacked the property the core test has: a reason
  // added later fails this until someone decides which side of the line it is on.
  it('styles only `complete` as a success', () => {
    for (const reason of STOP_REASONS) {
      cleanup();
      render(<TopBar {...props} autopilot={state({ state: 'stopped', reason })} />);
      const success = chip()?.className.includes('ap-complete');
      expect(success, reason).toBe(reason === 'complete');
    }
  });

  // A halt carries the sentence that explains it; the chip is one word, so the sentence is the tooltip.
  it('carries the detail as its tooltip', () => {
    render(<TopBar {...props} autopilot={state({ state: 'halted', detail: 'You stopped everything.' })} />);
    expect(chip()?.getAttribute('title')).toBe('You stopped everything.');
  });
});
