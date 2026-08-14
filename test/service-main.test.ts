import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from './helpers.js';

// `src/service/main.ts` — the auto-pilot loop as a process — had NO test of any kind, and its own comment
// said "nothing here is worth a test, which is the point of it being this small". True of the plumbing;
// not true of the two refusals, which are the only thing standing between a wiring mistake and a loop that
// dies inside its first tick with `undefined` in a URL.
//
// It also read as covered when it was not. Three test files name it and none runs it:
// service-process.test.ts spawns `fixtures/fake-service.mjs`, lifecycle-trace.test.ts calls `runLoop` and
// `performAction` "composed the way src/service/main.ts composes it" — a copy of the wiring, not the
// wiring — and the third IS the stub. Mutation testing reported 0% on 52 mutants, which was read as "the
// tool cannot see a child process" when the truth was that nothing could see it.
//
// SPAWNED FOR REAL, through tsx, because that is the only way to test a file whose behaviour IS its exit
// code. Every case here exits at or before the pre-flight board check, so none of them reaches
// `startSession` or `runLoop`: no repository is touched and no loop can escape the test.
const ENTRY = join(process.cwd(), 'src', 'service', 'main.ts');
const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx');

interface Exit {
  code: number | null;
  stderr: string;
  stdout: string;
}

// A DELIBERATELY MINIMAL environment, built rather than inherited: vitest.config.ts already puts several
// VIBEBOARD_* variables on process.env, and a test of "what happens when this variable is absent" that
// inherits the ambient one proves nothing. PATH and HOME only, plus whatever the case is about.
async function runLoopEntry(env: Record<string, string>): Promise<Exit> {
  const child = spawn(TSX, [ENTRY], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => {
    stdout += c.toString();
  });
  child.stderr.on('data', (c: Buffer) => {
    stderr += c.toString();
  });
  return await new Promise<Exit>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const TOKEN = 'VIBEBOARD_SERVICE_TOKEN';
const BASE = 'VIBEBOARD_API_BASE';
const ROOT = 'VIBEBOARD_PROJECT_ROOT';

describe('the auto-pilot loop refuses to start on a wiring mistake', () => {
  it('names every variable it is missing, and exits 2', async () => {
    const exit = await runLoopEntry({});
    expect(exit.code).toBe(2);
    expect(exit.stderr).toContain('the auto-pilot loop cannot start');
    for (const name of [TOKEN, BASE, ROOT]) expect(exit.stderr).toContain(name);
  }, 30_000);

  // The case that gives the `missing` array a job. With all three absent, a mutant that lists the wrong
  // variables — or all of them always — passes the test above unnoticed; naming ONE means the other two
  // have to be absent from the message, which is the assertion that actually constrains it.
  it.each([
    { absent: TOKEN, present: [BASE, ROOT] },
    { absent: BASE, present: [TOKEN, ROOT] },
    { absent: ROOT, present: [TOKEN, BASE] },
  ])(
    'names $absent alone when it is the only one missing',
    async ({ absent, present }) => {
      const env: Record<string, string> = {};
      for (const name of present) env[name] = name === BASE ? 'http://127.0.0.1:1' : 'set';
      const exit = await runLoopEntry(env);
      expect(exit.code).toBe(2);
      expect(exit.stderr).toContain(absent);
      for (const other of present) expect(exit.stderr).not.toContain(other);
    },
    30_000,
  );

  // The second refusal: the environment is complete, so it gets as far as asking the board whether the
  // project is still open — and says what the board said. Port 1 has nothing listening, which is the
  // cheapest honest version of "the server is not there"; BoardClient turns the connection failure into a
  // reason rather than throwing, and this asserts that reason reaches stderr instead of a stack trace.
  it('reports what the board said when the pre-flight fails, and exits 2', async () => {
    const root = await tempDir();
    const exit = await runLoopEntry({
      [TOKEN]: 'no-such-token',
      [BASE]: 'http://127.0.0.1:1',
      [ROOT]: root,
    });
    expect(exit.code).toBe(2);
    expect(exit.stderr).toContain('the auto-pilot loop cannot start');
    expect(exit.stderr).toContain('could not reach the board');
    // Not a crash. An unhandled rejection would exit 1 and print a stack, which is the failure mode the
    // reason-not-throw contract in BoardClient exists to prevent.
    expect(exit.stderr).not.toContain('UnhandledPromiseRejection');
  }, 30_000);
});
