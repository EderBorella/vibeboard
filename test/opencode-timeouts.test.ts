import { createServer, type Server } from 'node:http';
import { Agent, fetch as undiciFetch } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import { OPENCODE_TIMEOUTS, opencodeDispatcher } from '../src/server/boxes/opencode-client.js';

// WHY THE HTTP LAYER MUST NOT HAVE A TIMEOUT OF ITS OWN.
//
// Node's `fetch` uses undici, whose default `headersTimeout` is 300 seconds. A model that takes longer than
// that to produce its first byte — an ordinary thing for a free one — makes the request reject with
// `TypeError: fetch failed`, indistinguishable at a glance from a dead server.
//
// Measured on the calculator project, 2026-08-17: ELEVEN failures at 300.7–300.9 seconds across five cards.
// Every one burned an attempt, E-002's three `fix` runs took it to its cap, and auto-pilot reported that the
// cards could not be done. The model had simply not answered inside a bound nobody chose, while
// `VIBEBOARD_RUN_TIMEOUT_MS` — the bound the product documents — is thirty minutes.
//
// So the ONE bound is the turn's own: `agent-turn.ts` holds a timer and an AbortController, and this layer
// must not second-guess it with a shorter one.
//
// Tested against a real socket at second scale rather than the real 300s: the property is "the dispatcher we
// pass does not impose a cap", and a server that delays its headers proves it in three.
//
// THE GAP HAS TO CLEAR UNDICI’S TIMER WHEEL, which is coarse — a 200ms cap against a 400ms delay did not fire
// at all, and a test built on that would have "passed" with the cap still in place.
let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise((r) => server?.close(r));
  server = undefined;
});

// Answers, but slowly — the shape of a model thinking.
async function slowServer(delayMs: number): Promise<string> {
  server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }, delayMs);
  });
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', () => r()));
  const address = server?.address();
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

describe('the OpenCode dispatcher', () => {
  it('lets a slow answer through, where a default-capped one would not', async () => {
    const base = await slowServer(2500);

    // The control: this is what the global fetch does, only with the cap scaled down from 300s to 200ms.
    const capped = undiciFetch(`${base}/`, { dispatcher: new Agent({ headersTimeout: 500 }) });
    await expect(capped).rejects.toThrow(/fetch failed/);

    // And ours, against the same server: no cap of its own, so the answer arrives.
    const res = await undiciFetch(`${base}/`, { dispatcher: opencodeDispatcher() });
    expect(res.status).toBe(200);
  });

  it('imposes no header or body timeout at all', () => {
    // Asserted on the values as well as the behaviour above, because the behavioural test would still pass
    // with a cap of ten minutes — which is the same defect one order of magnitude further out.
    expect(OPENCODE_TIMEOUTS.headersTimeout).toBe(0);
    expect(OPENCODE_TIMEOUTS.bodyTimeout).toBe(0);
  });

  it('is one dispatcher, reused', () => {
    // A new Agent per request would open a new connection pool per turn and leak sockets for the life of the
    // process — and the pool is the reason undici is here rather than a bare fetch.
    expect(opencodeDispatcher()).toBe(opencodeDispatcher());
  });
});
