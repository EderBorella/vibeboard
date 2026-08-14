import { describe, expect, it } from 'vitest';
import { WORK_DIR } from '../src/server/boxes/containers.js';
import { agentRefusal, NOT_REQUESTED, probeSandbox, wrapCommand } from '../src/server/boxes/sandbox.js';

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
  });
});

describe('agentRefusal', () => {
  it('allows an agent when a box is available', () => {
    expect(agentRefusal(OK, undefined)).toBeNull();
  });

  it('refuses, naming the reason, when none is', () => {
    const reason = agentRefusal({ ok: false, reason: 'Docker is not available — no daemon' }, undefined);
    expect(reason).toContain('no daemon');
    expect(reason).toContain('container');
  });

  it('refuses an attached OpenCode server even when a box is available', () => {
    // The server VibeBoard did not start is not in a box, so nothing restricts what it can reach —
    // and the status object cannot see that. Two functions once answered this question and diverged,
    // which is how a turn ran unwrapped while the gate said yes.
    const reason = agentRefusal(OK, 'http://127.0.0.1:9999');
    expect(reason).toContain('VIBEBOARD_OPENCODE_URL');
  });
});
