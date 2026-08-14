// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFetched } from '../web/src/useFetched.js';

// The cancel flag and the refetch trigger are pinned by the hooks that use them
// (use-skills, use-runs, use-card-runs, use-dispatch). What is pinned HERE is the part those hooks
// disagreed about before there was one home for it: what a rejection, and a question nobody asked,
// do to the value already on screen.

describe('useFetched — what a rejection does', () => {
  it('keeps the last good value by default, and says it failed', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(({ t }) => useFetched(fetcher, [t], 'blank'), {
      initialProps: { t: 0 },
    });
    await waitFor(() => expect(result.current.value).toBe('first'));
    rerender({ t: 1 });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.value).toBe('first');
  });

  it('empties back to the initial value when the caller asked for that', async () => {
    // A menu of what can be chosen now, rather than a record: keeping one backend's model aliases
    // on screen after a failed read offers a choice that may no longer exist.
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(['sonnet'])
      .mockRejectedValueOnce(new Error('offline'));
    const empty: string[] = [];
    const { result, rerender } = renderHook(
      ({ t }) => useFetched(fetcher, [t], empty, { onFailure: 'clear' }),
      { initialProps: { t: 0 } },
    );
    await waitFor(() => expect(result.current.value).toEqual(['sonnet']));
    rerender({ t: 1 });
    await waitFor(() => expect(result.current.value).toEqual([]));
  });

  it('clears an earlier failure when a good answer arrives', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('second');
    const { result, rerender } = renderHook(({ t }) => useFetched(fetcher, [t], 'blank'), {
      initialProps: { t: 0 },
    });
    await waitFor(() => expect(result.current.failed).toBe(true));
    rerender({ t: 1 });
    await waitFor(() => expect(result.current.value).toBe('second'));
    expect(result.current.failed).toBe(false);
  });
});

describe('useFetched — what not asking does', () => {
  it('asks nothing while disabled, and keeps what it had', async () => {
    const fetcher = vi.fn().mockResolvedValue('answer');
    const { result, rerender } = renderHook(
      ({ on }) => useFetched(fetcher, [0], 'blank', { enabled: on }),
      { initialProps: { on: true } },
    );
    await waitFor(() => expect(result.current.value).toBe('answer'));
    rerender({ on: false });
    expect(result.current.value).toBe('answer');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('empties while disabled when the subject itself has gone', async () => {
    // Not merely "does not fetch", and synchronously: the runs of the card you just closed must not
    // linger under the next thing you open, not even for a render. The answer has to have LANDED
    // first, or the assertion holds for the initial value and tests nothing.
    const fetcher = vi.fn().mockResolvedValue('answer');
    const { result, rerender } = renderHook(
      ({ on }) => useFetched(fetcher, [0], 'blank', { enabled: on, onDisabled: 'clear' }),
      { initialProps: { on: true } },
    );
    await waitFor(() => expect(result.current.value).toBe('answer'));
    rerender({ on: false });
    expect(result.current.value).toBe('blank');
  });

  it('serves a local change without re-reading the whole list', async () => {
    const fetcher = vi.fn().mockResolvedValue(['a']);
    const { result } = renderHook(() => useFetched(fetcher, [0], [] as string[]));
    await waitFor(() => expect(result.current.value).toEqual(['a']));
    act(() => result.current.setValue((current) => [...current, 'b']));
    expect(result.current.value).toEqual(['a', 'b']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
