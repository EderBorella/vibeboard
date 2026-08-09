import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { BoxManager } from '../src/server/box-manager.js';
import { BoxService } from '../src/server/box-service.js';
import type { DockerRun } from '../src/server/containers.js';
import { INSTALL_HELPER } from '../src/server/containers.js';
import { openTestProject } from './helpers.js';

// The brokered install. What matters here is not that apt works — that is checked against a real
// container in box-integration.test.ts — but that the ROUTE refuses everything it should before
// anything reaches a privileged exec, and that what it does reach is a privileged exec of the helper
// with the names passed as argv.

function recordingBoxes(result: { code: number; stderr?: string } = { code: 0 }): {
  boxes: BoxService;
  calls: string[][];
} {
  const calls: string[][] = [];
  const docker: DockerRun = async (args) => {
    calls.push(args);
    if (args[0] === 'inspect') return { code: 0, stdout: 'true\n', stderr: '' };
    if (args.includes(INSTALL_HELPER)) return { code: result.code, stdout: '', stderr: result.stderr ?? '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { boxes: new BoxService({ manager: new BoxManager({ docker, user: '1000:1000' }) }), calls };
}

async function open(boxes?: BoxService | null): Promise<FastifyInstance> {
  const project = await openTestProject({ boxes: boxes ?? null });
  onTestFinished(async () => {
    await project.app.close();
  });
  return project.app;
}

const install = (app: FastifyInstance, packages: unknown) =>
  app.inject({ method: 'POST', url: '/api/toolchain/install', payload: { packages } });

describe('POST /api/toolchain/install', () => {
  it('installs, as root, through the helper, with the names as ARGV', async () => {
    const { boxes, calls } = recordingBoxes();
    const res = await install(await open(boxes), ['jq', 'python3']);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, installed: ['jq', 'python3'] });

    const exec = calls.find((c) => c.includes(INSTALL_HELPER));
    expect(exec).toBeDefined();
    // Root, because installing needs it — and this is the ONLY place VibeBoard runs anything in a
    // box as root. The agent's own turns never do; the image has no sudo for them to try.
    expect(exec?.slice(0, 3)).toEqual(['exec', '-u', '0:0']);
    // Argv, not a shell string: these names came from an agent, which got them from whatever it read.
    expect(exec?.slice(-2)).toEqual(['jq', 'python3']);
    expect(exec?.join(' ')).not.toContain('sh -c');
  });

  it('refuses a name that is really a command, before anything is executed', async () => {
    const { boxes, calls } = recordingBoxes();
    const res = await install(await open(boxes), ['jq; rm -rf /']);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Not package names');
    expect(calls.some((c) => c.includes(INSTALL_HELPER))).toBe(false);
  });

  it.each([
    ['an empty list', []],
    ['not a list at all', 'jq'],
    ['a list of the wrong thing', [{ name: 'jq' }]],
  ])('refuses %s', async (_label, packages) => {
    const { boxes } = recordingBoxes();
    expect((await install(await open(boxes), packages)).statusCode).toBe(400);
  });

  it('caps how many can be asked for in one call', async () => {
    const { boxes, calls } = recordingBoxes();
    const many = Array.from({ length: 21 }, (_, i) => `pkg${i}`);
    const res = await install(await open(boxes), many);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('21 packages');
    expect(calls.some((c) => c.includes(INSTALL_HELPER))).toBe(false);
  });

  it('passes apt’s own reason through, because it names the typo', async () => {
    // A generic failure sends the agent looking for a VibeBoard problem instead of at its own
    // spelling, and it has no other way to find out.
    const { boxes } = recordingBoxes({ code: 100, stderr: 'E: Unable to locate package pythno3' });
    const res = await install(await open(boxes), ['pythno3']);

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('Unable to locate package pythno3');
  });

  it('says so plainly when there are no containers to install into', async () => {
    const res = await install(await open(null), ['jq']);
    expect(res.statusCode).toBe(503);
  });
});
