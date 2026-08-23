// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../web/src/lib/shared.js';

const api = vi.hoisted(() => ({
  getRaw: vi.fn(async () => '---\nid: E-001\n---\n\nfile body'),
  putRaw: vi.fn(async () => undefined),
}));
vi.mock('../web/src/lib/api.js', () => api);
vi.mock('../web/src/lib/api', () => api);

const { RawPane } = await import('../web/src/organisms/cards/RawPane.js');

afterEach(cleanup);
beforeEach(() => {
  api.getRaw.mockClear();
  api.putRaw.mockClear();
  api.getRaw.mockImplementation(async () => '---\nid: E-001\n---\n\nfile body');
});

const card = (id = 'E-001'): Card =>
  ({
    id,
    title: id,
    board: 'engineering',
    columnSlug: 'todo',
    order: 0,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: '',
    filePath: `/tmp/${id}.md`,
  }) as Card;

const area = (): HTMLTextAreaElement => screen.getByLabelText('card file') as HTMLTextAreaElement;

describe('RawPane', () => {
  it('reads the file for the card it is given and shows it verbatim', async () => {
    await act(async () => {
      render(<RawPane card={card()} />);
    });
    expect(api.getRaw.mock.calls).toEqual([['engineering', 'E-001']]);
    // Exact bytes: a frontmatter block is all separators, which a normalising query would flatten.
    expect(area().value).toBe('---\nid: E-001\n---\n\nfile body');
  });

  it('cannot save until the draft differs from the file', async () => {
    await act(async () => {
      render(<RawPane card={card()} />);
    });
    const save = screen.getByText('Save file') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(area(), { target: { value: 'edited' } });
    expect((screen.getByText('Save file') as HTMLButtonElement).disabled).toBe(false);
  });

  it('writes the draft, then goes quiet again until the next change', async () => {
    await act(async () => {
      render(<RawPane card={card()} />);
    });
    fireEvent.change(area(), { target: { value: 'edited' } });
    await act(async () => {
      screen.getByText('Save file').click();
    });
    expect(api.putRaw.mock.calls).toEqual([['engineering', 'E-001', 'edited']]);
    expect((screen.getByText('Save file') as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces a failed read, stops loading, and offers nothing to save', async () => {
    api.getRaw.mockImplementation(async () => {
      throw new Error('Failed to load card file');
    });
    await act(async () => {
      render(<RawPane card={card()} />);
    });
    expect(screen.getByText('Failed to load card file')).toBeTruthy();
    // Not still "Loading…": the read is over, it just failed.
    expect(area().placeholder).toBe('');
    // And nothing to write — saving an empty box over the file would destroy it.
    expect(screen.getByText('Save file')).toHaveProperty('disabled', true);
  });

  it('does not report a failed read for a card it no longer shows', async () => {
    // The cancel flag has to cover the failure path too, or switching tab during a slow read
    // decorates the new card with the old one's error.
    let failFirst: ((e: Error) => void) | undefined;
    api.getRaw.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          failFirst = reject;
        }),
    );
    api.getRaw.mockImplementationOnce(async () => 'contents of E-002');

    const { container, rerender } = render(<RawPane card={card('E-001')} />);
    await act(async () => {
      rerender(<RawPane card={card('E-002')} />);
    });
    await act(async () => failFirst?.(new Error('Failed to load card file')));

    expect(container.querySelector('.raw-error')).toBeNull();
    expect(area().value).toBe('contents of E-002');
  });

  it('surfaces a failed write and leaves the draft alone to try again', async () => {
    api.putRaw.mockImplementation(async () => {
      throw new Error('Failed to save card file');
    });
    await act(async () => {
      render(<RawPane card={card()} />);
    });
    fireEvent.change(area(), { target: { value: 'edited' } });
    await act(async () => {
      screen.getByText('Save file').click();
    });
    expect(screen.getByText('Failed to save card file')).toBeTruthy();
    expect(area().value).toBe('edited');
    // Still savable: the write did not happen, so the button must not look done.
    expect((screen.getByText('Save file') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the loading placeholder with an empty box until the file arrives', async () => {
    let release: ((text: string) => void) | undefined;
    api.getRaw.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    render(<RawPane card={card()} />);
    expect(area().value).toBe('');
    expect(area().placeholder).toBe('Loading…');
    expect(screen.getByText('Save file')).toHaveProperty('disabled', true);

    await act(async () => release?.('landed'));
    expect(area().value).toBe('landed');
    expect(area().placeholder).toBe('');
  });

  it('re-reads when the card changes, and never applies the older read', async () => {
    // A tab switch under a slow read. Without the cancel flag — or with the effect not keyed on the
    // card — the first file lands in the second card's pane.
    let releaseFirst: ((text: string) => void) | undefined;
    api.getRaw.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    api.getRaw.mockImplementationOnce(async () => 'contents of E-002');

    const { rerender } = render(<RawPane card={card('E-001')} />);
    await act(async () => {
      rerender(<RawPane card={card('E-002')} />);
    });
    expect(area().value).toBe('contents of E-002');

    await act(async () => releaseFirst?.('contents of E-001'));
    expect(area().value).toBe('contents of E-002');
    expect(api.getRaw.mock.calls).toEqual([
      ['engineering', 'E-001'],
      ['engineering', 'E-002'],
    ]);
  });

  it('disables the button while the write is in flight, so it cannot be sent twice', async () => {
    let finish: (() => void) | undefined;
    api.putRaw.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    await act(async () => {
      render(<RawPane card={card()} />);
    });
    fireEvent.change(area(), { target: { value: 'edited' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save file'));
    });
    expect(screen.getByText('Save file')).toHaveProperty('disabled', true);

    await act(async () => finish?.());
    // Still disabled afterwards, but now because the draft matches the file.
    expect(screen.getByText('Save file')).toHaveProperty('disabled', true);
  });

  it('shows no error row until something fails', async () => {
    const { container } = await act(async () => render(<RawPane card={card()} />));
    expect(container.querySelector('.raw-error')).toBeNull();
  });
});
