import { describe, expect, it } from 'vitest';
import { allows } from '../src/server/auth/auth.js';
import type { Credential } from '../src/server/auth/credentials.js';
import { WIZARD_STEPS, type WizardState } from '../src/store/project/wizard.js';
import { openTestProject, type TestProject } from './helpers.js';

// GET/PUT/DELETE /api/wizard — the setup wizard's scratch state, read and written by the browser
// while a person is being asked what they are building.

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
