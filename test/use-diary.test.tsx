// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry } from '../web/src/api.js';

const api = vi.hoisted(() => ({ listDiary: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

// The shared socket, faked the way the REAL one is keyed: one object per `bump`, memoised. The first
// version ignored its argument and returned a fresh literal per render, which un-gated two things at once —
// that the hook passes `bump` at all (slice D's `useAutopilot(0)` defect, which opened a second socket per
// tab), and the `[ws]` dependency, since a new identity every render makes any dep list look correct.
const ws = vi.hoisted(() => {
  const sockets = new Map<number, { subscribe: (fn: (m: Msg) => void) => () => void }>();
  const subscribers = new Map<number, Set<(m: Msg) => void>>();
  const asked: number[] = [];
  type Msg = { type: string; entry?: unknown };
  const useSharedWs = (bump: number) => {
    asked.push(bump);
    const existing = sockets.get(bump);
    if (existing) return existing;
    const set = new Set<(m: Msg) => void>();
    subscribers.set(bump, set);
    const socket = {
      subscribe: (fn: (m: Msg) => void) => {
        set.add(fn);
        return () => set.delete(fn);
      },
    };
    sockets.set(bump, socket);
    return socket;
  };
  return {
    useSharedWs,
    asked,
    sockets,
    reset: () => {
      sockets.clear();
      subscribers.clear();
      asked.length = 0;
    },
    // Only the subscribers of that bump's socket, like the real thing.
    push: (msg: Msg, bump = 0) => {
      for (const fn of subscribers.get(bump) ?? []) fn(msg);
    },
    count: (bump: number) => (subscribers.get(bump) ?? new Set()).size,
  };
});
vi.mock('../web/src/ws.js', () => ({ useSharedWs: ws.useSharedWs }));
vi.mock('../web/src/ws', () => ({ useSharedWs: ws.useSharedWs }));

const { useDiary } = await import('../web/src/diary/useDiary.js');

afterEach(() => {
  cleanup();
  api.listDiary.mockReset();
  ws.reset();
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

    ws.push({ type: 'diary:entry', entry: entry('pushed') });
    await waitFor(() => expect(texts()).toBe('first,pushed'));
    expect(api.listDiary).toHaveBeenCalledTimes(1);
  });

  // Slice D's defect, asserted rather than described. `useAutopilot(0)` hard-coded App's project counter
  // against a last-write-wins cache, which opened a SECOND socket for the tab. Prose in a commit body does
  // not stop that coming back; this does.
  it('subscribes to the open project’s socket, not to bump zero', async () => {
    api.listDiary.mockResolvedValue([]);
    render(<Probe bump={7} />);
    await waitFor(() => expect(ws.asked).toContain(7));
    expect(ws.asked).not.toContain(0);
    expect(ws.sockets.size).toBe(1);
  });

  it('resubscribes to the new socket after a project switch, and lets the old one go', async () => {
    api.listDiary.mockResolvedValue([]);
    const { rerender } = render(<Probe bump={0} />);
    await waitFor(() => expect(ws.count(0)).toBe(1));

    rerender(<Probe bump={1} />);
    await waitFor(() => expect(ws.count(1)).toBe(1));
    // Unsubscribed from the project it left: a push on the old socket must not reach this tab.
    expect(ws.count(0)).toBe(0);
  });

  // A push for the project we just left is not ours. Without keying the fake, every push reached everyone.
  it('ignores a push on the socket of a project it has left', async () => {
    api.listDiary.mockResolvedValue([entry('B')]);
    const { rerender } = render(<Probe bump={0} />);
    rerender(<Probe bump={1} />);
    await waitFor(() => expect(texts()).toBe('B'));
    ws.push({ type: 'diary:entry', entry: entry('stale') }, 0);
    expect(texts()).toBe('B');
  });

  // The route broadcasts AFTER the append, so the entry may not be in the response already on its way back.
  // Overwriting with that response lost the push for good — and it is the FIRST fetch, so the window is open
  // on every mount.
  it('does not lose a push that arrives while the first fetch is in flight', async () => {
    let release: (v: DiaryEntry[]) => void = () => {};
    api.listDiary.mockReturnValueOnce(
      new Promise<DiaryEntry[]>((resolve) => {
        release = resolve;
      }),
    );
    render(<Probe bump={0} />);
    await waitFor(() => expect(ws.count(0)).toBe(1));

    // Pushed before the fetch answers, and the answer does not contain it.
    ws.push({ type: 'diary:entry', entry: entry('pushed mid-flight') });
    api.listDiary.mockResolvedValue([entry('from disk'), entry('pushed mid-flight')]);
    release([entry('from disk')]);

    await waitFor(() => expect(texts()).toBe('from disk,pushed mid-flight'));
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
