// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Popover } from '../web/src/ui/Popover.js';

afterEach(cleanup);

const pop = (over: Partial<Parameters<typeof Popover>[0]> = {}) => (
  <Popover label="About this" trigger={<span>open me</span>} {...over}>
    <p>the contents</p>
  </Popover>
);

describe('Popover', () => {
  it('shows nothing until the trigger is clicked', () => {
    render(pop());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on click, and says so to a screen reader', () => {
    render(pop());
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('the contents');
    expect(dialog.getAttribute('aria-label')).toBe('About this');
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button').getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('closes on a second click of the same trigger', () => {
    render(pop());
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', () => {
    render(pop());
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a press elsewhere on the page', () => {
    render(pop());
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // The panel is there to be READ, and often to be copied out of. A press that lands inside must not
  // dismiss the thing under the pointer.
  it('stays open when the press is inside it', () => {
    render(pop());
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // Capture phase, so a panel inside a subtree that stops propagation is still dismissable. Without it
  // the listener never fires and the only way out is Escape.
  it('closes even when something between it and the document stops propagation', () => {
    render(
      <div
        onMouseDownCapture={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="swallower"
      >
        {pop()}
        <button type="button">elsewhere</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'open me' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Listeners only while open. A component that leaves a document-level keydown handler behind after
  // closing accumulates one per open, and they all fire.
  it('leaves no document listener behind once closed', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const origAdd = document.addEventListener.bind(document);
    const origRemove = document.removeEventListener.bind(document);
    document.addEventListener = ((t: string, ...rest: unknown[]) => {
      added.push(t);
      return (origAdd as (t: string, ...r: unknown[]) => void)(t, ...rest);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((t: string, ...rest: unknown[]) => {
      removed.push(t);
      return (origRemove as (t: string, ...r: unknown[]) => void)(t, ...rest);
    }) as typeof document.removeEventListener;
    try {
      render(pop());
      const button = screen.getByRole('button');
      fireEvent.click(button);
      fireEvent.click(button);
      expect(added.filter((t) => t === 'keydown').length).toBe(1);
      expect(removed.filter((t) => t === 'keydown').length).toBe(1);
      expect(added.filter((t) => t === 'mousedown').length).toBe(1);
      expect(removed.filter((t) => t === 'mousedown').length).toBe(1);
    } finally {
      document.addEventListener = origAdd;
      document.removeEventListener = origRemove;
    }
  });

  it('puts the caller’s classes on the trigger and the panel, alongside its own', () => {
    render(pop({ triggerClassName: 'mine-trigger', className: 'mine-panel', triggerTitle: 'a tip' }));
    const button = screen.getByRole('button');
    expect(button.className).toBe('mine-trigger');
    expect(button.getAttribute('title')).toBe('a tip');
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('popover');
    expect(dialog.className).toContain('mine-panel');
  });

  it('is a plain popover when the caller names no class', () => {
    render(pop());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').className).toBe('popover');
  });

  // Two on one page must not open together, and must not close each other's panel when their own
  // trigger is pressed. Both fall out of the wrapper-contains check, and neither is obvious.
  it('keeps two independent popovers independent', () => {
    render(
      <div>
        {pop({ label: 'first', trigger: <span>first</span> })}
        {pop({ label: 'second', trigger: <span>second</span> })}
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'first' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('first');

    fireEvent.mouseDown(screen.getByRole('button', { name: 'second' }));
    fireEvent.click(screen.getByRole('button', { name: 'second' }));
    const open = screen.getAllByRole('dialog');
    expect(open).toHaveLength(1);
    expect(open[0]?.getAttribute('aria-label')).toBe('second');
  });
});
