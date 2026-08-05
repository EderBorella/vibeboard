import { chmodSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { foundationRel } from '../src/core/layout.js';
import { writeAutopilotState } from '../src/server/autopilot-store.js';
import { openTestProject, testTmp, wsClient } from './helpers.js';

// Pressing start, and every way it refuses. Each refusal has to name the way forward — a control whose
// refusal is invisible is the dead end this design will not ship.

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-service.mjs');

beforeAll(() => {
  chmodSync(SHIM, 0o755);
});

async function shimLog(): Promise<string> {
  return join(await mkdtemp(join(testTmp(), 'start-')), 'record.json');
}

// A project that is genuinely ready — every blocker readiness knows about, cleared. Written out rather
// than scaffolded, because the scaffold deliberately does NOT manufacture these: a placeholder foundation
// document is exactly what decision 7's pre-flight exists to refuse.
const DOCS: Record<string, string> = {
  'STACK.md': '# Stack\n\nNode and TypeScript.\n',
  'UX.md': '# UX\n\nA board, three columns deep.\n',
  'DESIGN.md': '# Design\n\nFiles are canonical.\n',
  // Frontmatter, not a code fence: `readGates` reads `gates:` as data so the commands are a list a
  // person edits and a machine runs, never prose to be parsed.
  'CODE-QUALITY.md': '---\ngates:\n  - name: tests\n    command: npm test\n---\nWhat these gates mean.\n',
  'TESTING.md': '---\nsmoke: npm run smoke\n---\nHow this project is exercised.\n',
};

async function ready(opts: { behaviour?: string } = {}) {
  const log = await shimLog();
  const project = await openTestProject({
    serviceCommand: () => ({
      bin: process.execPath,
      args: [SHIM, log, opts.behaviour ?? 'sleep'],
    }),
  });
  // Long enough to clear the README gate's minimum, which exists because a two-line README is a
  // feature list nobody can derive.
  await writeFile(
    join(project.root, 'README.md'),
    [
      '# A project',
      '',
      'It keeps a list of things to do, and it keeps that list in files on disk so that',
      'the list outlives the program that shows it. A person adds an item, marks it done,',
      'and can read the whole thing with an editor if the program is not running.',
      '',
      'Nothing is stored anywhere else, and nothing is sent anywhere.',
    ].join('\n'),
  );
  for (const [name, body] of Object.entries(DOCS)) {
    const path = join(project.root, foundationRel(name));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  // The fixture asserts its own premise. A project that is not actually ready would make every refusal
  // test below pass for the wrong reason — and the 412 it produces is the same one a real blocker
  // produces, so nothing would look wrong.
  const readiness = await project.app.inject({ method: 'GET', url: '/api/autopilot/readiness' });
  if (!readiness.json().ok) {
    throw new Error(`the fixture is not ready: ${JSON.stringify(readiness.json().blockers)}`);
  }
  return { ...project, log };
}

const start = (app: Awaited<ReturnType<typeof ready>>['app']) =>
  app.inject({ method: 'POST', url: '/api/autopilot/start', payload: {} });

describe('pressing start', () => {
  it('starts the loop and reports the running state', async () => {
    const { app } = await ready();
    const res = await start(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().state.state).toBe('running');
    expect(res.json().state.servicePgid).toBeGreaterThan(1);
  });

  it('tells every open tab, so a second window does not show a stopped project', async () => {
    const { app } = await ready();
    await app.listen({ port: 0 });
    const ws = wsClient<{ type: string; state?: { state?: string } }>(
      `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
    );
    await ws.open;
    await start(app);
    const message = await ws.waitFor((m) => m.type === 'autopilot:state');
    expect(message.state?.state).toBe('running');
    ws.ws.close();
  });

  it('refuses when the project is not ready, and lists what to fix', async () => {
    // No gate command: `verify: gates` would then fail closed on every card, so a run that started here
    // could never advance anything.
    const { app } = await openTestProject();
    const res = await start(app);
    expect(res.statusCode).toBe(412);
    expect(res.json().blockers.length).toBeGreaterThan(0);
    expect(res.json().error).toContain('not ready');
  });

  it('refuses without a sandbox, which is mandatory for the one caller that runs unattended', async () => {
    const { app } = await openTestProject({
      sandbox: { ok: false, reason: 'AppArmor is not installed' },
    });
    const res = await start(app);
    expect(res.statusCode).toBe(412);
    expect(res.json().error).toContain('AppArmor is not installed');
  });

  it('refuses while halted, and says a person has to restart it', async () => {
    const { app, root } = await ready();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'halted', reason: 'killed' });
    const res = await start(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('halted');
    expect(res.json().error).toContain('Restart');
  });

  // TWO guards, and they answer different questions — so each needs its own assertion, on its own
  // sentence. Asserting the substring they share let the endpoint's check be deleted with nothing
  // failing, because the service refused the second child anyway.
  it('refuses a second start because the STATE says this project is running', async () => {
    const { app } = await ready();
    expect((await start(app)).statusCode).toBe(200);
    const again = await start(app);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('Auto-pilot is already running this project.');
  });

  it('and refuses again because THIS server is holding a loop, whatever the file says', async () => {
    // The state file rewritten behind the endpoint's back — which is what a second server, or a
    // hand-edit, looks like. The process this server started is still alive, and starting a second would
    // leak it: two loops dispatching into one project, each counting only its own iterations.
    const { app, root } = await ready();
    expect((await start(app)).statusCode).toBe(200);
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'stopped' });
    const again = await start(app);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('Auto-pilot is already running in this server.');
  });

  it('refuses with no project open', async () => {
    const { app, session } = await ready();
    await session.close();
    expect((await start(app)).statusCode).toBe(409);
  });
});

describe('and an emergency stop takes it down with everything else', () => {
  it('signals the process group the start recorded', async () => {
    const { app } = await ready();
    const started = await start(app);
    const pgid = started.json().state.servicePgid as number;
    expect(pgid).toBeGreaterThan(1);

    const killed = await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    expect(killed.statusCode).toBe(200);
    expect(killed.json().state.state).toBe('halted');

    // The group is gone. `process.kill(pgid, 0)` throws ESRCH once nothing in it is left, which is the
    // only way to ask from outside — and it is the recorded pgid that is checked, not a handle this test
    // kept, because the reaper reads that number off disk.
    for (let i = 0; i < 100; i += 1) {
      try {
        process.kill(pgid, 0);
      } catch {
        return; // gone
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    // Reached only if the group is still alive after two seconds.
    expect.fail(`the service group ${pgid} survived the emergency stop`);
  });

  it('leaves the state halted rather than letting the supervisor overwrite it', async () => {
    // The child dies because it was killed, and the supervisor's exit handler runs. It must not turn a
    // deliberate `halted` into `stopped`, or the overlay would clear itself moments after the user
    // pressed the emergency stop.
    const { app } = await ready();
    await start(app);
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    await new Promise((r) => setTimeout(r, 400));
    const res = await app.inject({ method: 'GET', url: '/api/autopilot/state' });
    expect(res.json().state.state).toBe('halted');
    expect(res.json().state.reason).toBe('killed');
  });
});
