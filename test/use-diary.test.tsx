// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry } from '../web/src/api.js';

const api = vi.hoisted(() => ({ listDiary: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

// One subscriber set per test, so a socket message reaches the hook under test and nothing else.
const ws = vi.hoisted(() => {
  const subscribers = new Set<(msg: { type: string; entry?: unknown }) => void>();
  return {
    subscribers,
    useSharedWs: () => ({
      subscribe: (fn: (msg: { type: string; entry?: unknown }) => void) => {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },
    }),
  };
});
vi.mock('../web/src/ws.js', () => ({ useSharedWs: ws.useSharedWs }));
vi.mock('../web/src/ws', () => ({ useSharedWs: ws.useSharedWs }));

const { useDiary } = await import('../web/src/diary/useDiary.js');

afterEach(() => {
  cleanup();
  api.listDiary.mockReset();
  ws.subscribers.clear();
});

const entry = (text: string): DiaryEntry => ({
  at: '2026-08-05T10:00:00.000Z',
  kind: 'lifecycle',
  text,
});

// Rendered through a probe rather than tested as a bare function: hooks need a component, and asserting on
// what a consumer would see is closer to the thing that matters than poking at the returned object.
function Probe({ bump }: { bump: number }) {
  const { entries, failed } = useDiary(bump);
  return (
    <div>
      <span data-testid="texts">{entries.map((e) => e.text).join(',')}</span>
      <span data-testid="failed">{String(failed)}</span>
    </div>
  );
}

const texts = () => screen.getByTestId('texts').textContent;

describe('useDiary', () => {
  it('starts empty and fills from the endpoint', async () => {
    api.listDiary.mockResolvedValue([entry('one'), entry('two')]);
    render(<Probe bump={0} />);
    // Empty on the first paint, which is why the view renders its own "nothing yet" rather than a spinner.
    expect(texts()).toBe('');
    await waitFor(() => expect(texts()).toBe('one,two'));
  });

  // Oldest first, exactly as the file is written. Reversing here would mean the hook and the endpoint
  // disagreed about what "the diary" is, and the view would have to know which one it had.
  it('keeps the order the endpoint gave', async () => {
    api.listDiary.mockResolvedValue([entry('older'), entry('newer')]);
    render(<Probe bump={0} />);
    await waitFor(() => expect(texts()).toBe('older,newer'));
  });

  // The socket half is not a nicety: PROJECT-LOG.md is excluded from the watcher, so nothing else would
  // ever tell this tab that auto-pilot has written twenty lines since it was opened.
  it('adds a pushed entry without refetching', async () => {
    api.listDiary.mockResolvedValue([entry('first')]);
    render(<Probe bump={0} />);
    await waitFor(() => expect(texts()).toBe('first'));

    for (const fn of ws.subscribers) fn({ type: 'diary:entry', entry: entry('pushed') });
    await waitFor(() => expect(texts()).toBe('first,pushed'));
    expect(api.listDiary).toHaveBeenCalledTimes(1);
  });

  it('refetches when the project changes', async () => {
    api.listDiary.mockResolvedValue([entry('project A')]);
    const { rerender } = render(<Probe bump={0} />);
    await waitFor(() => expect(texts()).toBe('project A'));

    api.listDiary.mockResolvedValue([entry('project B')]);
    rerender(<Probe bump={1} />);
    await waitFor(() => expect(texts()).toBe('project B'));
    expect(api.listDiary).toHaveBeenCalledTimes(2);
  });

  // A switch must not leave the previous project's narrative on screen — it would read as this project's.
  it('does not keep the old project’s entries when the new one has none', async () => {
    api.listDiary.mockResolvedValue([entry('project A')]);
    const { rerender } = render(<Probe bump={0} />);
    await waitFor(() => expect(texts()).toBe('project A'));

    api.listDiary.mockResolvedValue([]);
    rerender(<Probe bump={1} />);
    await waitFor(() => expect(texts()).toBe(''));
  });

  it('reports a failed read rather than an empty diary', async () => {
    api.listDiary.mockRejectedValue(new Error('nope'));
    render(<Probe bump={0} />);
    await waitFor(() => expect(screen.getByTestId('failed').textContent).toBe('true'));
    expect(texts()).toBe('');
  });

  it('stops reporting a failure once a read succeeds', async () => {
    api.listDiary.mockRejectedValue(new Error('nope'));
    const { rerender } = render(<Probe bump={0} />);
    await waitFor(() => expect(screen.getByTestId('failed').textContent).toBe('true'));

    api.listDiary.mockResolvedValue([entry('back')]);
    rerender(<Probe bump={1} />);
    await waitFor(() => expect(screen.getByTestId('failed').textContent).toBe('false'));
  });
});
