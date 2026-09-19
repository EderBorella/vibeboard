import { describe, expect, it } from 'vitest';
import { FOUNDATION_FILES } from '../src/core/layout.js';
import { allows } from '../src/server/auth/auth.js';
import type { Credential } from '../src/server/auth/credentials.js';
import { WIZARD_STEPS, type WizardState } from '../src/store/project/wizard.js';
import { openTestProject, type TestProject } from './helpers.js';

// The setup wizard's scratch state. GET/PUT/DELETE /api/wizard are the browser's, admin-only, and
// read and written while a person is being asked what they are building; `prefill` and `resumes` are
// the two narrow doors an agent has into the same file, and which scope holds which is the point of
// half the tests here. decision 77.

async function open(): Promise<TestProject> {
  return openTestProject({ name: 'W', mode: 'brownfield' });
}

const get = (project: TestProject) => project.app.inject({ method: 'GET', url: '/api/wizard' });

const cred = (scope: 'work' | 'checkup' | 'service' | 'assist'): Credential =>
  ({ scope, project: 'p', run: 'r', card: 'E-001', token: 't' }) as Credential;

describe('the scope table', () => {
  // Absent from the table, so it is admin-only without anyone having to remember to deny it: this
  // file steers what the person is asked and what the copilot is later told, so an agent able to
  // rewrite it could steer its own brief.
  it('keeps the wizard away from every non-admin scope', () => {
    for (const scope of ['work', 'checkup', 'service', 'assist'] as const) {
      for (const method of ['GET', 'PUT', 'DELETE'] as const) {
        expect(allows(cred(scope), method, '/api/wizard', 'p'), `${method} ${scope}`).toBe(false);
      }
    }
  });

  // And at the endpoint itself, because the table is only the default until something proves the
  // request actually reaches it.
  it('refuses an agent credential at the endpoint itself', async () => {
    const project = await open();
    for (const scope of ['work', 'checkup', 'service'] as const) {
      const agent = project.mint(scope, `run-${scope}`, 'E-001');
      const res = await project.app.inject({
        method: 'PUT',
        url: '/api/wizard',
        headers: { authorization: `Bearer ${agent.token}` },
        payload: { mode: 'greenfield', step: 'backend' },
      });
      expect(res.statusCode, scope).toBe(403);
    }
  });
});

describe('GET/PUT/DELETE /api/wizard', () => {
  it('answers null on a project that has never seen the wizard', async () => {
    const project = await open();
    const res = await get(project);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: null });
  });

  it('round-trips a whole state, then forgets it on delete', async () => {
    const project = await open();
    const state: WizardState = {
      mode: 'brownfield',
      step: 'form',
      answers: { what: 'a timeline', who: 'me', done: 'it opens' },
    };
    const put = await project.app.inject({ method: 'PUT', url: '/api/wizard', payload: state });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ state });
    expect((await get(project)).json()).toEqual({ state });

    const removed = await project.app.inject({ method: 'DELETE', url: '/api/wizard' });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true });
    expect((await get(project)).json()).toEqual({ state: null });
  });

  // A replace, not a merge: the browser holds the whole state and sends it. A PUT that merged would
  // make an answer impossible to CLEAR, which is what a person pressing Back and emptying a field does.
  it('replaces rather than merges', async () => {
    const project = await open();
    await project.app.inject({
      method: 'PUT',
      url: '/api/wizard',
      payload: { mode: 'greenfield', step: 'backend', answers: { what: 'a game', who: 'my kid' } },
    });
    await project.app.inject({
      method: 'PUT',
      url: '/api/wizard',
      payload: { mode: 'greenfield', step: 'form', answers: { what: 'a game' } },
    });
    expect((await get(project)).json()).toEqual({
      state: { mode: 'greenfield', step: 'form', answers: { what: 'a game' } },
    });
  });

  it('refuses a body that is not a wizard state', async () => {
    const project = await open();
    for (const payload of [{ step: 'form' }, { mode: 'sideways', step: 'form' }]) {
      const res = await project.app.inject({ method: 'PUT', url: '/api/wizard', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    // And nothing was written on the way to refusing.
    expect((await get(project)).json()).toEqual({ state: null });
  });

  // THE STEP IS WHAT A RESUMED SETUP COMES BACK TO, and it was written unchecked: the browser is the
  // only thing that has ever sent one, so a file naming a step nothing renders was one typo away —
  // and the wizard would have opened on it with the answers still on disk and no way forward.
  it('refuses a step it would not know how to come back to, and names the set', async () => {
    const project = await open();
    const res = await project.app.inject({
      method: 'PUT',
      url: '/api/wizard',
      payload: { mode: 'greenfield', step: 'sideways' },
    });

    expect(res.statusCode).toBe(400);
    // Built from the list rather than spelled out: a refusal that does not say what was expected is
    // one nobody can act on, and a hand-written copy of the set here would be the drift it refuses.
    expect(res.json().error).toContain(WIZARD_STEPS.join(', '));
    expect((await get(project)).json()).toEqual({ state: null });
  });
});

// THE ONE AGENT-FACING WRITE INTO SETUP, and the reason it is safe to have one at all: it can only
// reach `suggested`. A scan run reads a repository nobody has vetted, so whatever it sends must land
// where the form treats it as a proposal — never over a sentence the person typed. decision 77.
describe('PUT /api/wizard/prefill', () => {
  it('merges what a run found into suggested, and touches neither the answers nor the step', async () => {
    const project = await open();
    const state: WizardState = {
      mode: 'brownfield',
      step: 'scan',
      answers: { what: 'mine, in my own words' },
    };
    await project.app.inject({ method: 'PUT', url: '/api/wizard', payload: state });

    const scan = await project.app.inject({
      method: 'PUT',
      url: '/api/wizard/prefill',
      payload: { answers: { what: 'a timeline of releases' }, kind: 'web', packages: ['imagemagick'] },
    });
    expect(scan.statusCode).toBe(200);
    // The stack run posts later, into the same block: the keys that arrive win and the rest survive,
    // because the two runs know different things and neither has the whole picture.
    const stack = await project.app.inject({
      method: 'PUT',
      url: '/api/wizard/prefill',
      payload: { stack: 'TypeScript and Vite', packages: ['sox'] },
    });
    expect(stack.statusCode).toBe(200);

    expect((await get(project)).json()).toEqual({
      state: {
        mode: 'brownfield',
        step: 'scan',
        answers: { what: 'mine, in my own words' },
        suggested: {
          answers: { what: 'a timeline of releases' },
          kind: 'web',
          stack: 'TypeScript and Vite',
          packages: ['sox'],
        },
      },
    });
  });

  // A run outliving the setup that dispatched it is ordinary — the person can abandon the wizard
  // while the scan is still reading. Nothing is written back in that case, and the run is told why
  // rather than being given a file that nothing will ever open.
  it('refuses a prefill when no setup is in progress, and writes nothing', async () => {
    const project = await open();
    const res = await project.app.inject({
      method: 'PUT',
      url: '/api/wizard/prefill',
      payload: { stack: 'TypeScript' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No setup is in progress.' });
    expect((await get(project)).json()).toEqual({ state: null });
  });

  // JUNK FROM A RUN DIES AT THE DOOR. Whatever arrives here is spread into a file the browser reads
  // back and PUTs whole, so an invented key would ride in `suggested` for the rest of setup — and a
  // `step` or a `mode` among them is a run steering the wizard through the one route it was given so
  // that it could not. Filtered to the known field sets at both levels rather than validated, because
  // a scan that guessed one extra field should still deliver the six that were right.
  it('keeps only the keys a suggestion has, at both levels', async () => {
    const project = await open();
    await project.app.inject({
      method: 'PUT',
      url: '/api/wizard',
      payload: { mode: 'brownfield', step: 'scan' },
    });

    const res = await project.app.inject({
      method: 'PUT',
      url: '/api/wizard/prefill',
      payload: {
        answers: { what: 'a timeline', mood: 'confident' },
        kind: 'web',
        step: 'handoff',
        mode: 'greenfield',
        resumes: { 'README.md': 'not yours to write' },
      },
    });
    expect(res.statusCode).toBe(200);

    expect((await get(project)).json()).toEqual({
      state: {
        mode: 'brownfield',
        step: 'scan',
        suggested: { answers: { what: 'a timeline' }, kind: 'web' },
      },
    });
  });

  // A body that is not an object at all. `in` throws on a primitive, so this is the difference
  // between nothing landing and a 500 with a stack trace in the run's report.
  it('takes nothing from a body that is not an object, and does not fall over', async () => {
    const project = await open();
    await project.app.inject({
      method: 'PUT',
      url: '/api/wizard',
      payload: { mode: 'brownfield', step: 'scan', suggested: { kind: 'web' } },
    });

    const res = await project.app.inject({
      method: 'PUT',
      url: '/api/wizard/prefill',
      headers: { 'content-type': 'application/json' },
      payload: '"a stack, honestly"',
    });

    expect(res.statusCode).toBe(200);
    expect((await get(project)).json().state.suggested).toEqual({ kind: 'web' });
  });

  // THE SCOPE A PROJECT RUN IS ACTUALLY MINTED WITH, taken from the runner rather than assumed:
  // `#start` in runs/agent-runner.ts mints `work`, with no card when there is no card. Asserted
  // through a real credential at the real endpoint, because the table is only the default until
  // something proves the request reaches it.
  it('is open to the credential a project run is minted with, and closed to the copilot', async () => {
    const project = await open();
    await project.app.inject({
      method: 'PUT',
      url: '/api/wizard',
      payload: { mode: 'brownfield', step: 'scan' },
    });
    const run = project.mint('work', 'run-scan');

    const allowed = await project.app.inject({
      method: 'PUT',
      url: '/api/wizard/prefill',
      headers: { authorization: `Bearer ${run.token}` },
      payload: { kind: 'web' },
    });
    expect(allowed.statusCode).toBe(200);

    // The copilot writes documents and résumés; it never answers the form's questions, and this is
    // the route that would let it. `checkup` and `service` have no business in setup at all.
    for (const scope of ['assist', 'checkup', 'service'] as const) {
      const other = project.mint(scope, `run-${scope}`);
      const refused = await project.app.inject({
        method: 'PUT',
        url: '/api/wizard/prefill',
        headers: { authorization: `Bearer ${other.token}` },
        payload: { kind: 'game' },
      });
      expect(refused.statusCode, scope).toBe(403);
    }
    expect((await get(project)).json().state.suggested).toEqual({ kind: 'web' });
  });
});

// THE COPILOT'S HALF OF THE SAME FILE, and the only door it has into setup. A résumé summarises a
// document that is still being argued over, so it lives in `wizard.yaml` and dies with it rather than
// beside the document, where it would outlive setup and describe a file somebody has since rewritten
// (decision 76). decision 77.
describe('PUT /api/wizard/resumes/:name', () => {
  const begin = async (project: TestProject): Promise<void> => {
    await project.app.inject({
      method: 'PUT',
      url: '/api/wizard',
      payload: { mode: 'greenfield', step: 'docs', answers: { what: 'a game' } },
    });
  };

  const fileResume = (project: TestProject, name: string, payload: unknown, token?: string) =>
    project.app.inject({
      method: 'PUT',
      url: `/api/wizard/resumes/${name}`,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
      payload: payload as object,
    });

  it('files a summary per document, beside the answers, and a rewrite replaces it', async () => {
    const project = await open();
    await begin(project);

    const first = await fileResume(project, 'STACK.md', { summary: '  TypeScript and Vite.  ' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });
    await fileResume(project, 'README.md', { summary: 'What this project is, in two lines.' });
    // The copilot rewrites a document it has already summarised; the résumé follows it.
    await fileResume(project, 'STACK.md', { summary: 'TypeScript, Vite and Playwright.' });

    expect((await get(project)).json()).toEqual({
      state: {
        mode: 'greenfield',
        step: 'docs',
        answers: { what: 'a game' },
        resumes: {
          'STACK.md': 'TypeScript, Vite and Playwright.',
          'README.md': 'What this project is, in two lines.',
        },
      },
    });
  });

  // The name is a filename from a URL, so it is checked against the set rather than trusted: it is
  // the key of a map the browser renders beside the documents, and a name nothing wrote would be a
  // summary of nothing sitting in the list for ever.
  it('refuses a name that is not a document with a résumé, and names the set', async () => {
    const project = await open();
    await begin(project);

    const res = await fileResume(project, 'NOTES.md', { summary: 'Something else entirely.' });

    expect(res.statusCode).toBe(400);
    for (const name of [...FOUNDATION_FILES.map((f) => f.name), 'README.md']) {
      expect(res.json().error, name).toContain(name);
    }
    expect((await get(project)).json().state.resumes).toBeUndefined();
  });

  // A RÉSUMÉ PAST 600 CHARACTERS IS THE WALL OF TEXT IT EXISTS TO REPLACE (W7). The person reads
  // these before they read anything else in setup, so the length is the contract and not a hint.
  it('refuses a wall of text, and refuses a missing summary, writing neither', async () => {
    const project = await open();
    await begin(project);

    const long = await fileResume(project, 'TESTING.md', { summary: 'a'.repeat(1000) });
    expect(long.statusCode).toBe(400);
    expect(long.json().error).toContain('shorter');

    for (const payload of [{}, { summary: '   ' }, { summary: 42 }]) {
      const res = await fileResume(project, 'TESTING.md', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await get(project)).json().state.resumes).toBeUndefined();
  });

  it('refuses a résumé when no setup is in progress', async () => {
    const project = await open();

    const res = await fileResume(project, 'UX.md', { summary: 'How it should feel.' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No setup is in progress.' });
  });

  // The mirror of the prefill row: the copilot writes the documents, so the copilot files the
  // summaries. A RUN may not — it is not in the conversation the person is reading, and a summary is
  // the one part of a document they are guaranteed to read.
  it('is open to the copilot and closed to a run', async () => {
    const project = await open();
    await begin(project);
    const copilot = project.mint('assist', 'chat-1');

    const allowed = await fileResume(
      project,
      'DESIGN.md',
      { summary: 'Plain, dark, few colours.' },
      copilot.token,
    );
    expect(allowed.statusCode).toBe(200);

    for (const scope of ['work', 'checkup', 'service'] as const) {
      const run = project.mint(scope, `run-${scope}`);
      const refused = await fileResume(
        project,
        'DESIGN.md',
        { summary: 'Something a run wrote.' },
        run.token,
      );
      expect(refused.statusCode, scope).toBe(403);
    }
    expect((await get(project)).json().state.resumes).toEqual({ 'DESIGN.md': 'Plain, dark, few colours.' });
  });
});
