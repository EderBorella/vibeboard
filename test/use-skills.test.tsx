// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { skillRel } from '../src/core/layout.js';

const api = vi.hoisted(() => ({ listSkills: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { useSkills } = await import('../web/src/skills/useSkills.js');

const catalogue = (slug: string) => ({
  skills: [
    {
      slug,
      path: skillRel(slug, 'SKILL.md'),
      name: slug,
      description: 'd',
      boards: [],
      columns: [],
      prompt: 'p',
    },
  ],
  invalid: [],
});

beforeEach(() => {
  api.listSkills.mockReset();
});

describe('useSkills', () => {
  it('starts empty, so the rail renders before the fetch lands', () => {
    api.listSkills.mockResolvedValue(catalogue('execute'));
    const { result } = renderHook(() => useSkills(0));
    expect(result.current).toEqual({ skills: [], invalid: [] });
  });

  it('serves the catalogue once it arrives', async () => {
    api.listSkills.mockResolvedValue(catalogue('execute'));
    const { result } = renderHook(() => useSkills(0));
    await waitFor(() => expect(result.current.skills.map((s) => s.slug)).toEqual(['execute']));
  });

  it('refetches when the trigger changes, so a skill written on disk shows up', async () => {
    api.listSkills.mockResolvedValueOnce(catalogue('execute')).mockResolvedValueOnce(catalogue('review'));
    const { result, rerender } = renderHook(({ t }) => useSkills(t), { initialProps: { t: 0 } });
    await waitFor(() => expect(result.current.skills.map((s) => s.slug)).toEqual(['execute']));
    rerender({ t: 1 });
    await waitFor(() => expect(result.current.skills.map((s) => s.slug)).toEqual(['review']));
    expect(api.listSkills).toHaveBeenCalledTimes(2);
  });

  it('does not refetch when the trigger is unchanged', async () => {
    api.listSkills.mockResolvedValue(catalogue('execute'));
    const { rerender } = renderHook(({ t }) => useSkills(t), { initialProps: { t: 0 } });
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledTimes(1));
    rerender({ t: 0 });
    expect(api.listSkills).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good catalogue when a refetch fails', async () => {
    // An empty rail would read as "this project has no skills"; the previous list is the least
    // misleading thing to show until the next trigger retries.
    api.listSkills.mockResolvedValueOnce(catalogue('execute')).mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(({ t }) => useSkills(t), { initialProps: { t: 0 } });
    await waitFor(() => expect(result.current.skills.map((s) => s.slug)).toEqual(['execute']));
    rerender({ t: 1 });
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledTimes(2));
    expect(result.current.skills.map((s) => s.slug)).toEqual(['execute']);
  });

  it('ignores a slow response that lands after the trigger moved on', async () => {
    // The cancel flag's actual job. Without it, a first fetch that resolves late overwrites the
    // newer catalogue, so the rail shows the previous project's — or the previous card's — skills.
    let landFirst: (c: unknown) => void = () => {};
    api.listSkills
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            landFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(catalogue('review'));

    const { result, rerender } = renderHook(({ t }) => useSkills(t), { initialProps: { t: 0 } });
    rerender({ t: 1 });
    await waitFor(() => expect(result.current.skills.map((s) => s.slug)).toEqual(['review']));

    await act(async () => {
      landFirst(catalogue('execute'));
    });
    expect(result.current.skills.map((s) => s.slug)).toEqual(['review']);
  });

  it('stays empty when the first fetch fails, rather than throwing into the render', async () => {
    // `Once`, not a persistent rejecting implementation: on a mocked-module export the persistent
    // form leaves a derived promise that vitest's end-of-test check reports as unhandled, even
    // though the hook's own catch demonstrably runs. One mount makes one call, so Once is exact.
    api.listSkills.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useSkills(0));
    await waitFor(() => expect(api.listSkills).toHaveBeenCalled());
    expect(result.current).toEqual({ skills: [], invalid: [] });
  });
});

// THE CREDENTIAL GATE. Same reason as useAutopilot: hooks run on mount before the render chooses the
// sign-in screen, so this asked for the catalogue with no cookie and took a 401 on every first load.
// A disabled fetch KEEPS the last catalogue rather than clearing it — an empty rail reads as "this
// project has no skills", which is the lie the hook's own comment exists to prevent.
describe('the credential gate', () => {
  it('asks nothing while disabled, and keeps what it already had', async () => {
    api.listSkills.mockResolvedValue({ skills: [{ slug: 'implement' }], invalid: [] });
    const { result, rerender } = renderHook(({ on }) => useSkills(1, on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.skills).toHaveLength(1));
    const asked = api.listSkills.mock.calls.length;

    rerender({ on: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.listSkills.mock.calls.length).toBe(asked);
    // Kept, not cleared.
    expect(result.current.skills).toHaveLength(1);
  });

  it('defaults to enabled, so every existing caller is unaffected', async () => {
    api.listSkills.mockResolvedValue({ skills: [], invalid: [] });
    renderHook(() => useSkills(2));
    await waitFor(() => expect(api.listSkills).toHaveBeenCalled());
  });
});
