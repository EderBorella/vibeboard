// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCollapsedBoards, useDockCollapsed, useTheme } from '../web/src/lib/useLocalPrefs.js';

// These preferences belong to the browser, not the project. The storage keys are load-bearing:
// changing one silently loses everybody's saved preference, so they are asserted literally.
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('useTheme', () => {
  it('defaults to cyberpunk and applies it to the document', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('cyberpunk');
    expect(document.documentElement.dataset.theme).toBe('cyberpunk');
    expect(localStorage.getItem('vb-theme')).toBe('cyberpunk');
  });

  it('restores a stored theme in preference to the default', () => {
    localStorage.setItem('vb-theme', 'classic-dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('classic-dark');
    expect(document.documentElement.dataset.theme).toBe('classic-dark');
  });

  it('ignores a blank stored value and falls back to the default', () => {
    localStorage.setItem('vb-theme', '');
    expect(renderHook(() => useTheme()).result.current[0]).toBe('cyberpunk');
  });

  it('persists and applies a change', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]('classic-dark'));
    expect(result.current[0]).toBe('classic-dark');
    expect(document.documentElement.dataset.theme).toBe('classic-dark');
    expect(localStorage.getItem('vb-theme')).toBe('classic-dark');
  });
});

describe('useCollapsedBoards', () => {
  it('starts with nothing collapsed', () => {
    expect(renderHook(() => useCollapsedBoards()).result.current[0].size).toBe(0);
  });

  it('restores a stored set', () => {
    localStorage.setItem('vb-collapsed', JSON.stringify(['product', 'features']));
    const [collapsed] = renderHook(() => useCollapsedBoards()).result.current;
    expect([...collapsed].sort()).toEqual(['features', 'product']);
  });

  it.each(['not json', '{}', '42'])('recovers from the stored value %p', (raw) => {
    localStorage.setItem('vb-collapsed', raw);
    expect(renderHook(() => useCollapsedBoards()).result.current[0].size).toBe(0);
  });

  it('toggles a board on and back off, persisting each time', () => {
    const { result } = renderHook(() => useCollapsedBoards());

    act(() => result.current[1]('engineering'));
    expect([...result.current[0]]).toEqual(['engineering']);
    expect(localStorage.getItem('vb-collapsed')).toBe(JSON.stringify(['engineering']));

    act(() => result.current[1]('engineering'));
    expect(result.current[0].size).toBe(0);
    expect(localStorage.getItem('vb-collapsed')).toBe('[]');
  });

  it('keeps boards independent', () => {
    const { result } = renderHook(() => useCollapsedBoards());
    act(() => result.current[1]('product'));
    act(() => result.current[1]('features'));
    expect([...result.current[0]].sort()).toEqual(['features', 'product']);
    act(() => result.current[1]('product'));
    expect([...result.current[0]]).toEqual(['features']);
  });
});

describe('useDockCollapsed', () => {
  it('starts expanded', () => {
    expect(renderHook(() => useDockCollapsed()).result.current[0]).toBe(false);
  });

  it('restores a stored collapse', () => {
    localStorage.setItem('vb-dock-collapsed', '1');
    expect(renderHook(() => useDockCollapsed()).result.current[0]).toBe(true);
  });

  it.each(['0', '', 'true', 'yes'])('treats the stored value %p as expanded', (raw) => {
    // Only the literal '1' collapses — anything else, including a truthy-looking string, must not.
    localStorage.setItem('vb-dock-collapsed', raw);
    expect(renderHook(() => useDockCollapsed()).result.current[0]).toBe(false);
  });

  it('sets and persists each value', () => {
    const { result } = renderHook(() => useDockCollapsed());

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('vb-dock-collapsed')).toBe('1');

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem('vb-dock-collapsed')).toBe('0');
  });

  it('writes the value it is given even when it matches, so a no-op still records', () => {
    const { result } = renderHook(() => useDockCollapsed());
    act(() => result.current[1](false));
    expect(localStorage.getItem('vb-dock-collapsed')).toBe('0');
  });
});
