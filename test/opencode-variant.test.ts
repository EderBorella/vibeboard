import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { CopilotSession } from '../src/server/copilot.js';
import type { CopilotEvent } from '../src/server/copilot-events.js';
import { opencodeTurn } from '../src/server/opencode-client.js';

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

let server: Server | undefined;
const saved = process.env.VIBEBOARD_OPENCODE_URL;

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  if (saved === undefined) delete process.env.VIBEBOARD_OPENCODE_URL;
  else process.env.VIBEBOARD_OPENCODE_URL = saved;
});

// Stand in for `opencode serve`: records every request body, answers with the minimum
// shape opencodeTurn needs.
async function fakeOpencode(seen: Captured[]): Promise<void> {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      seen.push({ url: req.url ?? '', body: raw ? JSON.parse(raw) : {} });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          (req.url ?? '').includes('/message')
            ? { info: { sessionID: 'ses_fake' }, parts: [{ type: 'text', text: 'ok' }] }
            : { id: 'ses_fake' },
        ),
      );
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const { port } = server!.address() as { port: number };
  process.env.VIBEBOARD_OPENCODE_URL = `http://127.0.0.1:${port}`;
}

const message = (seen: Captured[]): Record<string, unknown> =>
  seen.find((s) => s.url.includes('/message'))!.body;

describe('opencodeTurn', () => {
  it('sends the reasoning variant, so OpenCode effort is not decorative', async () => {
    const seen: Captured[] = [];
    await fakeOpencode(seen);

    await opencodeTurn({
      cwd: '/tmp',
      text: 'hi',
      model: 'opencode/deepseek-v4-flash-free',
      variant: 'high',
      onEvent: () => {},
    });

    const body = message(seen);
    expect(body.variant).toBe('high');
    expect(body.model).toEqual({ providerID: 'opencode', modelID: 'deepseek-v4-flash-free' });
  });

  it('omits the variant when none is given rather than sending a blank', async () => {
    const seen: Captured[] = [];
    await fakeOpencode(seen);

    await opencodeTurn({ cwd: '/tmp', text: 'hi', model: 'opencode/x', variant: '', onEvent: () => {} });

    expect(message(seen)).not.toHaveProperty('variant');
  });
});

describe('CopilotSession on the opencode backend', () => {
  it('applies the OpenCode default model and variant when the caller names neither', async () => {
    const seen: Captured[] = [];
    await fakeOpencode(seen);
    const events: CopilotEvent[] = [];

    await new CopilotSession().send({
      cwd: '/tmp',
      text: 'hi',
      mode: 'build',
      backend: 'opencode',
      onEvent: (e) => events.push(e),
    });

    const body = message(seen);
    // The OpenCode default, not the Claude one — model ids don't cross backends.
    expect(body.model).toEqual({ providerID: 'opencode', modelID: 'deepseek-v4-flash-free' });
    expect(body.variant).toBe('high');
  });
});
