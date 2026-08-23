// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CopilotConfig } from '../web/src/lib/shared.js';
import { useCopilotChoice } from '../web/src/lib/useCopilotChoice.js';

const configured = (over: Partial<CopilotConfig> = {}): CopilotConfig =>
  ({
    backend: 'claude-code',
    backends: {
      'claude-code': { model: 'sonnet', effort: 'low' },
      opencode: { model: 'opencode/x', effort: 'max' },
    },
    ...over,
  }) as CopilotConfig;

describe('useCopilotChoice', () => {
  it('starts from the configured defaults with no override', () => {
    const { result } = renderHook(() => useCopilotChoice(configured()));
    expect(result.current.choice).toEqual({ backend: 'claude-code', model: 'sonnet', effort: 'low' });
    expect(result.current.overridden).toBe(false);
  });

  it('applies model and effort overrides independently', () => {
    const { result } = renderHook(() => useCopilotChoice(configured()));
    act(() => result.current.setModel('haiku'));
    expect(result.current.choice).toMatchObject({ model: 'haiku', effort: 'low' });
    expect(result.current.overridden).toBe(true);

    act(() => result.current.setEffort('high'));
    expect(result.current.choice).toMatchObject({ model: 'haiku', effort: 'high' });
  });

  it('drops model and effort when the backend changes — they belonged to the one being left', () => {
    const { result } = renderHook(() => useCopilotChoice(configured()));
    act(() => result.current.setModel('haiku'));
    act(() => result.current.setEffort('high'));

    act(() => result.current.setBackend('opencode'));
    // Resolved from the opencode slot, not carried over from the claude one.
    expect(result.current.choice).toEqual({
      backend: 'opencode',
      model: 'opencode/x',
      effort: 'max',
    });
  });

  it('ignores a backend switch to the one already in force, keeping the rest of the override', () => {
    const { result } = renderHook(() => useCopilotChoice(configured()));
    act(() => result.current.setModel('haiku'));
    act(() => result.current.setBackend('claude-code')); // already the resolved backend
    expect(result.current.choice).toMatchObject({ backend: 'claude-code', model: 'haiku' });
  });

  it('reset returns to the configured defaults', () => {
    const { result } = renderHook(() => useCopilotChoice(configured()));
    act(() => result.current.setModel('haiku'));
    act(() => result.current.reset());
    expect(result.current.choice).toMatchObject({ model: 'sonnet' });
    expect(result.current.overridden).toBe(false);
  });

  // A Settings save is an explicit statement of intent, so it must clear the session override —
  // otherwise a stale dock value keeps winning over the defaults just changed.
  it('clears the override when the configured block changes', () => {
    const { result, rerender } = renderHook(({ cfg }) => useCopilotChoice(cfg), {
      initialProps: { cfg: configured() },
    });
    act(() => result.current.setModel('haiku'));
    expect(result.current.overridden).toBe(true);

    rerender({
      cfg: configured({
        backends: {
          'claude-code': { model: 'opus', effort: 'low' },
          opencode: { model: 'opencode/x', effort: 'max' },
        },
      }),
    });
    expect(result.current.overridden).toBe(false);
    expect(result.current.choice).toMatchObject({ model: 'opus' });
  });

  it('clears the override even when only another backend slot changed', () => {
    const { result, rerender } = renderHook(({ cfg }) => useCopilotChoice(cfg), {
      initialProps: { cfg: configured() },
    });
    act(() => result.current.setModel('haiku'));

    rerender({
      cfg: configured({
        backends: {
          'claude-code': { model: 'sonnet', effort: 'low' },
          opencode: { model: 'opencode/CHANGED', effort: 'max' },
        },
      }),
    });
    expect(result.current.overridden).toBe(false);
  });

  it('keeps the override across a re-render with an unchanged config', () => {
    const cfg = configured();
    const { result, rerender } = renderHook(({ c }) => useCopilotChoice(c), {
      initialProps: { c: cfg },
    });
    act(() => result.current.setModel('haiku'));
    // A new object with identical content must not count as a change.
    rerender({ c: configured() });
    expect(result.current.choice).toMatchObject({ model: 'haiku' });
    expect(result.current.overridden).toBe(true);
  });

  it('falls back to the built-in defaults with no configured block at all', () => {
    const { result } = renderHook(() => useCopilotChoice(undefined));
    expect(result.current.choice).toEqual({ backend: 'claude-code', model: 'opus', effort: 'high' });
    expect(result.current.overridden).toBe(false);
  });
});
