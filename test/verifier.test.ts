import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOUNDATION_DIR } from '../src/core/layout.js';
import type { CommandResult } from '../src/core/verify.js';
import { verifyGates, verifySmoke } from '../src/server/verifier.js';
import { tempDir } from './helpers.js';

// Composition: the readers, the runner and the pure verdict. What is asserted here is the WIRING —
// order, stopping, and the four ways a project can fail to say what its gates are. Each of those is a
// project that would otherwise pass every card it has (Principle 1).

// Records what it was asked to run and answers from a script, so order and stopping are assertable
// without spawning anything — and so a test can make the second command fail without writing one.
function fakeRunner(codes: Record<string, number>) {
  const asked: string[] = [];
  const run = async (command: string): Promise<CommandResult> => {
    asked.push(command);
    return { command, code: codes[command] ?? 0, output: `output of ${command}`, timedOut: false };
  };
  return { run, asked };
}

async function withFoundation(files: Record<string, string>): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, FOUNDATION_DIR), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, FOUNDATION_DIR, name), content, 'utf8');
  }
  return root;
}

const GATES = `---
gates:
  - { name: lint, command: npm run lint }
  - { name: types, command: npm run check }
  - { name: tests, command: npm test }
---
The bar every card must clear.
`;

describe('verifying by gates', () => {
  it('runs every gate in the order they are declared', async () => {
    const root = await withFoundation({ 'CODE-QUALITY.md': GATES });
    const { run, asked } = fakeRunner({});
    const v = await verifyGates(root, 'AT', { run });
    expect(v.passed).toBe(true);
    expect(asked).toEqual(['npm run lint', 'npm run check', 'npm test']);
  });

  // Stops at the first failure: the later ones usually fail BECAUSE of it, so running them spends
  // minutes producing evidence that points at the wrong place.
  it('stops at the first failing gate and names it', async () => {
    const root = await withFoundation({ 'CODE-QUALITY.md': GATES });
    const { run, asked } = fakeRunner({ 'npm run check': 2 });
    const v = await verifyGates(root, 'AT', { run });
    expect(v).toMatchObject({ mode: 'gates', passed: false, command: 'npm run check' });
    expect(v.output).toContain('output of npm run check');
    expect(asked).toEqual(['npm run lint', 'npm run check']);
  });

  it('fails a gate that had to be killed, and says it was still running', async () => {
    const root = await withFoundation({
      'CODE-QUALITY.md': '---\ngates:\n  - { name: t, command: hang }\n---\nx\n',
    });
    const run = async (command: string): Promise<CommandResult> => ({
      command,
      code: null,
      output: 'started',
      timedOut: true,
    });
    const v = await verifyGates(root, 'AT', { run });
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/still running/i);
  });

  // A killed gate stops the run of gates, and `code` is not what says so. The verifier had its own copy
  // of "did this fail", whose `timedOut` half nothing constrained: narrowed to `code !== 0` it stayed
  // green, because the only timeout fixture used `code: null`. A command killed after printing something
  // can exit 0 and still have timed out, so this fixture uses exactly that shape.
  it('stops at a gate that timed out even though its code is zero', async () => {
    const root = await withFoundation({ 'CODE-QUALITY.md': GATES });
    const asked: string[] = [];
    const run = async (command: string): Promise<CommandResult> => {
      asked.push(command);
      return { command, code: 0, output: '', timedOut: command === 'npm run check' };
    };
    const v = await verifyGates(root, 'AT', { run });
    expect(v.passed).toBe(false);
    expect(asked).toEqual(['npm run lint', 'npm run check']);
  });

  it('carries the timeout it was given through to the runner', async () => {
    const root = await withFoundation({ 'CODE-QUALITY.md': GATES });
    const seen: (number | undefined)[] = [];
    const run = async (
      command: string,
      opts: { cwd: string; timeoutMs?: number },
    ): Promise<CommandResult> => {
      seen.push(opts.timeoutMs);
      return { command, code: 0, output: '', timedOut: false };
    };
    await verifyGates(root, 'AT', { run, timeoutMs: 1234 });
    expect(seen).toEqual([1234, 1234, 1234]);
  });

  it('runs each gate in the project root', async () => {
    const root = await withFoundation({ 'CODE-QUALITY.md': GATES });
    const seen: string[] = [];
    const run = async (command: string, opts: { cwd: string }): Promise<CommandResult> => {
      seen.push(opts.cwd);
      return { command, code: 0, output: '', timedOut: false };
    };
    await verifyGates(root, 'AT', { run });
    expect(new Set(seen)).toEqual(new Set([root]));
  });

  // The four fail-closed cases. Each is a project whose gates cannot be read, and none of them may
  // pass — nor may any of them RUN anything, since there is nothing to run.
  it('fails when CODE-QUALITY.md does not exist, and says so', async () => {
    const root = await tempDir();
    const { run, asked } = fakeRunner({});
    const v = await verifyGates(root, 'AT', { run });
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/does not exist/);
    expect(asked).toEqual([]);
  });

  it('fails when it declares no gates', async () => {
    const root = await withFoundation({ 'CODE-QUALITY.md': '---\ngates: []\n---\nnothing\n' });
    const v = await verifyGates(root, 'AT', { run: fakeRunner({}).run });
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/no gates/);
  });

  it('fails when its frontmatter will not parse', async () => {
    const root = await withFoundation({ 'CODE-QUALITY.md': '---\ngates: [ {name: "x\n---\nprose\n' });
    const v = await verifyGates(root, 'AT', { run: fakeRunner({}).run });
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/will not parse/);
  });

  it('fails when a gate has a name and no command', async () => {
    const root = await withFoundation({ 'CODE-QUALITY.md': '---\ngates:\n  - { name: lint }\n---\nx\n' });
    const v = await verifyGates(root, 'AT', { run: fakeRunner({}).run });
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/no command/);
  });

  it('stamps the verdict with the time it was given', async () => {
    const root = await withFoundation({ 'CODE-QUALITY.md': GATES });
    const v = await verifyGates(root, '2026-08-05T12:00:00.000Z', { run: fakeRunner({}).run });
    expect(v.at).toBe('2026-08-05T12:00:00.000Z');
  });
});

// The review's HIGH: every test above injects `run`, so the PRODUCTION default — the line connecting the
// verifier to the thing that actually spawns — was exercised by nothing. Replacing it with a stub that
// passed everything left the whole suite green, which is the spec's "prove the verification gate rejects"
// proved only against a fake. These two use real commands and no injection.
describe('with the real runner', () => {
  it('passes a project whose gates really exit zero', async () => {
    const root = await withFoundation({
      'CODE-QUALITY.md': '---\ngates:\n  - { name: t, command: "exit 0" }\n---\nx\n',
    });
    expect(await verifyGates(root, 'AT')).toMatchObject({ mode: 'gates', passed: true });
  });

  it('fails one whose gate really exits non-zero, and keeps what it printed', async () => {
    const root = await withFoundation({
      'CODE-QUALITY.md': '---\ngates:\n  - { name: t, command: "echo the failure 1>&2; exit 1" }\n---\nx\n',
    });
    const v = await verifyGates(root, 'AT');
    expect(v).toMatchObject({ mode: 'gates', passed: false, command: 'echo the failure 1>&2; exit 1' });
    expect(v.output).toContain('the failure');
  });

  it('runs a real smoke command in the project root', async () => {
    const root = await withFoundation({
      'TESTING.md': '---\nsmoke: test -f .vibeboard/foundation/TESTING.md\n---\nx\n',
    });
    expect(await verifySmoke(root, 'AT')).toMatchObject({ mode: 'smoke', passed: true });
  });
});

describe('verifying by smoke test', () => {
  it('runs the one command TESTING.md declares', async () => {
    const root = await withFoundation({ 'TESTING.md': '---\nsmoke: npm run smoke\n---\nhow we test\n' });
    const { run, asked } = fakeRunner({});
    const v = await verifySmoke(root, 'AT', { run });
    expect(v).toMatchObject({ mode: 'smoke', passed: true });
    expect(asked).toEqual(['npm run smoke']);
  });

  it('fails when TESTING.md declares none, and runs nothing', async () => {
    const root = await withFoundation({ 'TESTING.md': '---\nstrategy: prose only\n---\nx\n' });
    const { run, asked } = fakeRunner({});
    const v = await verifySmoke(root, 'AT', { run });
    expect(v).toMatchObject({ mode: 'smoke', passed: false });
    expect(v.reason).toMatch(/no `smoke:` command/);
    expect(asked).toEqual([]);
  });

  it('fails when TESTING.md is not there at all', async () => {
    const v = await verifySmoke(await tempDir(), 'AT', { run: fakeRunner({}).run });
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/does not exist/);
  });

  it('carries the failing command and its output', async () => {
    const root = await withFoundation({ 'TESTING.md': '---\nsmoke: ./smoke.sh\n---\nx\n' });
    const { run } = fakeRunner({ './smoke.sh': 1 });
    const v = await verifySmoke(root, 'AT', { run });
    expect(v).toMatchObject({ passed: false, command: './smoke.sh' });
    expect(v.output).toContain('output of ./smoke.sh');
  });
});
