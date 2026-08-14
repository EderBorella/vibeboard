// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UtilityDock } from '../web/src/components/UtilityDock.js';
import type { DockPane } from '../web/src/dock/panes.js';

afterEach(cleanup);

// Fake panes throughout: the dock's contract is about the strip, the collapse and which pane is
// mounted, none of which should need a card fixture to state.
const pane = (id: string, over: Partial<DockPane> = {}): DockPane => ({
  id,
  label: id.toUpperCase(),
  render: () => <div data-testid={`body-${id}`}>{id} body</div>,
  ...over,
});

const props = {
  activeId: null as string | null,
  onPane: vi.fn(),
  collapsed: false,
  onCollapse: vi.fn(),
};

describe('UtilityDock', () => {
  it('renders a tab per pane and mounts only the active body', () => {
    render(<UtilityDock {...props} panes={[pane('cards'), pane('terminal')]} activeId="cards" />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['CARDS', 'TERMINAL']);
    expect(screen.getByTestId('body-cards')).toBeTruthy();
    expect(screen.queryByTestId('body-terminal')).toBeNull();
  });

  it('renders nothing at all with no panes', () => {
    // An empty strip would cost the boards a row of height for chrome that can do nothing.
    const { container } = render(<UtilityDock {...props} panes={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('marks the active tab and reports a click on another', () => {
    const onPane = vi.fn();
    render(
      <UtilityDock
        {...props}
        onPane={onPane}
        panes={[pane('cards'), pane('terminal')]}
        activeId="terminal"
      />,
    );
    const [cards, terminal] = screen.getAllByRole('tab');
    expect(terminal.getAttribute('aria-selected')).toBe('true');
    expect(cards.getAttribute('aria-selected')).toBe('false');
    // Exact class, not a substring: this is the bytes the CSS keys off, and `not.toContain` is
    // satisfied by any wrong class at all.
    expect(terminal.className).toBe('dock-tab active');
    expect(cards.className).toBe('dock-tab');
    cards.click();
    expect(onPane.mock.calls).toEqual([['cards']]);
  });

  it('shows the badge only for a pane that has one, 0 included', () => {
    const { container } = render(
      <UtilityDock
        {...props}
        panes={[pane('cards', { badge: 3 }), pane('terminal', { badge: 0 }), pane('logs')]}
      />,
    );
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['CARDS3', 'TERMINAL0', 'LOGS']);
    // Counting the elements, not the text: an empty badge span reads the same as none at all.
    expect(container.querySelectorAll('.dock-badge')).toHaveLength(2);
  });

  it('hides the body when collapsed instead of unmounting it', () => {
    // Unmounting would take a terminal's scrollback with it, so collapse must be presentational.
    const { container } = render(<UtilityDock {...props} panes={[pane('cards')]} collapsed />);
    expect(screen.getByTestId('body-cards')).toBeTruthy();
    expect(container.querySelector('.dock-body')?.hasAttribute('hidden')).toBe(true);
  });

  it('reports the collapse toggle and labels it by what it will do', () => {
    const onCollapse = vi.fn();
    const { rerender } = render(<UtilityDock {...props} onCollapse={onCollapse} panes={[pane('cards')]} />);
    const toggle = screen.getByTitle('Collapse the dock');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('▾'); // points the way it will move
    toggle.click();
    expect(onCollapse).toHaveBeenCalledTimes(1);

    rerender(<UtilityDock {...props} onCollapse={onCollapse} panes={[pane('cards')]} collapsed />);
    const expand = screen.getByTitle('Expand the dock');
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(expand.textContent).toBe('▴');
  });

  it('keeps a keepMounted pane in the DOM while another is active, hidden', () => {
    const { container } = render(
      <UtilityDock
        {...props}
        panes={[pane('cards'), pane('terminal', { keepMounted: true })]}
        activeId="cards"
      />,
    );
    // Both mounted, exactly one visible — this is the property a terminal needs.
    expect(screen.getByTestId('body-terminal')).toBeTruthy();
    const panes = [...container.querySelectorAll('.dock-pane')];
    expect(panes.map((p) => p.hasAttribute('hidden'))).toEqual([false, true]);
  });
});
