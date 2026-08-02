import { describe, expect, it } from 'vitest';
import { boardColumnSlugs } from '../src/core/board.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject, testApp, wsClient } from './helpers.js';

interface WsMessage {
  type: string;
  snapshot?: { config?: { copilot?: { backend?: string } } };
}

describe('PATCH /api/config', () => {
  // Regression: the "Save does nothing" bug when switching backend. PATCH /config pushes a
  // snapshot itself rather than waiting on the watcher — instant and race-free for the
  // backend toggle. (The watcher DOES also see .vibeboard/config.yaml since c318024; only
  // .vibeboard/chat is ignored — see isIgnored in src/server/session.ts.)
  it('broadcasts an updated snapshot so clients see the new backend', async () => {
    const { app } = await openTestProject({ name: 'Cfg' });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = wsClient<WsMessage>(address);
    await client.open;
    await client.waitFor((m) => m.type === 'snapshot'); // initial (claude-code default)

    await app.inject({ method: 'PATCH', url: '/api/config', payload: { copilot: { backend: 'opencode' } } });

    const updated = await client.waitFor(
      (m) => m.type === 'snapshot' && m.snapshot?.config?.copilot?.backend === 'opencode',
    );
    expect(updated.snapshot!.config!.copilot!.backend).toBe('opencode');

    client.close();
  }, 5000);

  // The config is the only persisted source for copilot defaults, so a partial patch must
  // merge — per backend, not just per field. Replacing `backends` wholesale would discard the
  // model saved for the backend the patch doesn't mention, which is the loss that per-backend
  // slots exist to prevent.
  it('merges a partial copilot patch per backend instead of replacing the block', async () => {
    const { app } = await openTestProject({ name: 'Cfg' });

    const patch = async (copilot: unknown) =>
      (await app.inject({ method: 'PATCH', url: '/api/config', payload: { copilot } })).json().copilot;

    // One backend's slot: the other backend's slot is untouched.
    let copilot = await patch({ backend: 'claude-code', backends: { 'claude-code': { model: 'sonnet' } } });
    expect(copilot.backends['claude-code']).toEqual({ model: 'sonnet', effort: 'high' });
    expect(copilot.backends.opencode).toEqual({ model: 'opencode/deepseek-v4-flash-free', effort: 'high' });

    // Switching the selected backend does NOT rewrite either slot.
    copilot = await patch({ backend: 'opencode' });
    expect(copilot.backend).toBe('opencode');
    expect(copilot.backends['claude-code']).toEqual({ model: 'sonnet', effort: 'high' });

    // And it is on disk, not just in memory — the choice must outlive a reload.
    const reread = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(reread.copilot.backends['claude-code'].model).toBe('sonnet');
    expect(reread.copilot.backend).toBe('opencode');
  });

  it('persists a context budget the copilot bar can use', async () => {
    const { app } = await openTestProject({ name: 'Cfg' });

    const fresh = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(fresh.contextBudget).toBe(200_000);

    await app.inject({ method: 'PATCH', url: '/api/config', payload: { contextBudget: 1_000_000 } });
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json().contextBudget).toBe(1_000_000);
  });
});

describe('PATCH /api/config — column reconciliation', () => {
  // Regression: a column IS a folder. Renaming one used to leave its cards in the old folder,
  // where nothing reads them — they vanished from the board and looked deleted.
  it('renames the folder so the column keeps its cards', async () => {
    const { app } = await openTestProject({ name: 'Cols' });

    // Rename whichever column the scaffold actually seeded, rather than naming one. Hardcoding
    // 'todo' here stopped exercising the rename the moment the samples moved to the first column:
    // the filter went empty and the test renamed a column with nothing in it to keep.
    const before = await app.inject({ method: 'GET', url: '/api/state' });
    const beforeCards = before.json().snapshot.boards.product as { id: string; columnSlug: string }[];
    const seededColumn = beforeCards[0]?.columnSlug;
    const seeded = beforeCards.filter((c) => c.columnSlug === seededColumn);
    expect(seeded.length).toBeGreaterThan(0);

    const cfg = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    const columns = [...cfg.boards.product.columns];
    columns[boardColumnSlugs(cfg, 'product').indexOf(seededColumn)] = 'Next';

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { boards: { product: { columns } } },
    });
    expect(res.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/state' });
    const cards = after.json().snapshot.boards.product;
    expect(cards.filter((c: { columnSlug: string }) => c.columnSlug === 'next')).toHaveLength(seeded.length);
    expect(cards.map((c: { id: string }) => c.id).sort()).toEqual(
      before
        .json()
        .snapshot.boards.product.map((c: { id: string }) => c.id)
        .sort(),
    ); // nothing lost
  });

  it('refuses to remove a column that still holds cards, and saves nothing', async () => {
    const { app } = await openTestProject({ name: 'Cols' });

    // Drop the column the scaffold actually seeded. Naming a column outright made this pass for the
    // wrong reason once the samples moved: it removed an empty column and got a 200, and the
    // refusal it claims to test never ran.
    const state = await app.inject({ method: 'GET', url: '/api/state' });
    const [seeded] = state.json().snapshot.boards.product as { columnSlug: string }[];
    const before = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    const slugs = boardColumnSlugs(before, 'product');
    const dropped = before.boards.product.columns[slugs.indexOf(seeded.columnSlug)];

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: {
        boards: { product: { columns: before.boards.product.columns.filter((c: string) => c !== dropped) } },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(dropped);

    const cfg = await app.inject({ method: 'GET', url: '/api/config' });
    expect(cfg.json().boards.product.columns).toContain(dropped); // unchanged
  });

  // Regression: `{...config, ...patch}` replaced `boards` wholesale, so a patch naming one
  // board dropped the others from config.yaml — and ensureBoards then reset them to defaults.
  it('leaves boards absent from the patch untouched', async () => {
    const { app } = await openTestProject({ name: 'Cols' });
    await app.inject({
      method: 'PATCH',
      url: '/api/config',
      // A rename rather than the removal this test used to make. Dropping Review, Blocked and Done
      // now leaves the routing table pointing at columns that are gone, which is refused — so the
      // edit had to become one the lifecycle survives, or the test would be asserting the merge
      // behaviour of a request that never reached the merge.
      payload: { boards: { engineering: { columns: ['Backlog', 'In Progress', 'QA', 'Blocked', 'Done'] } } },
    });

    const cfg = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(cfg.boards.engineering.columns).toEqual(['Backlog', 'In Progress', 'QA', 'Blocked', 'Done']);
    expect(cfg.boards.product.columns).toEqual(['Backlog', 'Todo', 'In Progress', 'Done']);
    expect(cfg.boards.features.columns).toEqual(['Backlog', 'Todo', 'In Progress', 'Done']);
  });

  // The refusal names the board it came from: a patch can carry all three, and "that name is
  // reserved" is useless without knowing which board rejected it.
  it.each([
    {
      columns: ['Todo', 'Archive'],
      error: 'Product: "Archive" is reserved — archive is where deleted cards go.',
    },
    {
      columns: ['Todo', 'todo'],
      error: 'Product: Duplicate column "todo" — names must differ after slugging.',
    },
    { columns: [], error: 'Product: A board needs at least one column.' },
    { columns: ['Todo', '///'], error: 'Product: "///" is not a valid column name.' },
  ])('rejects $columns, naming the board', async ({ columns, error }) => {
    const { app } = await openTestProject({ name: 'Cols' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { boards: { product: { columns } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error });
  });

  it('names the offending board when the patch carries more than one', async () => {
    const { app } = await openTestProject({ name: 'Cols' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: {
        boards: { product: { columns: ['Todo'] }, engineering: { columns: ['Todo', 'Archive'] } },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^Engineering: /);
  });
});

describe('/api/config with no project open', () => {
  it.each([{ method: 'GET' as const }, { method: 'PATCH' as const }])(
    '409s on $method /api/config',
    async ({ method }) => {
      const session = new ProjectSession();
      const app = testApp(session);
      const res = await app.inject({
        method,
        url: '/api/config',
        ...(method === 'PATCH' ? { payload: { miniatureChars: 10 } } : {}),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'No project open' });
      await app.close();
      await session.close();
    },
  );
});
