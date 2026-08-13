import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { parse, stringify } from 'yaml';
import { configPath } from '../src/core/config.js';
import { skillRel } from '../src/core/layout.js';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/credentials.js';
import type { Readiness } from '../src/server/routes/autopilot.js';
import { ProjectSession } from '../src/server/session.js';
import { makeReady, openTestProject, putFoundation, tempDir } from './helpers.js';

const README = `# Timeline\n\n${'A tool that turns a folder of notes into a searchable timeline. '.repeat(4)}\n`;

const GATES = '---\ngates:\n  - name: tests\n    command: npm test\n---\nThe bar every card clears.\n';
const TESTING = '---\nsmoke: npm run smoke\n---\nWhat a smoke test means here.\n';

async function readiness(app: FastifyInstance): Promise<Readiness> {
  const res = await app.inject({ method: 'GET', url: '/api/autopilot/readiness' });
  expect(res.statusCode).toBe(200);
  return res.json() as Readiness;
}

describe('GET /api/autopilot/readiness', () => {
  it('names every blocker on a fresh project rather than answering a bare false', async () => {
    const { app } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const r = await readiness(app);
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain(
      'This project has no README. Auto-pilot derives the whole feature list from it.',
    );
    expect(r.blockers).toContain('foundation/CODE-QUALITY.md has not been written yet.');
    expect(r.blockers).toContain('foundation/DESIGN.md has not been written yet.');
    // The lifecycle itself is complete on a project scaffolded today — that is the point of the
    // cover check running at save time.
    expect(r.phases.problems).toEqual([]);
    expect(r.phases.count).toBeGreaterThan(0);
  });

  // The correction, and it is the whole of the bootstrap on this side: an empty board with a README is the
  // state auto-pilot DERIVES the board from, so blocking it made the flow self-contradictory in a real
  // project's hands — it could not start without a card, and the run that creates the cards was the one it
  // could not start. The panel and the tick now read the same two facts, the bootstrap phase's skill included.
  it('does NOT block an empty board when the README is there to derive it from', async () => {
    const { app, root } = await openTestProject({ name: 'A', mode: 'brownfield' });
    await writeFile(join(root, 'README.md'), README, 'utf8');
    await putFoundation(app, 'STACK.md', 'Node 22.\n');
    await putFoundation(app, 'CODE-QUALITY.md', GATES);
    await putFoundation(app, 'TESTING.md', TESTING);
    await putFoundation(app, 'UX.md', 'One screen.\n');
    await putFoundation(app, 'DESIGN.md', 'One accent.\n');

    const r = await readiness(app);
    expect(r.blockers).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // The blocker that remains, and it is a different fact: nothing on the board AND nothing to derive one
  // from. The README's own blocker names the file; this one names the consequence, because a person reading
  // "write a README" needs to know that the board being empty is why it matters.
  it('blocks an empty board with no README, naming both ways forward', async () => {
    const { app } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const r = await readiness(app);
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain(
      'There is no card on any board, and nothing auto-pilot could derive one from. Add a card, or write the README so it can derive the feature list from it.',
    );
  });

  it('says yes once the README and the five documents are there', async () => {
    const { app, root } = await openTestProject({ name: 'A', mode: 'brownfield' });
    await makeReady(app, root);
    const r = await readiness(app);
    expect(r.blockers).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.readme).toEqual({ ok: true, path: 'README.md' });
    expect(r.gates).toEqual({ ok: true, count: 1 });
    expect(r.smoke).toEqual({ ok: true });
  });

  // The difference between "no file" and "a file that decides nothing" is the whole reason the gate
  // reader exists — foundation.missing cannot see the second one.
  it('reports a CODE-QUALITY.md that exists but declares no gates', async () => {
    const { app, root } = await openTestProject({ name: 'A', mode: 'brownfield' });
    await makeReady(app, root);
    await putFoundation(app, 'CODE-QUALITY.md', '# Quality\n\nBe careful.\n');
    const r = await readiness(app);
    expect(r.ok).toBe(false);
    expect(r.foundation.missing).toEqual([]); // the file is there
    expect(r.blockers).toEqual([
      'foundation/CODE-QUALITY.md declares no gates, and a card cannot pass a gate set that is empty.',
    ]);
  });

  // Saying both "the file is missing" and "the file declares nothing" about one absent file is two
  // reports of one problem, and the second reads as though writing the file would not be enough.
  it('does not report a missing document twice', async () => {
    const { app } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const r = await readiness(app);
    expect(r.blockers.filter((b) => b.includes('CODE-QUALITY.md'))).toEqual([
      'foundation/CODE-QUALITY.md has not been written yet.',
    ]);
    expect(r.blockers.filter((b) => b.includes('TESTING.md'))).toEqual([
      'foundation/TESTING.md has not been written yet.',
    ]);
  });

  // Skills are ordinary files a person may delete from Project Control, and the phase table has no
  // idea. Deleting the one a phase runs makes that phase quietly impossible, so readiness has to be
  // where it surfaces.
  it('names a phase whose skill has been deleted', async () => {
    const { app, root } = await openTestProject({ name: 'A', mode: 'brownfield' });
    await makeReady(app, root);
    expect((await readiness(app)).ok).toBe(true);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/control/file?path=${encodeURIComponent(skillRel('implement', 'SKILL.md'))}`,
    });
    expect(deleted.statusCode).toBe(200);

    const r = await readiness(app);
    expect(r.ok).toBe(false);
    expect(r.phases.problems.join(' ')).toContain('task-implement');
    expect(r.phases.problems.join(' ')).toContain('"implement"');
    // Every one of them reaches the blocker list — the panel shows one list, not two.
    expect(r.blockers).toEqual(expect.arrayContaining(r.phases.problems));
  });

  // The empty board on the NEW basis, and this is the disagreement Task 16 closes. Readiness used to ask
  // "does the first features column route to a skill?" while the tick took the bootstrap's skill from the
  // phase table and derived the board regardless — so a project whose features route had been removed was
  // told it could not bootstrap by the panel that the loop would have bootstrapped anyway.
  it('does not blame an empty board on the config', async () => {
    const { app, root } = await openTestProject({ name: 'A', mode: 'brownfield' });
    await makeReady(app, root, { cards: false });
    // No config edit is even possible now: the bootstrap's skill comes from the phase table, and there is
    // nothing left in the block for a project to point somewhere else. That IS the disagreement Task 16 closed.
    const r = await readiness(app);
    expect(r.blockers.join(' ')).not.toContain('There is no card on any board');
  });

  // And it IS blocked when the phase table's own skill is missing: the bootstrap is a row in that table,
  // so the fact that decides whether an empty board can be derived is whether that row's skill exists.
  it('blocks an empty board when the bootstrap phase has no skill', async () => {
    const { app, root } = await openTestProject({ name: 'A', mode: 'brownfield' });
    await makeReady(app, root, { cards: false });
    expect((await readiness(app)).ok).toBe(true);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/control/file?path=${encodeURIComponent(skillRel('derive-features', 'SKILL.md'))}`,
    });
    expect(deleted.statusCode).toBe(200);

    const r = await readiness(app);
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain(
      'There is no card on any board, and nothing auto-pilot could derive one from. Add a card, or write the README so it can derive the feature list from it.',
    );
  });

  it('refuses when no project is open, rather than reporting on nothing', async () => {
    const session = new ProjectSession();
    const app = buildApp(session, { credentials: new CredentialStore('t'), logger: false });
    onTestFinished(async () => {
      await app.close();
      await session.close();
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/autopilot/readiness',
      headers: { authorization: 'Bearer t' },
    });
    expect(res.statusCode).toBe(409);
  });
});

// Absent from the scope table means admin-only. That is the property slice F built, and this is the
// first route added since — so it is worth one test that the default actually holds.
describe('readiness is not an agent’s business', () => {
  it('refuses a work credential', async () => {
    const session = new ProjectSession();
    const store = new CredentialStore('admin-token');
    const app = buildApp(session, { credentials: store, logger: false });
    const root = await tempDir();
    onTestFinished(async () => {
      await app.close();
      await session.close();
    });
    await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      headers: { authorization: 'Bearer admin-token' },
      payload: { path: root, name: 'A', mode: 'brownfield' },
    });

    for (const scope of ['work', 'checkup', 'service'] as const) {
      const cred = store.mintRun(scope, `run-${scope}`, root, 'E-001');
      const res = await app.inject({
        method: 'GET',
        url: '/api/autopilot/readiness',
        headers: { authorization: `Bearer ${cred.token}` },
      });
      expect(res.statusCode, scope).toBe(403);
    }
  });
});

// A hand-edited config.yaml reaches the endpoint unnormalised — readConfig is a bare YAML parse, and
// only defaultConfig clones the defaults. The validator already computes the shape problems; the
// endpoint's job is to hand them over rather than crash on the way.
describe('readiness on a malformed autopilot block', () => {
  it('reports the shape problems instead of failing with a 500', async () => {
    const { app, root, session } = await openTestProject({ name: 'A', mode: 'brownfield' });
    const config = parse(await readFile(configPath(root), 'utf8')) as Record<string, unknown>;
    config.autopilot = { maxIterations: 10 };
    await writeFile(configPath(root), stringify(config), 'utf8');
    await session.reloadConfig();

    const res = await app.inject({ method: 'GET', url: '/api/autopilot/readiness' });
    expect(res.statusCode).toBe(200);
    const r = res.json() as Readiness;
    expect(r.ok).toBe(false);
    expect(r.phases.problems).toContain('autopilot.terminal must name the terminal columns of each board.');
    // The number of phases that dispatch, which is a fact about the machine rather than about this
    // project's config — so a malformed block does not make it zero.
    expect(r.phases.count).toBeGreaterThan(0);
    expect(r.blockers).toEqual(expect.arrayContaining(r.phases.problems));
  });

  // SHAPE FIRST AND ALONE, one layer up from `coverageProblems`' own guard. `{autopilot: {maxIterations: 10}}`
  // produced a 500 "ap.routes is not iterable" when the block held a routing table, and reporting the phase
  // check
  // alongside a shape problem would bury the one thing the reader has to fix first.
  it('still reports the shape problems first and alone', async () => {
    const { app, root, session } = await openTestProject({ name: 'A', mode: 'brownfield' });
    await makeReady(app, root);
    const config = parse(await readFile(configPath(root), 'utf8')) as Record<string, unknown>;
    config.autopilot = { maxIterations: 10 };
    await writeFile(configPath(root), stringify(config), 'utf8');
    await session.reloadConfig();
    // A skill a phase needs, deleted as well: with both wrong, only the shape is reported.
    await app.inject({
      method: 'DELETE',
      url: `/api/control/file?path=${encodeURIComponent(skillRel('fix', 'SKILL.md'))}`,
    });

    const r = await readiness(app);
    expect(r.phases.problems.every((p) => p.startsWith('autopilot.'))).toBe(true);
  });
});
