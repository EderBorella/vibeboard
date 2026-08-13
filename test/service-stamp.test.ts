import { describe, expect, it } from 'vitest';
import type { BoardName, Card } from '../src/core/types.js';
import type { StampDeps } from '../src/service/stamp.js';
import { stamp } from '../src/service/stamp.js';

const CARD = (id = 'F-001', board: BoardName = 'features'): Card => ({
  id,
  title: id,
  order: 10,
  tags: [],
  links: [],
  created: '2026-08-13',
  board,
  columnSlug: 'backlog',
  body: '',
  filePath: `/tmp/${id}.md`,
});

// Records every call in the order it was made, so a test can assert the move happened BEFORE the diary line
// rather than merely that both happened.
function recorder(over: { move?: { ok: false; reason: string; fatal: boolean } } = {}) {
  const calls: string[] = [];
  const diary: { kind: string; text: string; details: unknown }[] = [];
  const writes: string[] = [];
  const client = {
    move: async (board: BoardName, card: string, to: string) => {
      calls.push(`move:${board}/${card}->${to}`);
      return over.move ?? { ok: true as const, value: {} };
    },
    log: async (kind: string, text: string, details: unknown) => {
      calls.push(`log:${kind}`);
      diary.push({ kind, text, details });
      return { ok: true as const, value: {} };
    },
    // Present so a test can prove nothing reached for it: a stamp that wrote the card file directly would
    // bypass every validation an agent's move goes through (decision 10).
    updateCard: async (path: string) => {
      writes.push(path);
    },
  };
  return { deps: { client } as unknown as StampDeps, calls, diary, writes, client };
}

describe('stamping a column', () => {
  it('stamps a column through the move endpoint, never by writing a file', async () => {
    const { deps, calls, writes } = recorder();
    const answer = await stamp(deps, CARD(), 'todo', 'it is starting this feature’s break-down.');
    expect(answer.ok).toBe(true);
    expect(calls[0]).toBe('move:features/F-001->todo');
    expect(writes).toEqual([]);
  });

  it('writes a diary line for every stamp the loop makes', async () => {
    // A card that moved with no account of why is a board nobody can read backwards.
    const { deps, diary } = recorder();
    await stamp(deps, CARD(), 'todo', 'it is starting this feature’s break-down.');
    expect(diary).toHaveLength(1);
    expect(diary[0].kind).toBe('lifecycle');
    expect(diary[0].text).toContain('F-001');
    expect(diary[0].text).toContain('todo');
    expect(diary[0].text).toContain('break-down');
  });

  it('carries the card and board as structured fields, not only in the sentence', async () => {
    // `DiaryEntry` carries them so the diary's readers do not have to regex prose.
    const { deps, diary } = recorder();
    await stamp(deps, CARD('E-007', 'engineering'), 'review', 'its implement run completed.');
    expect(diary[0].details).toMatchObject({ card: 'E-007', board: 'engineering' });
  });

  it('reports a refusal without throwing, and says whether it is fatal', async () => {
    const { deps } = recorder({ move: { ok: false, reason: 'Forbidden', fatal: true } });
    const answer = await stamp(deps, CARD(), 'todo', 'why');
    expect(answer).toMatchObject({ ok: false, reason: 'Forbidden', fatal: true });
  });

  it('does not decide what a refusal means', async () => {
    // `fatal` is carried rather than acted on: whether to stop the loop depends on what the caller had
    // already spent, which this module cannot know.
    const { deps } = recorder({ move: { ok: false, reason: 'connect ECONNREFUSED', fatal: false } });
    expect(await stamp(deps, CARD(), 'todo', 'why')).toMatchObject({ ok: false, fatal: false });
  });

  it('writes no diary line when the move was refused', async () => {
    // A record of something that did not happen is worse than no record.
    const { deps, diary } = recorder({ move: { ok: false, reason: 'Forbidden', fatal: true } });
    await stamp(deps, CARD(), 'todo', 'why');
    expect(diary).toEqual([]);
  });
});
