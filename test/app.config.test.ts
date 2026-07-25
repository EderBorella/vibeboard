import { describe, it, expect } from 'vitest';
import { openTestProject, wsClient } from './helpers.js';

interface WsMessage { type: string; snapshot?: { config?: { copilot?: { backend?: string } } } }

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

    const updated = await client.waitFor((m) => m.type === 'snapshot' && m.snapshot?.config?.copilot?.backend === 'opencode');
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

    // The scaffold puts a sample card in product/todo.
    const before = await app.inject({ method: 'GET', url: '/api/state' });
    const seeded = before.json().snapshot.boards.product.filter((c: { columnSlug: string }) => c.columnSlug === 'todo');
    expect(seeded.length).toBeGreaterThan(0);

    const res = await app.inject({
      method: 'PATCH', url: '/api/config',
      payload: { boards: { product: { columns: ['Backlog', 'Next', 'In Progress', 'Done'] } } },
    });
    expect(res.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/state' });
    const cards = after.json().snapshot.boards.product;
    expect(cards.filter((c: { columnSlug: string }) => c.columnSlug === 'next')).toHaveLength(seeded.length);
    expect(cards.map((c: { id: string }) => c.id).sort()).toEqual(
      before.json().snapshot.boards.product.map((c: { id: string }) => c.id).sort(),
    ); // nothing lost
  });

  it('refuses to remove a column that still holds cards, and saves nothing', async () => {
    const { app } = await openTestProject({ name: 'Cols' });

    const res = await app.inject({
      method: 'PATCH', url: '/api/config',
      payload: { boards: { product: { columns: ['Backlog', 'In Progress', 'Done'] } } }, // drops Todo
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/Todo/);

    const cfg = await app.inject({ method: 'GET', url: '/api/config' });
    expect(cfg.json().boards.product.columns).toContain('Todo'); // unchanged
  });

  // Regression: `{...config, ...patch}` replaced `boards` wholesale, so a patch naming one
  // board dropped the others from config.yaml — and ensureBoards then reset them to defaults.
  it('leaves boards absent from the patch untouched', async () => {
    const { app } = await openTestProject({ name: 'Cols' });
    await app.inject({ method: 'PATCH', url: '/api/config', payload: { boards: { engineering: { columns: ['Todo', 'Shipped'] } } } });

    const cfg = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(cfg.boards.engineering.columns).toEqual(['Todo', 'Shipped']);
    expect(cfg.boards.product.columns).toEqual(['Backlog', 'Todo', 'In Progress', 'Done']);
    expect(cfg.boards.features.columns).toEqual(['Backlog', 'Todo', 'In Progress', 'Done']);
  });

  it('rejects a reserved or duplicate column name', async () => {
    const { app } = await openTestProject({ name: 'Cols' });

    for (const columns of [['Todo', 'Archive'], ['Todo', 'todo']]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/config', payload: { boards: { product: { columns } } } });
      expect(res.statusCode).toBe(400);
    }
  });
});
