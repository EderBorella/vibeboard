import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { readBoard } from '../src/core/board.js';
import { boardRel, SUGGESTIONS_DIR } from '../src/core/layout.js';
import type { Card, ProjectConfig } from '../src/core/types.js';
import { listSuggestions } from '../src/server/suggestion-store.js';
import { openTestProject, type TestProject } from './helpers.js';

// POST /api/suggestions/:id/card WHEN A WRITE FAILS PART WAY THROUGH. Every reason to REFUSE is answered
// before the first create (see the sibling file), and that leaves the two failures no check can see coming:
// a write that THROWS, and a suggestion that cannot be re-read after it was retired. Both used to leave the
// orphan this one endpoint exists to prevent — a flagged follow-up with no story under it, which the next
// tick picks up as a feature to break down and spends a model on.
//
// Two faults are one call deep inside the endpoint and no permission bit can produce them, so the seam is
// the module. SPIED, not replaced: the real implementation runs unless a test arms the fault, so nothing
// here can pass by neutering the thing it is testing.
const fault = vi.hoisted(() => ({ flagWrite: false, unreadable: false }));

vi.mock('../src/core/mutations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/mutations.js')>();
  return {
    ...actual,
    updateCard: async (...args: Parameters<typeof actual.updateCard>) => {
      // The FLAG write alone. `updateCard` is also how the compensation puts a reused parent's links back,
      // and failing that too would test the undo of the undo rather than the write that broke.
      if (fault.flagWrite && args[2] && 'followUp' in args[2]) throw new Error('the disk went away');
      return actual.updateCard(...args);
    },
  };
});

vi.mock('../src/server/suggestion-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/suggestion-store.js')>();
  return {
    ...actual,
    setSuggestionState: async (...args: Parameters<typeof actual.setSuggestionState>) => {
      // `null` is what the real one answers when the record cannot be re-read after it was written. It is a
      // return value rather than a throw, which is exactly why it slipped out as a 200.
      if (fault.unreadable) return null;
      return actual.setSuggestionState(...args);
    },
  };
});

// The exact sentence, once: it is prose a person reads, and `toContain` on a fragment of it would survive
// the half that says the finding was not lost.
const PARTIAL =
  'Carding that suggestion failed part way through. Everything it had created has been removed and the suggestion is still open, so nothing was lost — check the project folder is writable and try again.';

interface Carded {
  card: Card;
}

afterEach(() => {
  fault.flagWrite = false;
  fault.unreadable = false;
});

async function open(): Promise<TestProject> {
  return openTestProject({ name: 'S', mode: 'brownfield' });
}

async function file(project: TestProject, title: string): Promise<string> {
  const work = project.mint('work', 'run-7', 'E-001');
  const res = await project.app.inject({
    method: 'POST',
    url: '/api/suggestions',
    headers: { authorization: `Bearer ${work.token}` },
    payload: { title, body: 'what it found' },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { id: string }).id;
}

function card(project: TestProject, id: string, level: 'feature' | 'story') {
  return project.app.inject({
    method: 'POST',
    url: `/api/suggestions/${id}/card`,
    payload: { level },
  });
}

async function board(project: TestProject, name: 'features' | 'product'): Promise<Card[]> {
  return readBoard(project.root, name, project.session.config as ProjectConfig);
}

// A REAL failure in the way, not a stubbed one. A directory nothing may create a file in is what stops a
// CREATE; the mode is put back afterwards because vitest removes its run root at the end, and a directory
// nothing may write to is one whose contents nothing may delete either.
async function sealDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await chmod(path, 0o500);
  onTestFinished(() => chmod(path, 0o700));
}

// And a file nothing may overwrite is what stops an UPDATE — a directory's mode does not govern writes to
// files already in it, which is why the two helpers are not one.
async function sealFile(path: string): Promise<void> {
  await chmod(path, 0o400);
  onTestFinished(() => chmod(path, 0o600));
}

describe('a create that throws', () => {
  it('removes the follow-up it had just made when the story cannot be written', async () => {
    const project = await open();
    const id = await file(project, 'a story');
    // The reviewer's own repro: `product/backlog` unwritable, and one carding left a flagged follow-up
    // standing on the board with no story, the suggestion still active, and a raw 500 leaking the path.
    await sealDir(join(project.root, boardRel('product', 'backlog')));

    const res = await card(project, id, 'story');
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe(PARTIAL);
    // A sentence, not the server's filesystem. The raw 500 answered `EACCES ... open '<root>/...'`.
    expect(res.json().error).not.toContain(project.root);
    // ALL OF IT OR NONE: the follow-up is the create that comes FIRST, and a non-terminal feature with no
    // stories under it is what the next tick dispatches feature-breakdown at.
    expect(await board(project, 'features')).toEqual([]);
    expect(await board(project, 'product')).toEqual([]);
    expect(await listSuggestions(project.root)).toMatchObject([{ state: 'active' }]);
  });

  it('removes nothing it did not make when the feature cannot be written', async () => {
    const project = await open();
    const id = await file(project, 'A whole capability');
    await sealDir(join(project.root, boardRel('features', 'backlog')));

    const res = await card(project, id, 'feature');
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe(PARTIAL);
    expect(await board(project, 'features')).toEqual([]);
    expect(await listSuggestions(project.root)).toMatchObject([{ state: 'active' }]);
  });

  it('leaves no UNFLAGGED follow-up when the flag cannot be written', async () => {
    const project = await open();
    const id = await file(project, 'a story');
    fault.flagWrite = true;

    const res = await card(project, id, 'story');
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe(PARTIAL);
    // An unflagged follow-up is worse than none at all: `openFollowUp` reads the flag, so the next attempt
    // cannot see this one and makes a second — and decision 50's one-per-wave rule is quietly gone.
    expect(await board(project, 'features')).toEqual([]);
    expect(await board(project, 'product')).toEqual([]);
    expect(await listSuggestions(project.root)).toMatchObject([{ state: 'active' }]);
  });

  it('puts a reused follow-up back as it was when the back-reference cannot be written', async () => {
    const project = await open();
    // A follow-up already open, so this carding REUSES it — the case where undoing means putting a card
    // back rather than removing one.
    const made = await project.app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'features', columnSlug: 'backlog', title: 'Second wave' },
    });
    const followId = (made.json() as Card).id;
    await project.app.inject({
      method: 'POST',
      url: `/api/cards/features/${followId}/flags`,
      payload: { followUp: true },
    });
    const [follow] = await board(project, 'features');
    await sealFile(follow.filePath);

    const res = await card(project, await file(project, 'a story'), 'story');
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe(PARTIAL);
    // `setCardLinks` writes BOTH sides, so the story is gone and the follow-up is childless again — a
    // parent left holding a link to a file that is not there is a dangling edge nobody wrote.
    expect(await board(project, 'product')).toEqual([]);
    const [after] = await board(project, 'features');
    expect(after.id).toBe(followId);
    expect(after.links).toEqual([]);
    expect(await listSuggestions(project.root)).toMatchObject([{ state: 'active' }]);
  });
});

describe('a suggestion that cannot be retired', () => {
  it('removes the story and the follow-up when the record cannot be written', async () => {
    const project = await open();
    const id = await file(project, 'a story');
    // The LAST write of the three, so by the time it fails both cards exist.
    await sealFile(join(project.root, SUGGESTIONS_DIR, `${id}.md`));

    const res = await card(project, id, 'story');
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe(PARTIAL);
    expect(await board(project, 'features')).toEqual([]);
    expect(await board(project, 'product')).toEqual([]);
    // And the finding is still there to card again, which is the one outcome this channel exists to keep.
    expect(await listSuggestions(project.root)).toMatchObject([{ state: 'active' }]);
  });

  it('refuses rather than answering 200 with a null suggestion', async () => {
    const project = await open();
    const id = await file(project, 'a story');
    fault.unreadable = true;

    const res = await card(project, id, 'story');
    // It used to be a 200: a card on the board, the finding still `active` so it could be carded twice, and
    // a browser that reads `.id` off null and shows its own TypeError as the server's refusal.
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe(PARTIAL);
    expect(res.json().suggestion).toBeUndefined();
    expect(await board(project, 'features')).toEqual([]);
    expect(await board(project, 'product')).toEqual([]);
  });

  it('removes a carded FEATURE too when the record cannot be written', async () => {
    const project = await open();
    const id = await file(project, 'A whole capability');
    fault.unreadable = true;

    const res = await card(project, id, 'feature');
    expect(res.statusCode).toBe(500);
    // The top level writes one card and links nothing, and it is the same promise: a feature nobody asked
    // for is a feature the loop will pick up.
    expect(await board(project, 'features')).toEqual([]);
  });
});

// THREE AT ONCE. The one-open-follow-up invariant itself holds without a lock, because it fails closed on
// the id allocator's `wx` flag — what the losers used to get was a stack trace.
describe('three simultaneous cardings', () => {
  it('answers the losers a sentence, and leaves exactly one follow-up', async () => {
    const project = await open();
    const ids = [await file(project, 'one'), await file(project, 'two'), await file(project, 'three')];
    const answers = await Promise.all(ids.map((id) => card(project, id, 'story')));

    const won = answers.filter((a) => a.statusCode === 200);
    expect(won).toHaveLength(1);
    for (const lost of answers.filter((a) => a.statusCode !== 200)) {
      expect(lost.statusCode).toBe(500);
      expect(lost.json().error).toBe(PARTIAL);
    }
    // One follow-up, and the one story that got made is under it.
    const features = await board(project, 'features');
    expect(features).toHaveLength(1);
    expect(features[0].followUp).toBe(true);
    expect(features[0].links).toEqual([(won[0].json() as Carded).card.id]);
    // And two of the three findings are still open, rather than actioned with nothing to show for it.
    expect(await listSuggestions(project.root, 'active')).toHaveLength(2);
  });
});
