// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAction } from '../web/src/useAction.js';

describe('useAction', () => {
  it('is busy for as long as the call is, and not after a refusal', async () => {
    // The `finally`, which every hand-written copy had: a refusal that left the flag set would leave
    // a permanently disabled button with the reason underneath it.
    let refuse: (e: unknown) => void = () => {};
    const { result } = renderHook(() => useAction());
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.run(
        () =>
          new Promise<void>((_, reject) => {
            refuse = reject;
          }),
      );
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      refuse(new Error('Already running the maximum'));
      await pending;
    });
    expect(result.current.busy).toBeNull();
    expect(result.current.error).toBe('Already running the maximum');
  });

  it('reports whether the call landed, and clears the previous refusal when a new one starts', async () => {
    const { result } = renderHook(() => useAction());
    let landed = true;
    await act(async () => {
      landed = await result.current.run(() => Promise.reject(new Error('nope')));
    });
    expect(landed).toBe(false);
    expect(result.current.error).toBe('nope');
    await act(async () => {
      landed = await result.current.run(() => Promise.resolve());
    });
    expect(landed).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('describes a rejection that is not an Error', async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => {
      await result.current.run(() => Promise.reject('gone'));
    });
    expect(result.current.error).toBe('gone');
  });

  it('keys busy to the button that was pressed', async () => {
    // What the three keyed panels need: both buttons are on screen, and a shared boolean would spin
    // the one nobody touched.
    let land: () => void = () => {};
    const { result } = renderHook(() => useAction<'restart' | 'takeover'>());
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.run(
        () =>
          new Promise<void>((resolve) => {
            land = resolve;
          }),
        'takeover',
      );
    });
    expect(result.current.busy).toBe('takeover');
    await act(async () => {
      land();
      await pending;
    });
    expect(result.current.busy).toBeNull();
  });

  it('reports a failure to a parent that owns the banner', async () => {
    const report = vi.fn();
    const { result } = renderHook(() => useAction(report));
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('refused')));
    });
    // Cleared first, then told: a stale reason beside a fresh attempt reads as the new one failing.
    expect(report.mock.calls).toEqual([[null], ['refused']]);
  });
});
