import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/credentials.js';
import { ProjectSession } from '../src/server/session.js';
import { tempDir } from './helpers.js';

// Where a RUN may create a card, and what vertical the card belongs to — both enforced at the endpoint,
// because decision 10 makes endpoints the only write path and a prompt is a request rather than a rule.
//
// Every test here goes through HTTP with a real run credential. That is the whole point: the skill files say
// the same things in prose, and the first hand-run showed prose is not enough.

const ADMIN = 'admin-token-for-card-lifecycle';
const admin = { authorization: `Bearer ${ADMIN}` };
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

async function open(): Promise<{ app: FastifyInstance; store: CredentialStore; root: string }> {
  const session = new ProjectSession();
  const store = new CredentialStore(ADMIN);
  const app = buildApp(session, { credentials: store, logger: false });
  const root = await tempDir();
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  // greenfield, so the sample cards give every board a card a run can be scoped to.
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    headers: admin,
    payload: { path: root, name: 'L', mode: 'greenfield' },
  });
  return { app, store, root };
}

const create = (
  app: FastifyInstance,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: () => Record<string, string> }> =>
  app.inject({ method: 'POST', url: '/api/cards', headers, payload }) as unknown as Promise<{
    statusCode: number;
    json: () => Record<string, string>;
  }>;

describe('a run creating a card in the column that dispatches its own skill', () => {
  // THE FIRST HAND-RUN'S LOOP. `derive-features` created five feature cards in `features/backlog` — the column
  // whose route dispatches `derive-features` — so each derived feature was itself sent through derive-features,
  // reported "nothing needed to be created", was passed by the critic and ADVANCED FOR DOING NOTHING.
  it('is refused, and told where the card belongs instead', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-1', root, 'F-001', {
      board: 'features',
      skill: 'derive-features',
    });

    const res = await create(app, bearer(run.token), {
      board: 'features',
      columnSlug: 'backlog',
      title: 'Emit JSON output',
    });

    expect(res.statusCode).toBe(409);
    // The sentence has to name the destination: an agent told only "no" tries the same thing again.
    expect(res.json().error).toContain('features/todo');
    expect(res.json().error).toContain('derive-features');
  });

  it('is allowed in the column that phase advances to', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-1', root, 'F-001', {
      board: 'features',
      skill: 'derive-features',
    });
    const res = await create(app, bearer(run.token), {
      board: 'features',
      columnSlug: 'todo',
      title: 'Emit JSON output',
    });
    expect(res.statusCode).toBe(200);
  });

  // The rule is about the SKILL the run is doing, not about one named phase. `break-down` creating a card in
  // `features/todo` — which dispatches break-down — is the same defect wearing a different name.
  it('is refused for any skill, not only derive-features', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-2', root, 'F-001', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'features',
      columnSlug: 'todo',
      title: 'Another feature',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('break-down');
  });

  // A person at the browser is not a run: they may put a card anywhere, and dragging one into a routed column
  // is exactly how a human hands work to auto-pilot.
  it('does not constrain a person at the browser', async () => {
    const { app } = await open();
    const res = await create(app, admin, {
      board: 'features',
      columnSlug: 'backlog',
      title: 'A rough idea I had',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('the vertical a run’s new card belongs to', () => {
  // One group is one feature: the feature, its user stories, their tasks. Stamped from the credential like
  // every other fact the server knows better than the agent — a value the caller supplies is one the caller
  // can mistype, and one wrong group silently splits a vertical in two.
  it('is stamped from the run’s own card when the new card is a level down', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-3', root, 'F-001', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'As a user I can ask for JSON',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().group).toBe('F-001');
  });

  it('carries the parent’s own group down, so a task names its feature and not its story', async () => {
    const { app, store, root } = await open();
    // A story already inside feature F-001's vertical.
    const breakingDown = store.mintRun('work', 'run-4', root, 'F-001', {
      board: 'features',
      skill: 'break-down',
    });
    const story = await create(app, bearer(breakingDown.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'As a user I can ask for JSON',
    });
    expect(story.json().group).toBe('F-001');

    // Now break THAT down into a task. The task must name the feature, not the story it came from.
    const splittingStory = store.mintRun('work', 'run-5', root, story.json().id, {
      board: 'product',
      skill: 'break-down',
    });
    const task = await create(app, bearer(splittingStory.token), {
      board: 'engineering',
      columnSlug: 'backlog',
      title: 'Add the --json flag',
    });
    expect(task.json().group).toBe('F-001');
  });

  it('overrides a group the agent sent, because the server knows which vertical this is', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-6', root, 'F-001', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'A story',
      group: 'whatever-the-agent-felt-like',
    });
    expect(res.json().group).toBe('F-001');
  });

  // A card created on the SAME board is a sibling rather than a child: that is `derive-features` making
  // features, and a feature is the root of its own vertical, not part of the seed card's.
  it('is not inherited by a card created on the same board', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-7', root, 'F-001', {
      board: 'features',
      skill: 'derive-features',
    });
    const res = await create(app, bearer(run.token), {
      board: 'features',
      columnSlug: 'todo',
      title: 'Emit JSON output',
    });
    expect(res.json().group).toBeUndefined();
  });

  // A missing parent must not cost a card. The run's card may have been archived under it, and refusing real
  // work over a label would be the wrong trade — the card is created, simply without a group.
  it('creates the card anyway when the run’s own card cannot be found', async () => {
    const { app, store, root } = await open();
    const run = store.mintRun('work', 'run-8', root, 'F-404', { board: 'features', skill: 'break-down' });
    const res = await create(app, bearer(run.token), {
      board: 'product',
      columnSlug: 'backlog',
      title: 'An orphan story',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().group).toBeUndefined();
  });

  it('leaves a person’s own group label alone', async () => {
    const { app } = await open();
    const res = await create(app, admin, {
      board: 'product',
      columnSlug: 'backlog',
      title: 'Mine',
      group: 'sync-epic',
    });
    expect(res.json().group).toBe('sync-epic');
  });
});
