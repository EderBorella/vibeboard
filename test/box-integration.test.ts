import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BoxManager } from '../src/server/box-manager.js';
import { DEFAULT_IMAGE } from '../src/server/containers.js';

// The boundary itself, against a real container — not the argv that asks for it.
//
// Everything else in test/containers.test.ts asserts the FLAGS we pass docker, which is the right way
// to catch a wrong flag but cannot catch a flag that does not mean what we think. These are the
// claims the design rests on, checked against the kernel.
//
// SKIPPED, never failed, when docker or the image is absent: contributors must not need either to run
// the suite. It relies on NOTHING but a local image — no registry, no network — so it is safe in CI
// that has neither.

const run = promisify(execFile);

async function imageAvailable(): Promise<boolean> {
  try {
    await run('docker', ['image', 'inspect', '-f', '{{.Id}}', DEFAULT_IMAGE], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const available = await imageAvailable();
const box = available ? describe : describe.skip;

box('the agent box, for real', () => {
  let dir = '';
  let mgr: BoxManager;
  let name = '';

  // One temp root for the whole file, removed in teardown. Per-test `mkdtemp` with no cleanup is how
  // a suite leaks a directory per run until the filesystem runs out of inodes.
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vb-box-'));
    mkdirSync(join(dir, 'proj', '.vibeboard'), { recursive: true });
    writeFileSync(join(dir, 'proj', '.vibeboard', 'card.md'), 'governed\n');
    mgr = new BoxManager();
    const handle = await mgr.ensure({
      projectRoot: join(dir, 'proj'),
      backend: 'claude-code',
      paths: {
        projectRoot: join(dir, 'proj'),
        stateDir: join(dir, 'state'),
        readOnly: ['.vibeboard'],
      },
      command: ['sleep', '600'],
    });
    name = handle.name;
    mkdirSync(join(dir, 'state'), { recursive: true });
  }, 180_000);

  afterAll(async () => {
    if (name) await mgr.stop(join(dir, 'proj'), 'claude-code');
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  const asAgent = (script: string): Promise<{ stdout: string; code: number }> =>
    run('docker', ['exec', name, '/bin/sh', '-c', script], { timeout: 60_000 })
      .then((r) => ({ stdout: r.stdout, code: 0 }))
      .catch((e: { stdout?: string; code?: number }) => ({ stdout: e.stdout ?? '', code: e.code ?? 1 }));

  it('has no sudo — the agent’s lack of root is an absent route, not a blocked one', async () => {
    expect((await asAgent('command -v sudo')).code).not.toBe(0);
  });

  it('refuses the agent a system install', async () => {
    expect((await asAgent('apt-get install -y jq')).code).not.toBe(0);
  });

  it('refuses the agent a write to .vibeboard, and the card survives', async () => {
    expect((await asAgent('echo hacked > /work/.vibeboard/card.md')).code).not.toBe(0);
    expect((await asAgent('cat /work/.vibeboard/card.md')).stdout).toContain('governed');
  });

  it('refuses the agent a REMOUNT of it — read-only is held by the kernel, not the account', async () => {
    expect((await asAgent('mount -o remount,rw /work/.vibeboard')).code).not.toBe(0);
  });

  it('lets the agent write the project itself, or the box would be useless', async () => {
    expect(
      (await asAgent('echo ok > /work/agent-wrote-this && cat /work/agent-wrote-this')).stdout,
    ).toContain('ok');
  });

  it('gives the agent a writable home, so ordinary installs need no privilege at all', async () => {
    expect((await asAgent('touch "$HOME/probe" && echo yes')).stdout).toContain('yes');
  });

  it('installs a system package through the broker, and the agent can then use it', async () => {
    const res = await mgr.install(name, ['jq']);
    expect(res.code).toBe(0);
    expect((await asAgent('jq --version')).stdout).toMatch(/jq-/);
  }, 600_000);

  it('does not let even the PRIVILEGED half write the read-only mount', async () => {
    const res = await run('docker', [
      'exec',
      '-u',
      '0:0',
      name,
      '/bin/sh',
      '-c',
      'echo hacked > /work/.vibeboard/card.md',
    ]).catch((e: { code?: number }) => ({ code: e.code ?? 1 }));
    expect((res as { code?: number }).code ?? 0).not.toBe(0);
    expect((await asAgent('cat /work/.vibeboard/card.md')).stdout).toContain('governed');
  });

  it('does not let the privileged half touch the network rules', async () => {
    const res = await run('docker', ['exec', '-u', '0:0', name, '/bin/sh', '-c', 'iptables -F OUTPUT']).catch(
      (e: { code?: number }) => ({ code: e.code ?? 1 }),
    );
    expect((res as { code?: number }).code ?? 0).not.toBe(0);
  });

  it('leaves nothing root-owned in the project — the day-one bind-mount failure', async () => {
    const { stdout } = await run('find', [join(dir, 'proj'), '-user', 'root']);
    expect(stdout.trim()).toBe('');
  });
});
