// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCS_DIR, INSTRUCTIONS_FILE, RESOURCES_DIR, skillRel } from '../src/core/layout.js';

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listControlFiles: vi.fn(),
  dispatchRun: vi.fn(),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { useDispatch } = await import('../web/src/runs/useDispatch.js');

const models = (...ids: string[]) => ids.map((id) => ({ id, free: true }));

const file = (category: string, path: string) => ({
  path,
  name: path.split('/').pop() ?? path,
  category,
  managed: false,
  deletable: true,
});

const groups = () => [
  { key: 'instructions', label: 'Instructions', files: [file('instructions', INSTRUCTIONS_FILE)] },
  { key: 'skills', label: 'Skills', files: [file('skills', skillRel('execute', 'SKILL.md'))] },
  {
    key: 'docs',
    label: 'Docs',
    files: [file('docs', `${DOCS_DIR}/guide.md`), file('docs', `${DOCS_DIR}/api.md`)],
  },
  { key: 'resources', label: 'Resources', files: [file('resources', `${RESOURCES_DIR}/notes.md`)] },
];

const request = { board: 'engineering' as const, card: 'E-001', skill: 'execute' };

beforeEach(() => {
  api.listModels.mockReset();
  api.listControlFiles.mockReset();
  api.dispatchRun.mockReset();
  api.listModels.mockResolvedValue(models('sonnet'));
  api.listControlFiles.mockResolvedValue(groups());
  api.dispatchRun.mockResolvedValue({ run: {} });
});

describe('useDispatch — the model list', () => {
  it('fetches the models of the chosen backend', async () => {
    const { result } = renderHook(() => useDispatch('opencode', 0));
    await waitFor(() => expect(result.current.models.map((m) => m.id)).toEqual(['sonnet']));
    expect(api.listModels).toHaveBeenCalledWith('opencode');
  });

  it('refetches when the backend changes — a model id belongs to one backend', async () => {
    api.listModels.mockResolvedValueOnce(models('sonnet')).mockResolvedValueOnce(models('opencode/nemotron'));
    const { result, rerender } = renderHook(({ b }) => useDispatch(b, 0), {
      initialProps: { b: 'claude' },
    });
    await waitFor(() => expect(result.current.models.map((m) => m.id)).toEqual(['sonnet']));
    rerender({ b: 'opencode' });
    await waitFor(() => expect(result.current.models.map((m) => m.id)).toEqual(['opencode/nemotron']));
  });

  it('does not refetch the models when only the trigger moves', async () => {
    // Why they are fetched here and not in the pane: switching card, or opening the form twice,
    // must cost no request.
    const { rerender } = renderHook(({ t }) => useDispatch('claude', t), {
      initialProps: { t: 0 },
    });
    await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(1));
    rerender({ t: 1 });
    await waitFor(() => expect(api.listControlFiles).toHaveBeenCalledTimes(2));
    expect(api.listModels).toHaveBeenCalledTimes(1);
  });

  it('leaves the list empty when the fetch fails, so the picker can fall back', async () => {
    api.listModels.mockReset();
    api.listModels.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useDispatch('claude', 0));
    await waitFor(() => expect(api.listModels).toHaveBeenCalled());
    expect(result.current.models).toEqual([]);
  });

  it('ignores a slow model list for a backend you have already switched away from', async () => {
    let landFirst: (m: unknown) => void = () => {};
    api.listModels
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            landFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(models('opencode/nemotron'));

    const { result, rerender } = renderHook(({ b }) => useDispatch(b, 0), {
      initialProps: { b: 'claude' },
    });
    rerender({ b: 'opencode' });
    await waitFor(() => expect(result.current.models.map((m) => m.id)).toEqual(['opencode/nemotron']));

    await act(async () => {
      landFirst(models('sonnet'));
    });
    expect(result.current.models.map((m) => m.id)).toEqual(['opencode/nemotron']);
  });
});

describe('useDispatch — the attachable files', () => {
  it('offers docs and resources only, as flat paths', async () => {
    // Instructions steer every turn already, and a skill attaching another skill is a confusion
    // rather than a feature.
    const { result } = renderHook(() => useDispatch('claude', 0));
    await waitFor(() =>
      expect(result.current.attachable).toEqual([
        `${DOCS_DIR}/guide.md`,
        `${DOCS_DIR}/api.md`,
        `${RESOURCES_DIR}/notes.md`,
      ]),
    );
  });

  it('refetches when the trigger changes, so a doc added now can be attached now', async () => {
    api.listControlFiles.mockReset();
    api.listControlFiles
      .mockResolvedValueOnce([{ key: 'docs', label: 'Docs', files: [file('docs', 'a.md')] }])
      .mockResolvedValueOnce([
        { key: 'docs', label: 'Docs', files: [file('docs', 'a.md'), file('docs', 'b.md')] },
      ]);
    const { result, rerender } = renderHook(({ t }) => useDispatch('claude', t), {
      initialProps: { t: 0 },
    });
    await waitFor(() => expect(result.current.attachable).toEqual(['a.md']));
    rerender({ t: 1 });
    await waitFor(() => expect(result.current.attachable).toEqual(['a.md', 'b.md']));
  });

  it('offers no attachments when the list fails, rather than a broken form', async () => {
    api.listControlFiles.mockReset();
    api.listControlFiles.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useDispatch('claude', 0));
    await waitFor(() => expect(api.listControlFiles).toHaveBeenCalled());
    expect(result.current.attachable).toEqual([]);
  });
});

describe('useDispatch — running one', () => {
  it('is not busy until asked, and clear of errors', () => {
    const { result } = renderHook(() => useDispatch('claude', 0));
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('reports busy while the dispatch is in flight and clear afterwards', async () => {
    let finish: () => void = () => {};
    api.dispatchRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ run: {} });
        }),
    );
    const { result } = renderHook(() => useDispatch('claude', 0));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.run(request);
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    await act(async () => {
      finish();
      await pending;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('passes the request through untouched', async () => {
    const { result } = renderHook(() => useDispatch('claude', 0));
    const full = { ...request, prompt: 'go', attachments: [`${DOCS_DIR}/api.md`], previous: 'r1' };
    await act(async () => {
      await result.current.run(full);
    });
    expect(api.dispatchRun).toHaveBeenCalledWith(full);
  });

  it('keeps the refusal AND rethrows it, so the pane stays open', async () => {
    // Both halves matter: the message is what the shell shows, and the throw is what stops the
    // pane closing on a run that never started.
    api.dispatchRun.mockRejectedValueOnce(new Error('Already running the maximum'));
    const { result } = renderHook(() => useDispatch('claude', 0));
    await act(async () => {
      await expect(result.current.run(request)).rejects.toThrow('Already running the maximum');
    });
    expect(result.current.error).toBe('Already running the maximum');
    expect(result.current.busy).toBe(false);
  });

  it('clears a previous error when the next dispatch is accepted', async () => {
    api.dispatchRun.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useDispatch('claude', 0));
    await act(async () => {
      await expect(result.current.run(request)).rejects.toThrow('nope');
    });
    await act(async () => {
      await result.current.run(request);
    });
    expect(result.current.error).toBeNull();
  });

  it('describes a rejection that is not an Error', async () => {
    api.dispatchRun.mockRejectedValueOnce('gone');
    const { result } = renderHook(() => useDispatch('claude', 0));
    await act(async () => {
      await expect(result.current.run(request)).rejects.toBe('gone');
    });
    expect(result.current.error).toBe('gone');
  });
});

// THE CREDENTIAL GATE, on BOTH fetches. Two endpoints, so a gate applied to one and not the other would
// still 401 on every first load — which is why this asserts both by name rather than "nothing was called".
describe('the credential gate', () => {
  it('asks for neither the models nor the control files while disabled', async () => {
    api.listModels.mockResolvedValue([]);
    api.listControlFiles.mockResolvedValue([]);
    const { rerender } = renderHook(({ on }) => useDispatch('claude-code', 1, on), {
      initialProps: { on: false },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.listModels).not.toHaveBeenCalled();
    expect(api.listControlFiles).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(api.listModels).toHaveBeenCalled());
    await waitFor(() => expect(api.listControlFiles).toHaveBeenCalled());
  });

  it('defaults to enabled, so every existing caller is unaffected', async () => {
    api.listModels.mockResolvedValue([]);
    api.listControlFiles.mockResolvedValue([]);
    renderHook(() => useDispatch('claude-code', 2));
    await waitFor(() => expect(api.listModels).toHaveBeenCalled());
  });
});
