import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/server/commands.js';
import { tempDir } from './helpers.js';

// The only part of verification that spawns anything, and the only part that can hang. Every claim here
// is about an ending: a zero, a non-zero, a kill, or a command that could not start at all.

describe('running a declared command', () => {
  it('reports a zero exit and the output', async () => {
    const cwd = await tempDir();
    const result = await runCommand('echo hello', { cwd });
    expect(result).toMatchObject({ command: 'echo hello', code: 0, timedOut: false });
    expect(result.output.trim()).toBe('hello');
  });

  // A failing suite writes its diagnosis to stderr as often as to stdout, and a verdict showing only
  // half of it would send the reader looking in the wrong place.
  it('captures stderr as well as stdout', async () => {
    const cwd = await tempDir();
    const result = await runCommand('echo out; echo err 1>&2', { cwd });
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });

  it('reports a non-zero exit as the code it was', async () => {
    const cwd = await tempDir();
    expect(await runCommand('exit 3', { cwd })).toMatchObject({ code: 3, timedOut: false });
  });

  // Runs IN the project, so a gate like `npm test` resolves that project's own scripts.
  it('runs in the project root', async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, 'marker'));
    expect((await runCommand('ls', { cwd })).output).toContain('marker');
  });

  // The load-bearing one: a gate that hangs must FAIL, loudly, rather than hold the loop for ever. The
  // spec cites Copilot's documented infinite loop, caused by exactly a timeout reported ambiguously.
  it('kills a command that outstays its timeout and says so', async () => {
    const cwd = await tempDir();
    const result = await runCommand('sleep 30', { cwd, timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
  });

  // Whatever it managed to print before it was killed is the most useful thing about it.
  it('keeps the output a timed-out command had already produced', async () => {
    const cwd = await tempDir();
    const result = await runCommand('echo starting; sleep 30', { cwd, timeoutMs: 500 });
    expect(result.output).toContain('starting');
  });

  // The GROUP, not the child. `/bin/sh -c` makes the real work a GRANDCHILD, so killing the shell alone
  // leaves a test runner spending CPU for the rest of the session — the orphan class decision 13 exists
  // for, measured at 16 processes on this machine. Asserted by having the grandchild try to outlive its
  // parent and touch a file afterwards.
  it('kills the whole group, not just the shell it spawned', async () => {
    const cwd = await tempDir();
    const marker = join(cwd, 'survivor');
    await runCommand(`(sleep 1; touch ${marker}) & sleep 30`, { cwd, timeoutMs: 300 });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await expect(stat(marker)).rejects.toThrow();
  });

  // A command that cannot start at all is a failure with a reason, never a throw: the caller is a loop,
  // and an exception here would end the run rather than the verification.
  it('does not throw when the command does not exist', async () => {
    const cwd = await tempDir();
    const result = await runCommand('definitely-not-a-command-8f2a', { cwd });
    expect(result.code).not.toBe(0);
    expect(result.output).not.toBe('');
  });

  it('does not throw when the directory is gone', async () => {
    const result = await runCommand('echo hi', { cwd: '/definitely/not/here' });
    expect(result.code).not.toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('truncates a flood, keeping the end', async () => {
    const cwd = await tempDir();
    const result = await runCommand('for i in $(seq 1 20000); do echo padding-$i; done; echo LAST', { cwd });
    expect(result.output).toContain('LAST');
    expect(result.output).toMatch(/earlier output omitted/i);
  });
});
