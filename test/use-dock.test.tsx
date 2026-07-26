// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDock } from '../web/src/dock/useDock.js';

beforeEach(() => localStorage.clear());

describe('useDock', () => {
  it('starts on no particular pane, unfolded', () => {
    const { result } = renderHook(() => useDock());
    expect(result.current.pane).toBeNull();
    expect(result.current.collapsed).toBe(false);
  });

  it('restores a collapse from a previous session', () => {
    localStorage.setItem('vb-dock-collapsed', '1');
    expect(renderHook(() => useDock()).result.current.collapsed).toBe(true);
  });

  it('show brings a pane up', () => {
    const { result } = renderHook(() => useDock());
    act(() => result.current.show('cards'));
    expect(result.current.pane).toBe('cards');
  });

  it('show unfolds a collapsed dock, so the pane is actually visible', () => {
    // The bug this exists for: opening a card into a folded dock queues it out of sight, which
    // reads as the click having done nothing.
    localStorage.setItem('vb-dock-collapsed', '1');
    const { result } = renderHook(() => useDock());
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.show('cards'));
    expect(result.current.collapsed).toBe(false);
    expect(result.current.pane).toBe('cards');
    // Persisted, so the next card does not fold it again.
    expect(localStorage.getItem('vb-dock-collapsed')).toBe('0');
  });

  it('show leaves an already-open dock alone', () => {
    const { result } = renderHook(() => useDock());
    act(() => result.current.show('cards'));
    expect(result.current.collapsed).toBe(false);
  });

  it('toggle folds and unfolds, persisting each way', () => {
    const { result } = renderHook(() => useDock());

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem('vb-dock-collapsed')).toBe('1');

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem('vb-dock-collapsed')).toBe('0');
  });

  it('keeps the pane it was showing across a fold', () => {
    const { result } = renderHook(() => useDock());
    act(() => result.current.show('cards'));
    act(() => result.current.toggle());
    expect(result.current.pane).toBe('cards');
  });
});
