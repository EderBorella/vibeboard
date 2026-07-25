// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { TopBar } from '../web/src/components/TopBar.js';

afterEach(cleanup);

const props = {
  showProject: true,
  projectName: 'Demo',
  tab: 'boards' as const,
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
