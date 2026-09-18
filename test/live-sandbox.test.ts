import { describe, expect, it } from 'vitest';
import { fixedSandbox, liveSandbox, NOT_REQUESTED } from '../src/server/boxes/sandbox.js';

// A fake daemon whose answer can be changed between calls, and which counts how often it was asked.
// The counting is half the point: the whole reason this is cached is that two `docker` calls cost
// 30-40ms and three gates ask within one dispatch.
//
// ONE PROBE IS NOW TWO CALLS, one per image — the web layer and the shared base a `game` or `research`
// box is built from. It answers the same for both, which models the two states a machine is actually in
// (built, or never built); which of the two is missing is `test/sandbox.test.ts`'s subject. The counts
// below are therefore even, and what they still pin is that four callers do not make four probes.
function daemon(initial: boolean) {
  let ok = initial;
  let calls = 0;
  return {
    set(next: boolean): void {
      ok = next;
    },
    get calls(): number {
      return calls;
    },
    service: {
      async probe(_image?: string): Promise<{ ok: true } | { ok: false; reason: string }> {
        calls += 1;
        return ok ? { ok: true } : { ok: false, reason: 'the agent image is not built' };
      },
    },
  };
}

describe('the sandbox status is live', () => {
  // THE BUG THIS EXISTS FOR. The status used to be probed once in main.ts and held in a const for the
  // life of the process, on the stated grounds that it "cannot change while the process runs". It can:
  // an image removed from under a running server left GET /api/sandbox answering ok:true for ever, and
  // the same value gates every dispatch.
  it('notices an image that goes away while the server is running', async () => {
    const d = daemon(true);
    let clock = 0;
    const sandbox = liveSandbox(d.service, 'img', { ttlMs: 1000, now: () => clock });

    expect((await sandbox()).ok).toBe(true);
    d.set(false);
    clock += 1001;
    expect((await sandbox()).ok).toBe(false);
  });

  // And the other direction, which is what makes a "build the image" button possible at all: without
  // this, the build would succeed and the UI would keep saying it had not.
  it('notices an image that appears while the server is running', async () => {
    const d = daemon(false);
    let clock = 0;
    const sandbox = liveSandbox(d.service, 'img', { ttlMs: 1000, now: () => clock });

    expect((await sandbox()).ok).toBe(false);
    d.set(true);
    clock += 1001;
    const after = await sandbox();
    expect(after.ok).toBe(true);
    expect(after.ok && after.image).toBe('img');
  });

  it('serves the cached answer inside the TTL rather than asking again', async () => {
    const d = daemon(true);
    let clock = 0;
    const sandbox = liveSandbox(d.service, 'img', { ttlMs: 1000, now: () => clock });

    await sandbox();
    clock += 999;
    await sandbox();
    await sandbox();
    expect(d.calls).toBe(2);

    clock += 2;
    await sandbox();
    expect(d.calls).toBe(4);
  });

  // A dispatch consults the gate, the copilot consults it, and the route consults it — concurrently,
  // from one interaction. Without a shared in-flight promise that is three pairs of docker calls where
  // one will do, and the count is the only thing that can tell the difference.
  it('collapses a concurrent burst into a single probe', async () => {
    const d = daemon(true);
    const sandbox = liveSandbox(d.service, 'img', { ttlMs: 1000, now: () => 0 });

    const answers = await Promise.all([sandbox(), sandbox(), sandbox(), sandbox()]);
    expect(answers.every((a) => a.ok)).toBe(true);
    // One probe's worth — two images — and not four probes' worth, which is the whole assertion.
    expect(d.calls).toBe(2);
  });

  it('carries the reason through, because that is the sentence the UI shows', async () => {
    const d = daemon(false);
    const status = await liveSandbox(d.service, 'img', { now: () => 0 })();
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.reason).toBe('the agent image is not built');
  });
});

describe('fixedSandbox', () => {
  it('answers the same thing for ever, and asks no daemon', async () => {
    const s = fixedSandbox(NOT_REQUESTED);
    expect(await s()).toBe(NOT_REQUESTED);
    expect(await s()).toBe(NOT_REQUESTED);
  });
});
