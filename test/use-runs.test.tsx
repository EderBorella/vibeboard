// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listRuns: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { useRuns } = await import('../web/src/runs/useRuns.js');

const list = (...ids: string[]) => ({
  runs: ids.map((run) => ({
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
  })),
  active: [],
  queued: [],
});

beforeEach(() => {
  api.listRuns.mockReset();
});

describe('useRuns', () => {
  it('starts empty on all three lists, so the dashboard renders before the fetch lands', () => {
    api.listRuns.mockResolvedValue(list('r1'));
    const { result } = renderHook(() => useRuns(0));
    expect(result.current).toEqual({ runs: [], active: [], queued: [] });
  });

  it('serves the whole list — records, active ids and queued ids', async () => {
    // active/queued are not derivable from the records: only the server knows which runs it is
    // actually holding, so a hook that dropped them would silently make the dashboard guess.
    api.listRuns.mockResolvedValue({ ...list('r1', 'r2'), active: ['r1'], queued: ['r2'] });
    const { result } = renderHook(() => useRuns(0));
    await waitFor(() => expect(result.current.runs.map((r) => r.run)).toEqual(['r1', 'r2']));
    expect(result.current.active).toEqual(['r1']);
    expect(result.current.queued).toEqual(['r2']);
  });

  it('refetches when the trigger changes, so a status written on disk reaches the dashboard', async () => {
    api.listRuns.mockResolvedValueOnce(list('r1')).mockResolvedValueOnce(list('r1', 'r2'));
    const { result, rerender } = renderHook(({ t }) => useRuns(t), { initialProps: { t: 0 } });
    await waitFor(() => expect(result.current.runs.map((r) => r.run)).toEqual(['r1']));
    rerender({ t: 1 });
    await waitFor(() => expect(result.current.runs.map((r) => r.run)).toEqual(['r1', 'r2']));
    expect(api.listRuns).toHaveBeenCalledTimes(2);
  });

  it('does not refetch when the trigger is unchanged', async () => {
    api.listRuns.mockResolvedValue(list('r1'));
    const { rerender } = renderHook(({ t }) => useRuns(t), { initialProps: { t: 0 } });
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(1));
    rerender({ t: 0 });
    expect(api.listRuns).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good list when a refetch fails', async () => {
    api.listRuns.mockResolvedValueOnce(list('r1')).mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(({ t }) => useRuns(t), { initialProps: { t: 0 } });
    await waitFor(() => expect(result.current.runs.map((r) => r.run)).toEqual(['r1']));
    rerender({ t: 1 });
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(2));
    expect(result.current.runs.map((r) => r.run)).toEqual(['r1']);
  });

  it('ignores a slow response that lands after the trigger moved on', async () => {
    // What the cancel flag is for: a first fetch resolving late would otherwise overwrite the newer
    // list, showing runs that have since changed status.
    let landFirst: (l: unknown) => void = () => {};
    api.listRuns
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            landFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(list('r2'));

    const { result, rerender } = renderHook(({ t }) => useRuns(t), { initialProps: { t: 0 } });
    rerender({ t: 1 });
    await waitFor(() => expect(result.current.runs.map((r) => r.run)).toEqual(['r2']));

    await act(async () => {
      landFirst(list('r1'));
    });
    expect(result.current.runs.map((r) => r.run)).toEqual(['r2']);
  });
});
