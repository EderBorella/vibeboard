import { describe, expect, it } from 'vitest';
import { readBoard } from '../src/core/board.js';
import type { Card, ProjectConfig } from '../src/core/types.js';
import { allows } from '../src/server/auth.js';
import type { Credential } from '../src/server/credentials.js';
import { listSuggestions } from '../src/server/suggestion-store.js';
import { openTestProject, type TestProject } from './helpers.js';

// POST /api/suggestions/:id/card — ONE endpoint, not three calls (decision 50). It finds the open
// follow-up feature or makes one, creates the story under it, and retires the suggestion. A browser
// doing that in three calls can fail between any two and leave exactly the orphan story on the product
// board that the two-level carding rule exists to prevent.

interface Carded {
  card: Card;
  suggestion: { state: string; became?: string; card?: string };
}

async function open(): Promise<TestProject> {
  return openTestProject({ name: 'S', mode: 'brownfield' });
}

// Filed the way an agent files one, so `card` on the record is the card it was filed FROM — the field
// `became` must not be confused with.
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

function card(project: TestProject, id: string, level: unknown) {
  return project.app.inject({
    method: 'POST',
    url: `/api/suggestions/${id}/card`,
    payload: level === undefined ? {} : { level },
  });
}

async function board(project: TestProject, name: 'features' | 'product'): Promise<Card[]> {
  return readBoard(project.root, name, project.session.config as ProjectConfig);
}

const cred = (scope: 'work' | 'checkup' | 'service'): Credential =>
  ({ scope, project: 'p', run: 'r', card: 'E-001', token: 't' }) as Credential;

describe('the scope table', () => {
  it('keeps carding away from every agent scope', () => {
    // Absent from the table, so it is admin-only without anyone having to remember to deny it: making
    // a card out of a finding is triage, and triage is a person's.
    for (const scope of ['work', 'checkup', 'service'] as const) {
      expect(allows(cred(scope), 'POST', '/api/suggestions/:id/card', 'p'), scope).toBe(false);
    }
  });

  it('refuses a work credential at the endpoint itself', async () => {
    const project = await open();
    const id = await file(project, 'a finding');
    const work = project.mint('work', 'run-9', 'E-001');
    const res = await project.app.inject({
      method: 'POST',
      url: `/api/suggestions/${id}/card`,
      headers: { authorization: `Bearer ${work.token}` },
      payload: { level: 'story' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/suggestions/:id/card', () => {
  it('cards a suggestion as a feature in features/backlog with no parent', async () => {
    const project = await open();
    const id = await file(project, 'A whole capability');
    const res = await card(project, id, 'feature');
    expect(res.statusCode).toBe(200);
    const { card: made } = res.json() as Carded;
    expect(made.board).toBe('features');
    expect(made.columnSlug).toBe('backlog');
    expect(made.title).toBe('A whole capability');
    // Features are the top level: a parent would be a card above the top of the hierarchy.
    expect(made.links).toEqual([]);
    // And nothing was invented on the other board to hang it off.
    expect(await board(project, 'product')).toEqual([]);
  });

  it('cards a suggestion as a story under a NEW follow-up feature when none is open', async () => {
    const project = await open();
    const id = await file(project, 'A missing index');
    const res = await card(project, id, 'story');
    expect(res.statusCode).toBe(200);
    const { card: story } = res.json() as Carded;
    const [follow] = await board(project, 'features');
    expect(follow.followUp).toBe(true);
    expect(follow.columnSlug).toBe('backlog');
    expect(story.board).toBe('product');
    expect(story.columnSlug).toBe('backlog');
    expect(story.links).toEqual([follow.id]);
    // SYMMETRIC, because the hierarchy is derived from the PARENT's links: without this side the
    // machine finds a feature with no stories under it and walks nothing.
    expect((await board(project, 'features'))[0].links).toEqual([story.id]);
  });

  it('reuses the one open follow-up rather than making a second', async () => {
    const project = await open();
    const first = await card(project, await file(project, 'one'), 'story');
    const second = await card(project, await file(project, 'two'), 'story');
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const features = await board(project, 'features');
    expect(features).toHaveLength(1);
    // Both stories under it, which is the whole point of one follow-up per wave.
    expect(features[0].links.sort()).toEqual(
      [(first.json() as Carded).card.id, (second.json() as Carded).card.id].sort(),
    );
  });

  it('makes a NEW follow-up when the existing one is done', async () => {
    const project = await open();
    await card(project, await file(project, 'first wave'), 'story');
    const [firstFollow] = await board(project, 'features');
    // Reopening it would undo something a feature checkup recorded as finished, and contradict the
    // derived status the board shows.
    await project.app.inject({
      method: 'POST',
      url: `/api/cards/features/${firstFollow.id}/move`,
      payload: { toColumnSlug: 'done' },
    });
    const res = await card(project, await file(project, 'second wave'), 'story');
    expect(res.statusCode).toBe(200);
    const features = await board(project, 'features');
    expect(features).toHaveLength(2);
    const open2 = features.filter((c) => c.columnSlug !== 'done');
    expect(open2).toHaveLength(1);
    expect(open2[0].id).not.toBe(firstFollow.id);
    expect(open2[0].links).toEqual([(res.json() as Carded).card.id]);
  });

  it('finds the follow-up by the flag, not by its title', async () => {
    const project = await open();
    // A decoy with the right title and NO flag: a user can rename a card, so a title is a guess.
    const decoy = await project.app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'features', columnSlug: 'backlog', title: 'Follow-up 1' },
    });
    // And the real one, flagged, titled something else entirely.
    const real = await project.app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'features', columnSlug: 'backlog', title: 'Second wave of the thing' },
    });
    const realId = (real.json() as Card).id;
    await project.app.inject({
      method: 'POST',
      url: `/api/cards/features/${realId}/flags`,
      payload: { followUp: true },
    });

    const res = await card(project, await file(project, 'a story'), 'story');
    expect(res.statusCode).toBe(200);
    const story = (res.json() as Carded).card;
    expect(story.links).toEqual([realId]);
    // No third feature was made, and the decoy adopted nothing.
    expect(await board(project, 'features')).toHaveLength(2);
    const after = (await board(project, 'features')).find((c) => c.id === (decoy.json() as Card).id);
    expect(after?.links).toEqual([]);
  });

  it('marks the suggestion actioned and records the card it became', async () => {
    const project = await open();
    const id = await file(project, 'A missing index');
    const res = await card(project, id, 'story');
    const { card: story, suggestion } = res.json() as Carded;
    expect(suggestion.state).toBe('actioned');
    expect(suggestion.became).toBe(story.id);
    // `card` is untouched: it still means the card it was filed FROM.
    expect(suggestion.card).toBe('E-001');
    // On disk too, not merely in the response.
    const [saved] = await listSuggestions(project.root, 'actioned');
    expect(saved).toMatchObject({ state: 'actioned', became: story.id, card: 'E-001' });
  });

  it('refuses level task, naming why', async () => {
    const project = await open();
    const res = await card(project, await file(project, 'a small thing'), 'task');
    expect(res.statusCode).toBe(400);
    const { error } = res.json() as { error: string };
    // The refusal has to name what to do instead, or it is a dead end: a task needs a story to belong
    // to, and a suggestion small enough to be one is a story with one criterion.
    expect(error).toContain('story');
    expect(await board(project, 'product')).toEqual([]);
  });

  it('refuses an unknown level, and a missing one', async () => {
    const project = await open();
    const id = await file(project, 'a thing');
    expect((await card(project, id, 'banana')).statusCode).toBe(400);
    expect((await card(project, id, undefined)).statusCode).toBe(400);
    expect((await card(project, id, 7)).statusCode).toBe(400);
    expect((await listSuggestions(project.root))[0].state).toBe('active');
  });

  it('refuses a suggestion that is already actioned', async () => {
    const project = await open();
    const id = await file(project, 'a thing');
    expect((await card(project, id, 'story')).statusCode).toBe(200);
    const again = await card(project, id, 'story');
    // 409, and NOT a second card: the request is well formed and it is the suggestion's state that
    // makes it wrong.
    expect(again.statusCode).toBe(409);
    expect(await board(project, 'product')).toHaveLength(1);
  });

  it('404s an id that names no suggestion', async () => {
    const project = await open();
    expect((await card(project, 'nothing-here', 'story')).statusCode).toBe(404);
  });

  it('refuses a bad id before touching the store', async () => {
    const project = await open();
    // Fastify decodes `%2f`, and an unchecked id here read a file outside the folder.
    const res = await project.app.inject({
      method: 'POST',
      url: '/api/suggestions/..%2f..%2fvictim/card',
      payload: { level: 'story' },
    });
    expect(res.statusCode).toBe(400);
    expect(await board(project, 'product')).toEqual([]);
  });

  it('creates nothing when the story create fails', async () => {
    const project = await open();
    const id = await file(project, 'a story');
    // The product board reordered so its FIRST column is its terminal one. A card created there would
    // stand as a live card in a terminal column, which is what `complete` reads as positive evidence —
    // so there is nowhere on that board for a new card to enter.
    const config = await project.app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { boards: { product: { columns: ['Done', 'Backlog', 'Todo', 'In Progress'] } } },
    });
    expect(config.statusCode).toBe(200);

    const res = await card(project, id, 'story');
    expect(res.statusCode).toBe(409);
    // ALL OF IT OR NONE. The follow-up feature is the create that comes FIRST, so a refusal that only
    // stopped the story would leave a feature nobody asked for standing on the board.
    expect(await board(project, 'features')).toEqual([]);
    expect(await board(project, 'product')).toEqual([]);
    // And the finding is still open, rather than actioned with nothing to show for it.
    expect(await listSuggestions(project.root)).toMatchObject([{ state: 'active' }]);
  });
});
