import { describe, expect, it } from 'vitest';
import { WORK_DIR } from '../src/server/boxes/containers.js';
import {
  agentRefusal,
  liveSandbox,
  NOT_REQUESTED,
  probeSandbox,
  wrapCommand,
} from '../src/server/boxes/sandbox.js';

// The gate, as a decision. What it decides ABOUT — that a container really does deny what it claims —
// is checked against a real one in box-integration.test.ts, which needs docker and skips without it.
// These need neither, and they are the tests that must never be skipped: they are the reason a run
// cannot start unconfined.

const OK = { ok: true as const, image: 'vibeboard-agent:test' };

describe('wrapCommand', () => {
  it('leaves the command untouched when there is no sandbox', () => {
    expect(wrapCommand('claude', ['-p'], NOT_REQUESTED)).toEqual({ bin: 'claude', args: ['-p'] });
  });

  it('routes the command into the box when there is one', () => {
    const { bin, args } = wrapCommand('claude', ['-p', 'hello'], OK, 'vibeboard-abc-claude-code');
    expect(bin).toContain('docker');
    // `-i` is not cosmetic: docker discards stdin without it, and the prompt travels on stdin because
    // it carries the run's credential and a command line is world-readable.
    expect(args).toEqual([
      'exec',
      '-i',
      '-w',
      WORK_DIR,
      'vibeboard-abc-claude-code',
      'claude',
      '-p',
      'hello',
    ]);
  });

  it('carries the environment the CLI needs on the far side of the boundary', () => {
    const { args } = wrapCommand('claude', [], OK, 'box', { CLAUDE_CONFIG_DIR: '/state/claude' });
    expect(args.join(' ')).toContain('-e CLAUDE_CONFIG_DIR=/state/claude');
  });

  it('THROWS rather than running unconfined when the sandbox is ok but no box was supplied', () => {
    // The failure this prevents is the quiet one. Returning the bare command here — which is what the
    // AppArmor version did for a missing sandbox — would spawn the agent on the host, unconfined,
    // while every caller and the whole UI went on reporting that agents are sandboxed.
    expect(() => wrapCommand('claude', ['-p'], OK)).toThrow(/refusing to run an agent unconfined/);
  });
});

describe('probeSandbox', () => {
  it('reports the image when a box is possible', async () => {
    const status = await probeSandbox({ probe: async () => ({ ok: true }) }, 'vibeboard-agent:test');
    expect(status).toEqual({ ok: true, image: 'vibeboard-agent:test' });
  });

  it('carries the reason through, because it names the thing that fixes it', async () => {
    const status = await probeSandbox(
      {
        probe: async () => ({ ok: false, reason: 'the agent image is not built — run `npm run box:build`' }),
      },
      'vibeboard-agent:test',
    );
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.reason).toContain('box:build');
    expect(status.ok === false && status.kind).toBe('docker');
  });
});

// A STALE CREDENTIAL IS A NOT-OK SANDBOX, and that is the whole mechanism. It could have been a fourth
// gate with its own call sites; folding it into the status means the dispatch gate, the auto-pilot
// gate, the copilot gate and the route all refuse it without any of them being told about it, and the
// light goes offline for free.
describe('a box holding a replaced credential', () => {
  const stale = {
    fresh: false as const,
    reason: 'the agent box is holding a sign-in that has been replaced',
  };
  const ok = { probe: async () => ({ ok: true as const }) };

  it('is reported as not ok, with the credential kind and the credential sentence', async () => {
    const status = await liveSandbox(ok, 'img', { now: () => 0, credential: async () => stale })();
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.kind).toBe('credential');
    expect(status.ok === false && status.reason).toBe(stale.reason);
  });

  it('leaves the sandbox ok when the box is holding the current one', async () => {
    const status = await liveSandbox(ok, 'img', {
      now: () => 0,
      credential: async () => ({ fresh: true }),
    })();
    expect(status).toEqual({ ok: true, image: 'img' });
  });

  // The docker answer decides whether the second question is asked at all. An unbuilt image is the more
  // fundamental fault and "run `npm run box:build`" is the message that helps — telling someone with no
  // image to rebuild their boxes sends them to do a thing that cannot work.
  it('is not even asked about when docker has already said no', async () => {
    let asked = 0;
    const status = await liveSandbox(
      { probe: async () => ({ ok: false as const, reason: 'the agent image is not built' }) },
      'img',
      {
        now: () => 0,
        credential: async () => {
          asked += 1;
          return stale;
        },
      },
    )();
    expect(asked).toBe(0);
    expect(status.ok === false && status.kind).toBe('docker');
    expect(status.ok === false && status.reason).toBe('the agent image is not built');
  });

  // ONE cache, not two. A second TTL for the credential would let the two halves of one status disagree
  // for up to a second at a time, and the counts are the only thing that can tell that apart.
  it('caches both answers under the one TTL, and a burst makes one probe of each', async () => {
    let clock = 0;
    let docker = 0;
    let credential = 0;
    const sandbox = liveSandbox(
      {
        probe: async () => {
          docker += 1;
          return { ok: true as const };
        },
      },
      'img',
      {
        ttlMs: 1000,
        now: () => clock,
        credential: async () => {
          credential += 1;
          return stale;
        },
      },
    );

    const burst = await Promise.all([sandbox(), sandbox(), sandbox(), sandbox()]);
    expect(burst.every((s) => !s.ok)).toBe(true);
    expect([docker, credential]).toEqual([1, 1]);

    clock += 999;
    await sandbox();
    expect([docker, credential]).toEqual([1, 1]);

    // And they expire together, because there is only one thing to expire.
    clock += 2;
    await sandbox();
    expect([docker, credential]).toEqual([2, 2]);
  });
});

describe('agentRefusal', () => {
  it('allows an agent when a box is available', () => {
    expect(agentRefusal(OK, undefined)).toBeNull();
  });

  it('refuses, naming the reason, when none is', () => {
    const reason = agentRefusal(
      { ok: false, reason: 'Docker is not available — no daemon', kind: 'docker' },
      undefined,
    );
    expect(reason).toContain('no daemon');
    expect(reason).toContain('container');
  });

  // The tail was written when a missing image was the only way to be not-ok, and it contradicts the
  // credential sentence outright: the container exists, is running, and is the thing holding the dead
  // sign-in. This reaches the user verbatim in the light's balloon, so the two halves have to agree —
  // otherwise it names a fix ("rebuild the boxes") and then denies the premise of it in the next clause.
  it('does not tell someone whose box is running that there is no container', () => {
    const reason = agentRefusal(
      {
        ok: false,
        reason: 'the box is holding a replaced sign-in — use "Rebuild the agent boxes"',
        kind: 'credential',
      },
      undefined,
    );
    expect(reason).toContain('Rebuild the agent boxes');
    expect(reason, 'the docker-only tail must not follow a credential reason').not.toContain(
      'there is none available here',
    );
  });

  it('refuses an attached OpenCode server even when a box is available', () => {
    // The server VibeBoard did not start is not in a box, so nothing restricts what it can reach —
    // and the status object cannot see that. Two functions once answered this question and diverged,
    // which is how a turn ran unwrapped while the gate said yes.
    const reason = agentRefusal(OK, 'http://127.0.0.1:9999');
    expect(reason).toContain('VIBEBOARD_OPENCODE_URL');
  });
});
