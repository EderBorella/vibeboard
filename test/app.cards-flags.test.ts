import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Card } from '../src/core/types.js';
import { openTestProject } from './helpers.js';

// The `service`-only write path for the two flags auto-pilot owns (decision 44). It exists because
// neither of them can be set any other way: `CreateCardInput` has no `setup`, and `pickCardPatch`
// refuses both by name — deliberately, since a work agent able to flag its own card would make its own
// subtree the only eligible work in the project.

// The first engineering card of a greenfield project, and the token to reach it with.
async function project(): Promise<{
  app: Awaited<ReturnType<typeof openTestProject>>['app'];
  mint: Awaited<ReturnType<typeof openTestProject>>['mint'];
  card: Card;
  url: string;
}> {
  const { app, mint } = await openTestProject({ name: 'F' });
  const state = (await app.inject({ method: 'GET', url: '/api/state' })).json();
  const card = state.snapshot.boards.engineering[0] as Card;
  return { app, mint, card, url: `/api/cards/engineering/${card.id}/flags` };
}

const asService = (mint: Awaited<ReturnType<typeof openTestProject>>['mint']): Record<string, string> => ({
  authorization: `Bearer ${mint('service', 'run-svc').token}`,
});

describe('POST /api/cards/:board/:id/flags', () => {
  it('sets setup with a service credential', async () => {
    const { app, mint, url } = await project();
    const res = await app.inject({ method: 'POST', url, headers: asService(mint), payload: { setup: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().setup).toBe(true);
    // And on disk, not merely in the reply: the flag is what makes an absent gate set expected.
    expect(await readFile(res.json().filePath, 'utf8')).toContain('setup: true');
  });

  it('sets followUp with a service credential', async () => {
    const { app, mint, url } = await project();
    const res = await app.inject({
      method: 'POST',
      url,
      headers: asService(mint),
      payload: { followUp: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().followUp).toBe(true);
    expect(await readFile(res.json().filePath, 'utf8')).toContain('followUp: true');
  });

  it('refuses a work credential', async () => {
    // The whole reason this route exists rather than widening PATCH.
    const { app, mint, card, url } = await project();
    const work = mint('work', 'run-work', card.id);
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${work.token}` },
      payload: { setup: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a checkup credential', async () => {
    // A supervisor moves cards; it does not grant authority.
    const { app, mint, url } = await project();
    const checkup = mint('checkup', 'run-checkup');
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${checkup.token}` },
      payload: { setup: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows the browser, because admin bypasses the table', async () => {
    // `allows` returns true for admin before it consults RULES (src/server/auth.ts:240), which is what
    // lets the carding endpoint set followUp without a second row.
    const { app, url } = await project();
    const res = await app.inject({ method: 'POST', url, payload: { followUp: true } });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a body with neither flag', async () => {
    const { app, mint, url } = await project();
    const res = await app.inject({ method: 'POST', url, headers: asService(mint), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('setup');
    expect(res.json().error).toContain('followUp');
  });

  it('clears a flag when sent false', async () => {
    // `serializeCard` emits setup only when true (src/core/card.ts:53), so false means the key is gone.
    const { app, mint, url } = await project();
    const headers = asService(mint);
    await app.inject({ method: 'POST', url, headers, payload: { setup: true } });
    const res = await app.inject({ method: 'POST', url, headers, payload: { setup: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().setup).toBeUndefined();
    expect(await readFile(res.json().filePath, 'utf8')).not.toContain('setup');
  });

  it('leaves the other flag alone', async () => {
    const { app, mint, url } = await project();
    const headers = asService(mint);
    await app.inject({ method: 'POST', url, headers, payload: { setup: true } });
    const res = await app.inject({ method: 'POST', url, headers, payload: { followUp: true } });
    expect(res.json().setup).toBe(true);
    expect(res.json().followUp).toBe(true);
  });

  it('does not accept createdBy', async () => {
    // The flags route is for the two flags. `createdBy` is stamped by the create endpoint from the
    // credential it already holds, and a route that let it be rewritten would be worth nothing.
    const { app, mint, url } = await project();
    const res = await app.inject({
      method: 'POST',
      url,
      headers: asService(mint),
      payload: { createdBy: 'RUN-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('createdBy');
  });

  it('refuses a flag that is not a boolean', async () => {
    const { app, mint, url } = await project();
    const res = await app.inject({
      method: 'POST',
      url,
      headers: asService(mint),
      payload: { setup: 'yes' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('setup');
  });
});
