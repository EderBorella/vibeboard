import { afterEach, describe, expect, it, vi } from 'vitest';

// Mocked before the app is imported: the real implementations reach OpenRouter and a running
// `opencode serve`. These routes are pure wiring, so what matters is the argument each handler
// derives from the query and the shape it wraps the answer in.
vi.mock('../src/server/copilot/models.js', () => ({
  listBackendModels: vi.fn(async (backend: string) => [{ id: `${backend}/m`, free: true }]),
  modelStatus: vi.fn(async () => ({ up: true, uptime: 99, endpoints: 2 })),
}));

import { ProjectSession } from '../src/server/boards/session.js';
import { listBackendModels, modelStatus } from '../src/server/copilot/models.js';
import { testApp } from './helpers.js';

// These routes need no project open, so a bare session is enough.
let session: ProjectSession | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
  vi.clearAllMocks();
});

function app(): ReturnType<typeof testApp> {
  session = new ProjectSession();
  return testApp(session);
}

describe('GET /api/models', () => {
  it('falls back to the default backend when the query names none', async () => {
    const res = await app().inject({ method: 'GET', url: '/api/models' });
    expect(res.statusCode).toBe(200);
    // Asserting the argument, not just the response: a fallback that passed undefined through
    // would still answer 200 with the same body. The second argument is the request's logger, so a
    // failed catalogue fetch leaves a line — asserted as "something", since the object is pino's.
    expect(listBackendModels).toHaveBeenCalledWith('claude-code', expect.anything());
    expect(res.json()).toEqual([{ id: 'claude-code/m', free: true }]);
  });

  it('passes the requested backend through', async () => {
    const res = await app().inject({ method: 'GET', url: '/api/models?backend=opencode' });
    expect(listBackendModels).toHaveBeenCalledWith('opencode', expect.anything());
    expect(res.json()).toEqual([{ id: 'opencode/m', free: true }]);
  });
});

describe('GET /api/model-status', () => {
  it('wraps the status for a named model', async () => {
    const res = await app().inject({ method: 'GET', url: '/api/model-status?id=openrouter/x' });
    expect(res.statusCode).toBe(200);
    expect(modelStatus).toHaveBeenCalledWith('openrouter/x', expect.anything());
    expect(res.json()).toEqual({ status: { up: true, uptime: 99, endpoints: 2 } });
  });

  it('answers a null status without asking, when no id is given', async () => {
    const res = await app().inject({ method: 'GET', url: '/api/model-status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: null });
    expect(modelStatus).not.toHaveBeenCalled();
  });
});
