// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listCardRuns: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { useCardRuns } = await import('../web/src/runs/useCardRuns.js');

const runs = (...ids: string[]) =>
  ids.map((run) => ({
    run,
    card: 'E-001',
    board: 'engineering' as const,
    skill: 'execute',
    status: 'done' as const,
    started: '2026-07-26T10:00:00.000Z',
    backend: 'claude',
    model: 'sonnet',
    effort: 'medium',
    mode: 'build',
    report: '',
  }));

beforeEach(() => api.listCardRuns.mockReset());

describe('useCardRuns', () => {
  it('asks for the card in front of you, by board and id', async () => {
    api.listCardRuns.mockResolvedValue(runs('r1'));
    const { result } = renderHook(() => useCardRuns('product', 'P-007', 0));
    await waitFor(() => expect(result.current.map((r) => r.run)).toEqual(['r1']));
    expect(api.listCardRuns).toHaveBeenCalledWith('product', 'P-007');
  });

  it('fetches nothing when there is no card open', () => {
    // The dock renders with no card selected; a request for `undefined` would 404 on every mount.
    api.listCardRuns.mockResolvedValue(runs('r1'));
    const { result } = renderHook(() => useCardRuns(undefined, undefined, 0));
    expect(result.current).toEqual([]);
    expect(api.listCardRuns).not.toHaveBeenCalled();
  });

  it('clears the previous card’s runs when the card closes', async () => {
    // Not merely "does not fetch": the runs of the card you just closed must not linger under the
    // next thing you open.
    api.listCardRuns.mockResolvedValue(runs('r1'));
    const { result, rerender } = renderHook(
      ({ card }: { card: string | undefined }) => useCardRuns('engineering', card, 0),
      { initialProps: { card: 'E-001' as string | undefined } },
    );
    await waitFor(() => expect(result.current.map((r) => r.run)).toEqual(['r1']));
    rerender({ card: undefined });
    expect(result.current).toEqual([]);
  });

  it('refetches when the card changes', async () => {
    api.listCardRuns.mockResolvedValueOnce(runs('r1')).mockResolvedValueOnce(runs('r2'));
    const { result, rerender } = renderHook(({ card }) => useCardRuns('engineering', card, 0), {
      initialProps: { card: 'E-001' },
    });
    await waitFor(() => expect(result.current.map((r) => r.run)).toEqual(['r1']));
    rerender({ card: 'E-002' });
    await waitFor(() => expect(result.current.map((r) => r.run)).toEqual(['r2']));
  });

  it('refetches when the trigger changes, so a finishing run appears without a reload', async () => {
    api.listCardRuns.mockResolvedValueOnce(runs('r1')).mockResolvedValueOnce(runs('r1', 'r2'));
    const { result, rerender } = renderHook(({ t }) => useCardRuns('engineering', 'E-001', t), {
      initialProps: { t: 0 },
    });
    await waitFor(() => expect(result.current.map((r) => r.run)).toEqual(['r1']));
    rerender({ t: 1 });
    await waitFor(() => expect(result.current.map((r) => r.run)).toEqual(['r1', 'r2']));
  });

  it('does not refetch when nothing changed', async () => {
    api.listCardRuns.mockResolvedValue(runs('r1'));
    const { rerender } = renderHook(({ t }) => useCardRuns('engineering', 'E-001', t), {
      initialProps: { t: 0 },
    });
    await waitFor(() => expect(api.listCardRuns).toHaveBeenCalledTimes(1));
    rerender({ t: 0 });
    expect(api.listCardRuns).toHaveBeenCalledTimes(1);
  });

  it('keeps what it had when a refetch fails, rather than blanking the section', async () => {
    api.listCardRuns.mockResolvedValueOnce(runs('r1')).mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(({ t }) => useCardRuns('engineering', 'E-001', t), {
      initialProps: { t: 0 },
    });
    await waitFor(() => expect(result.current.map((r) => r.run)).toEqual(['r1']));
    rerender({ t: 1 });
    await waitFor(() => expect(api.listCardRuns).toHaveBeenCalledTimes(2));
    expect(result.current.map((r) => r.run)).toEqual(['r1']);
  });

  it('ignores a slow response for a card you have already left', async () => {
    let landFirst: (l: unknown) => void = () => {};
    api.listCardRuns
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            landFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(runs('r2'));

    const { result, rerender } = renderHook(({ card }) => useCardRuns('engineering', card, 0), {
      initialProps: { card: 'E-001' },
    });
    rerender({ card: 'E-002' });
    await waitFor(() => expect(result.current.map((r) => r.run)).toEqual(['r2']));

    await act(async () => {
      landFirst(runs('r1'));
    });
    expect(result.current.map((r) => r.run)).toEqual(['r2']);
  });
});
