import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { foundationRel } from '../src/core/layout.js';
import { checkSmokeCommand } from '../src/core/smoke-declaration.js';
import { buildApp } from '../src/server/app.js';
import { allows } from '../src/server/auth.js';
import { type Credential, CredentialStore } from '../src/server/credentials.js';
import { ProjectSession } from '../src/server/session.js';
import { declaredCommands, readSmokeCommand, writeSmokeCommand } from '../src/store/project/foundation.js';
import { tempDir } from './helpers.js';

// Ruling 67. The deadlock this closes was real and cost a whole run: the mandatory harness feature's card
// asked for a declaration in foundation/TESTING.md, decision 3 refuses that file to every autonomous scope,
// and `protectedPaths` mounts it read-only — so the one feature every project must finish was the one feature
// no dispatched run could finish. Three reviews sent it back for exactly that before the review bound stopped
// auto-pilot at iteration 124.

const ADMIN = 'admin-token-for-smoke';
const admin = { authorization: `Bearer ${ADMIN}` };
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const GATES = '---\ngates:\n  - name: tests\n    command: npm test\n---\nThe bar every card clears.\n';

// Two frontmatter keys and two paragraphs, all of which must survive a write that sets one scalar.
const TESTING = `---
smoke: npm test
other: keep me
---
What a smoke test means here.

A second paragraph, so a writer that rebuilt the file from a template would be caught.
`;

async function open(): Promise<{ app: FastifyInstance; store: CredentialStore; root: string }> {
  const session = new ProjectSession();
  const store = new CredentialStore(ADMIN);
  const app = buildApp(session, { credentials: store, logger: false });
  const root = await tempDir();
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    headers: admin,
    payload: { path: root, name: 'S', mode: 'brownfield' },
  });
  for (const [name, content] of [
    ['CODE-QUALITY.md', GATES],
    ['TESTING.md', TESTING],
  ] as const) {
    await app.inject({
      method: 'PUT',
      url: `/api/control/foundation/${name}`,
      headers: admin,
      payload: { content },
    });
  }
  return { app, store, root };
}

const cred = (scope: 'work' | 'checkup' | 'service' | 'assist', card?: string): Credential =>
  ({ scope, project: 'p', run: 'r', card, token: 't' }) as Credential;

describe('checkSmokeCommand', () => {
  it('refuses a command that is one of the gates, and says what to do instead', () => {
    const r = checkSmokeCommand('npm test', ['npm test']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The refusal has to carry the remedy. An agent told only "that is a gate" tries the next gate.
    expect(r.reason).toContain('one check rather than two');
    expect(r.reason).toContain('from outside');
  });

  it('accepts a command that differs from every gate, trimmed', () => {
    expect(checkSmokeCommand('  npm run smoke  ', ['npm test', 'npm run lint'])).toEqual({
      ok: true,
      command: 'npm run smoke',
    });
  });

  // Trimmed BEFORE the comparison, or `npm test ` slips past and declares the gate as the smoke command with
  // a trailing space — two commands to the machine, one to every person who reads it.
  it('compares against the gates after trimming, not before', () => {
    expect(checkSmokeCommand(' npm test ', ['npm test']).ok).toBe(false);
  });

  it('refuses empty, blank, non-string and multi-line commands', () => {
    for (const bad of ['', '   ', 42, null, undefined, { command: 'x' }]) {
      expect(checkSmokeCommand(bad, []).ok, JSON.stringify(bad) ?? 'undefined').toBe(false);
    }
    const multi = checkSmokeCommand('cd app\nnpm run smoke', []);
    expect(multi.ok).toBe(false);
    if (!multi.ok) expect(multi.reason).toContain('single line');
  });

  it('refuses a command past the length ceiling', () => {
    expect(checkSmokeCommand(`echo ${'x'.repeat(600)}`, []).ok).toBe(false);
  });

  // A project with no readable gates has nothing to collide with, so this must not fail closed: the harness
  // feature would then be unfinishable on exactly the projects that most need one.
  it('accepts any command when the project declares no gates', () => {
    expect(checkSmokeCommand('./run-smoke.sh', []).ok).toBe(true);
  });
});

describe('writeSmokeCommand', () => {
  it('sets `smoke:` and leaves the prose and the other keys alone', async () => {
    const { root } = await open();
    expect(await writeSmokeCommand(root, 'npm run smoke')).toEqual({ ok: true });

    const raw = await readFile(join(root, foundationRel('TESTING.md')), 'utf8');
    // Both paragraphs and the neighbouring key: this is a read-modify-write over a document a person wrote,
    // and a template-based writer that dropped the prose would still satisfy a check on `smoke:` alone.
    expect(raw).toContain('What a smoke test means here.');
    expect(raw).toContain(
      'A second paragraph, so a writer that rebuilt the file from a template would be caught.',
    );
    expect(raw).toContain('other: keep me');
    expect(await readSmokeCommand(root)).toEqual({ ok: true, command: 'npm run smoke' });
  });

  it('refuses an unparseable document rather than overwriting what it cannot read', async () => {
    const { app, root } = await open();
    const broken = '---\nsmoke: "unclosed\n---\nProse worth keeping.\n';
    await app.inject({
      method: 'PUT',
      url: '/api/control/foundation/TESTING.md',
      headers: admin,
      payload: { content: broken },
    });
    const r = await writeSmokeCommand(root, 'npm run smoke');
    expect(r.ok).toBe(false);
    expect(await readFile(join(root, foundationRel('TESTING.md')), 'utf8')).toBe(broken);
  });

  it('refuses when the document does not exist', async () => {
    const r = await writeSmokeCommand(await tempDir(), 'npm run smoke');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('does not exist');
  });
});

// The scope row is the fix. `work` is what an implement run carries, and it is precisely the scope that was
// refused when this deadlocked.
describe('the scope table', () => {
  it('lets every autonomous scope declare the smoke command', () => {
    for (const scope of ['work', 'checkup', 'service'] as const) {
      expect(allows(cred(scope, 'E-001'), 'POST', '/api/foundation/smoke', 'p'), scope).toBe(true);
    }
  });

  // Decision 3, unchanged and still doing its job: the document that carries `gates:` is refused to the same
  // credential that may now declare `smoke:`. If this ever flips, a run can lower the bar it is judged against.
  it('still refuses every autonomous scope the foundation documents themselves', () => {
    for (const scope of ['work', 'checkup', 'service'] as const) {
      expect(allows(cred(scope, 'E-001'), 'PUT', '/api/control/foundation/:name', 'p'), scope).toBe(false);
    }
    expect(allows(cred('assist'), 'PUT', '/api/control/foundation/:name', 'p')).toBe(true);
  });
});

describe('POST /api/foundation/smoke', () => {
  it('lets a work run declare the command it could not declare before', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    const res = await app.inject({
      method: 'POST',
      url: '/api/foundation/smoke',
      headers: bearer(work.token),
      payload: { command: 'npm run smoke' },
    });
    expect(res.statusCode).toBe(200);
    expect(await declaredCommands(root)).toEqual({ gates: ['npm test'], smoke: 'npm run smoke' });
  });

  it('refuses the gate command, and writes nothing when it does', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    const res = await app.inject({
      method: 'POST',
      url: '/api/foundation/smoke',
      headers: bearer(work.token),
      payload: { command: 'npm test' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('one check rather than two');
    // A refusal that wrote first would declare the very collision it just refused.
    expect(await readSmokeCommand(root)).toEqual({ ok: true, command: 'npm test' });
  });

  it('refuses a body with no command', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    const res = await app.inject({
      method: 'POST',
      url: '/api/foundation/smoke',
      headers: bearer(work.token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // The endpoint reaches ONE key. A body that tried to carry the gates alongside it must not move them —
  // that would be decision 3 defeated through the route that was opened to close a deadlock.
  it('cannot be used to reach the gates', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    await app.inject({
      method: 'POST',
      url: '/api/foundation/smoke',
      headers: bearer(work.token),
      payload: { command: 'npm run smoke', gates: [{ name: 'nothing', command: 'true' }] },
    });
    expect((await declaredCommands(root)).gates).toEqual(['npm test']);
  });
});
