import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked before the module under test is imported, so saveCard closes over these.
vi.mock('../web/src/api.js', () => ({
  createCard: vi.fn(async (input: unknown) => ({ ...(input as object), id: 'E-042', board: 'engineering' })),
  patchCard: vi.fn(async () => undefined),
  putRaw: vi.fn(async () => undefined),
  getRaw: vi.fn(async () => ''),
  setLinks: vi.fn(async () => undefined),
}));

import { createCard, patchCard, putRaw, setLinks } from '../web/src/api.js';
import { initialFields, type SaveInput, saveCard } from '../web/src/components/CardEditor.js';
import type { Card } from '../web/src/shared.js';

const card = (over: Partial<Card> = {}): Card =>
  ({ id: 'E-001', board: 'engineering', title: 'T', tags: [], links: [], ...over }) as Card;

const fields = {
  title: 'Title',
  description: 'Desc',
  tags: 'a, b',
  group: 'g',
  body: 'Body',
};

const input = (over: Partial<SaveInput> = {}): SaveInput => ({
  editor: { mode: 'create', board: 'engineering', columnSlug: 'todo' },
  tab: 'form',
  fields,
  links: [],
  raw: '',
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('saveCard', () => {
  it('creates, then sets links by the id the server assigned', async () => {
    await saveCard(input({ links: ['P-001'] }));

    expect(createCard).toHaveBeenCalledWith(
      expect.objectContaining({ board: 'engineering', columnSlug: 'todo', title: 'Title' }),
    );
    // The new card's own id, not anything the caller knew beforehand.
    expect(setLinks).toHaveBeenCalledWith('engineering', 'E-042', ['P-001']);
    expect(patchCard).not.toHaveBeenCalled();
  });

  it('parses tags from the comma-separated field', async () => {
    await saveCard(input());
    expect(createCard).toHaveBeenCalledWith(expect.objectContaining({ tags: ['a', 'b'] }));
  });

  it('sends blank optional fields as undefined when creating', async () => {
    await saveCard(input({ fields: { ...fields, description: '', group: '', body: '' } }));
    const arg = vi.mocked(createCard).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(arg.description).toBeUndefined();
    expect(arg.group).toBeUndefined();
    expect(arg.body).toBeUndefined();
  });

  it('patches an existing card and reconciles its links', async () => {
    await saveCard(input({ editor: { mode: 'edit', card: card() }, links: ['P-002'] }));

    expect(patchCard).toHaveBeenCalledWith(
      'engineering',
      'E-001',
      expect.objectContaining({ title: 'Title' }),
    );
    expect(setLinks).toHaveBeenCalledWith('engineering', 'E-001', ['P-002']);
    expect(createCard).not.toHaveBeenCalled();
  });

  it('writes the file verbatim from the raw tab, touching nothing else', async () => {
    await saveCard(
      input({ editor: { mode: 'edit', card: card() }, tab: 'raw', raw: '---\nid: E-001\n---\nbody' }),
    );

    expect(putRaw).toHaveBeenCalledWith('engineering', 'E-001', '---\nid: E-001\n---\nbody');
    expect(patchCard).not.toHaveBeenCalled();
    expect(setLinks).not.toHaveBeenCalled();
  });

  it('ignores the raw tab when creating, since there is no file yet', async () => {
    await saveCard(input({ tab: 'raw' }));
    expect(putRaw).not.toHaveBeenCalled();
    expect(createCard).toHaveBeenCalled();
  });

  it('lets a failure propagate so the caller can surface it', async () => {
    vi.mocked(patchCard).mockRejectedValueOnce(new Error('409 taken'));
    await expect(saveCard(input({ editor: { mode: 'edit', card: card() } }))).rejects.toThrow('409 taken');
  });
});

describe('initialFields', () => {
  it('is all blank when creating', () => {
    expect(initialFields(null)).toEqual({ title: '', description: '', tags: '', group: '', body: '' });
  });

  it('joins tags for the text input and defaults missing values to blank', () => {
    expect(initialFields(card({ tags: ['x', 'y'], title: 'T' }))).toEqual({
      title: 'T',
      description: '',
      tags: 'x, y',
      group: '',
      body: '',
    });
  });
});
