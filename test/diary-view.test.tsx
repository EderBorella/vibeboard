// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry } from '../web/src/api.js';

const api = vi.hoisted(() => ({ listDiary: vi.fn(), addDiaryEntry: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

// The shared socket, stubbed to a subscriber this test can fire. The real one opens a connection; what
// matters here is that a pushed entry appears without a refetch.
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
    push: (msg: { type: string; entry?: unknown }) => {
      for (const fn of subscribers) fn(msg);
    },
  };
});
vi.mock('../web/src/ws.js', () => ({ useSharedWs: ws.useSharedWs }));
vi.mock('../web/src/ws', () => ({ useSharedWs: ws.useSharedWs }));

const { DiaryView } = await import('../web/src/components/DiaryView.js');

afterEach(() => {
  cleanup();
  api.listDiary.mockReset();
  api.addDiaryEntry.mockReset();
  ws.subscribers.clear();
});

const entry = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  at: '2026-08-05T10:00:00.000Z',
  kind: 'lifecycle',
  text: 'something happened',
  ...over,
});

describe('the project log', () => {
  it('renders an entry per event', async () => {
    api.listDiary.mockResolvedValue([entry({ text: 'first' }), entry({ text: 'second' })]);
    render(<DiaryView bump={0} />);
    expect(await screen.findByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
  });

  // Newest first on screen, oldest first on disk. A file is read forwards; a feed is read backwards.
  it('puts the newest first, which is not the order the file is in', async () => {
    api.listDiary.mockResolvedValue([
      entry({ at: '2026-08-05T09:00:00.000Z', text: 'older' }),
      entry({ at: '2026-08-05T11:00:00.000Z', text: 'newer' }),
    ]);
    render(<DiaryView bump={0} />);
    await screen.findByText('older');
    const rendered = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rendered[0]).toContain('newer');
    expect(rendered[1]).toContain('older');
  });

  it('shows what a run entry was about', async () => {
    api.listDiary.mockResolvedValue([
      entry({
        kind: 'run',
        iteration: 3,
        card: 'E-001',
        board: 'engineering',
        skill: 'implement',
        outcome: 'success',
        text: 'Added the token store.',
      }),
    ]);
    render(<DiaryView bump={0} />);
    expect(await screen.findByText('Added the token store.')).toBeTruthy();
    expect(screen.getByText('iteration 3')).toBeTruthy();
    expect(screen.getByText('engineering/E-001')).toBeTruthy();
    expect(screen.getByText('implement')).toBeTruthy();
    expect(screen.getByText('success')).toBeTruthy();
  });

  // A checkup is about the project. Inventing an em dash for every absent field would make every entry
  // look the same shape and hide which ones were about a card.
  it('shows no card for an entry that had none', async () => {
    api.listDiary.mockResolvedValue([entry({ kind: 'checkup', text: 'Archived two stale cards.' })]);
    render(<DiaryView bump={0} />);
    await screen.findByText('Archived two stale cards.');
    expect(screen.queryByText('/')).toBeNull();
  });

  it('says so when nothing has happened, rather than rendering an empty screen', async () => {
    api.listDiary.mockResolvedValue([]);
    render(<DiaryView bump={0} />);
    expect(await screen.findByText(/Nothing has happened/)).toBeTruthy();
  });

  // "Nothing has happened" and "we could not find out what happened" are different facts, and this is the
  // file a reader comes to precisely when they want to know which.
  it('distinguishes a failed read from an empty diary, and offers a way back', async () => {
    api.listDiary.mockRejectedValue(new Error('nope'));
    render(<DiaryView bump={0} />);
    expect(await screen.findByText(/Could not read/)).toBeTruthy();
    expect(screen.queryByText(/Nothing has happened/)).toBeNull();

    api.listDiary.mockResolvedValue([entry({ text: 'back' })]);
    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByText('back')).toBeTruthy();
  });

  it('appends an entry pushed by the server without asking for the file again', async () => {
    api.listDiary.mockResolvedValue([entry({ text: 'first' })]);
    render(<DiaryView bump={0} />);
    await screen.findByText('first');
    expect(api.listDiary).toHaveBeenCalledTimes(1);

    ws.push({ type: 'diary:entry', entry: entry({ at: '2026-08-05T12:00:00.000Z', text: 'pushed' }) });
    expect(await screen.findByText('pushed')).toBeTruthy();
    // The whole point: one line arrived, so the whole growing file was not re-read to learn it.
    expect(api.listDiary).toHaveBeenCalledTimes(1);
  });

  it('ignores a pushed message that carries no entry', async () => {
    api.listDiary.mockResolvedValue([entry({ text: 'first' })]);
    render(<DiaryView bump={0} />);
    await screen.findByText('first');
    ws.push({ type: 'diary:entry' });
    ws.push({ type: 'something:else', entry: entry({ text: 'not mine' }) });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('adding to the log by hand', () => {
  const compose = () => screen.getByLabelText('Add to the log') as HTMLTextAreaElement;

  it('posts what was typed and clears the box', async () => {
    api.listDiary.mockResolvedValue([]);
    api.addDiaryEntry.mockResolvedValue(entry({ text: 'I rebased the branch.' }));
    render(<DiaryView bump={0} />);
    await screen.findByText(/Nothing has happened/);

    fireEvent.change(compose(), { target: { value: 'I rebased the branch.' } });
    fireEvent.click(screen.getByText('Add entry'));
    await waitFor(() =>
      expect(api.addDiaryEntry).toHaveBeenCalledWith({ kind: 'lifecycle', text: 'I rebased the branch.' }),
    );
    await waitFor(() => expect(compose().value).toBe(''));
  });

  it('will not post an empty entry, or one that is only spaces', async () => {
    api.listDiary.mockResolvedValue([]);
    render(<DiaryView bump={0} />);
    await screen.findByText(/Nothing has happened/);
    const button = screen.getByText('Add entry').closest('button') as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    fireEvent.change(compose(), { target: { value: '   ' } });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(api.addDiaryEntry).not.toHaveBeenCalled();
  });

  // A paragraph about why somebody did something is not recoverable from anywhere else. Clearing the box
  // before the write lands throws it away the moment the post fails.
  it('keeps what was typed when the post fails, and says why', async () => {
    api.listDiary.mockResolvedValue([]);
    api.addDiaryEntry.mockRejectedValue(new Error('A diary entry needs something to say'));
    render(<DiaryView bump={0} />);
    await screen.findByText(/Nothing has happened/);

    fireEvent.change(compose(), { target: { value: 'why I did it' } });
    fireEvent.click(screen.getByText('Add entry'));
    expect(await screen.findByText(/needs something to say/)).toBeTruthy();
    expect(compose().value).toBe('why I did it');
  });
});
