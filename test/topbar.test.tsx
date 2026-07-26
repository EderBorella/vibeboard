// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { TopBar } from '../web/src/components/TopBar.js';

afterEach(cleanup);

const props = {
  showProject: true,
  projectName: 'Demo',
  tab: 'boards' as 'boards' | 'control',
  onTab: vi.fn(),
  theme: 'cyberpunk',
  onTheme: vi.fn(),
  copilotOpen: true,
  onToggleCopilot: vi.fn(),
  onSettings: vi.fn(),
  onSwitchProject: vi.fn(),
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
