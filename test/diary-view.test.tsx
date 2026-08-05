// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry } from '../web/src/api.js';

const api = vi.hoisted(() => ({ listDiary: vi.fn(), addDiaryEntry: vi.fn() }));
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

const { DiaryView } = await import('../web/src/components/DiaryView.js');

afterEach(() => {
  cleanup();
  api.listDiary.mockReset();
  api.addDiaryEntry.mockReset();
  ws.reset();
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
    const item = (await screen.findByText('Archived two stale cards.')).closest('li') as HTMLElement;
    // The chips themselves, empty. The first version asserted `queryByText('/')` was null, which can never
    // match `engineering/E-001` — so a chip invented from any field would have sailed through it.
    expect(item.querySelectorAll('.diary-chip')).toHaveLength(0);
  });

  it('shows a chip for each field that is there, and no others', async () => {
    api.listDiary.mockResolvedValue([entry({ kind: 'run', card: 'E-001', text: 'did a thing' })]);
    render(<DiaryView bump={0} />);
    const item = (await screen.findByText('did a thing')).closest('li') as HTMLElement;
    expect([...item.querySelectorAll('.diary-chip')].map((c) => c.textContent)).toEqual(['E-001']);
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

  // Asserted AFTER a real entry has been through the same channel, which is what makes the negative mean
  // something. The first version asserted immediately and passed even when every message appended — React had
  // not flushed yet, so the list was still length 1 for the wrong reason. `waitFor` does not fix that either:
  // it returns on the first check that does not throw.
  it('ignores a pushed message that carries no entry', async () => {
    api.listDiary.mockResolvedValue([entry({ text: 'first' })]);
    render(<DiaryView bump={0} />);
    await screen.findByText('first');

    ws.push({ type: 'diary:entry' });
    ws.push({ type: 'something:else', entry: entry({ text: 'not mine' }) });
    // A message that SHOULD append, pushed last: once it has arrived, anything the two above would have
    // added has arrived too, so the count is a real answer rather than a not-yet.
    ws.push({ type: 'diary:entry', entry: entry({ at: '2026-08-05T12:00:00.000Z', text: 'real' }) });
    expect(await screen.findByText('real')).toBeTruthy();

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('not mine')).toBeNull();
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

  // The socket carries an append to the OTHER tabs. This is the tab that posted it, and its own entry used to
  // appear only on the next fetch — so the person who just wrote a line saw nothing happen.
  it('shows the entry it just wrote, as the server recorded it', async () => {
    api.listDiary.mockResolvedValue([]);
    api.addDiaryEntry.mockResolvedValue(
      entry({ at: '2026-08-05T12:00:00.000Z', text: 'as the server saved it' }),
    );
    render(<DiaryView bump={0} />);
    await screen.findByText(/Nothing has happened/);

    fireEvent.change(compose(), { target: { value: 'as I typed it' } });
    fireEvent.click(screen.getByText('Add entry'));
    // The SERVER's copy: it carries the real timestamp and whatever the server made of the rest.
    expect(await screen.findByText('as the server saved it')).toBeTruthy();
    expect(screen.queryByText('as I typed it')).toBeNull();
  });

  // New entries arrive over the socket, and a dropped socket is invisible — reconnecting does not change
  // `bump`, and the server replays only the board snapshot. Without a way to ask again, the log sits stale.
  it('offers a refresh even when the last read succeeded', async () => {
    api.listDiary.mockResolvedValue([entry({ text: 'first' })]);
    render(<DiaryView bump={0} />);
    await screen.findByText('first');

    api.listDiary.mockResolvedValue([entry({ text: 'first' }), entry({ text: 'later' })]);
    fireEvent.click(screen.getByText('Refresh'));
    expect(await screen.findByText('later')).toBeTruthy();
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
