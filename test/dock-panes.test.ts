import { describe, expect, it } from 'vitest';
import { activePane, type DockPane, visiblePanes } from '../web/src/dock/panes.js';

const pane = (id: string, hasContent: boolean): DockPane => ({
  id,
  label: id,
  hasContent,
  render: () => null,
});

describe('visiblePanes', () => {
  it('keeps the panes with content, in declaration order', () => {
    const panes = [pane('cards', true), pane('terminal', false), pane('logs', true)];
    expect(visiblePanes(panes).map((p) => p.id)).toEqual(['cards', 'logs']);
  });

  it('is empty when nothing has content', () => {
    expect(visiblePanes([pane('cards', false)])).toEqual([]);
  });
});

describe('activePane', () => {
  it('picks the requested pane while it has content', () => {
    const panes = [pane('cards', true), pane('terminal', true)];
    expect(activePane(panes, 'terminal')?.id).toBe('terminal');
  });

  it('falls back to the first visible pane when the requested one loses its content', () => {
    // Close your last card with the terminal open: the Cards pane leaves the strip, and the
    // dock cannot keep pointing at it.
    const panes = [pane('cards', false), pane('terminal', true)];
    expect(activePane(panes, 'cards')?.id).toBe('terminal');
  });

  it('falls back to the first visible pane when nothing has been requested', () => {
    expect(activePane([pane('cards', true), pane('terminal', true)], null)?.id).toBe('cards');
  });

  it('is null when no pane has content, so the dock can render nothing', () => {
    expect(activePane([pane('cards', false)], 'cards')).toBeNull();
    expect(activePane([], null)).toBeNull();
  });
});
