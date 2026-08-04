// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { STOP_REASONS } from '../src/core/dispatch-gate.js';
import type { AutopilotState } from '../web/src/api.js';
import { TopBar } from '../web/src/components/TopBar.js';

afterEach(cleanup);

const props = {
  showProject: true,
  projectName: 'Demo',
  tab: 'boards' as 'boards' | 'execution' | 'control' | 'explorer',
  onTab: vi.fn(),
  theme: 'cyberpunk',
  onTheme: vi.fn(),
  copilotOpen: true,
  onToggleCopilot: vi.fn(),
  onSettings: vi.fn(),
  onSwitchProject: vi.fn(),
  attentionCount: 0,
  conn: 'open',
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
    const { container } = render(<TopBar {...props} conn="closed" />);
    const dot = container.querySelector('.conn');
    expect(dot?.className).toContain('conn-closed');
    expect(dot?.getAttribute('title')).toBe('WebSocket closed');
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
    ]);
    expect(select.value).toBe('classic-dark');
  });

  it('reflects the connection state in a title and a class', () => {
    render(<TopBar {...withProps({ conn: 'closed' })} />);
    const dot = screen.getByTitle('WebSocket closed');
    expect(dot.className).toContain('conn-closed');
  });
});

// One word for what auto-pilot is doing. The load-bearing part is which stops read as a success:
// "an error or an exhausted budget never counts as success", so `complete` is styled apart from the
// rest rather than every ended run looking equally finished.
describe('the auto-pilot chip', () => {
  const state = (over: Partial<AutopilotState>): AutopilotState => ({
    state: 'stopped',
    iteration: 0,
    dispatchesSinceCheckup: 0,
    needsCheckup: false,
    ...over,
  });

  const chip = (): HTMLElement | null => document.querySelector('.ap-chip');

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
