import { describe, expect, it } from 'vitest';
import { activePane, type DockPane } from '../web/src/organisms/dock/panes.js';

const pane = (id: string): DockPane => ({ id, label: id, render: () => null });

describe('activePane', () => {
  it('picks the requested pane', () => {
    expect(activePane([pane('cards'), pane('terminal')], 'terminal')?.id).toBe('terminal');
  });

  it('falls back to the first pane when nothing has been requested', () => {
    expect(activePane([pane('cards'), pane('terminal')], null)?.id).toBe('cards');
  });

  it('falls back to the first pane when the requested id names none of them', () => {
    expect(activePane([pane('cards'), pane('terminal')], 'gone')?.id).toBe('cards');
  });

  it('is null with no panes, so the dock can render nothing', () => {
    expect(activePane([], null)).toBeNull();
    expect(activePane([], 'cards')).toBeNull();
  });
});
