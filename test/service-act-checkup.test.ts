import { describe, expect, it } from 'vitest';
import type { TickAction } from '../src/core/actions.js';
import type { Verification } from '../src/core/verify.js';
import { type ActDeps, performAction } from '../src/service/act.js';
import { BREAKDOWN, CARD, context, deps, record, recorder } from './service-act-fixtures.js';

// THE CHECKUP'S EVIDENCE, GATHERED BY THE LOOP (ruling 60). Every card run is minted `work` scope, and three of
// the four facts a checkup needs are unreachable from it. Widening the scope table would grant an agent
// authority to solve a problem the loop can solve — and the loop already holds every one of them.
describe('a checkup’s evidence', () => {
  const smokePass = async (): Promise<Verification> => ({
    mode: 'smoke',
    passed: true,
    at: 'T',
  });
  const smokeFail = async (): Promise<Verification> => ({
    mode: 'smoke',
    passed: false,
    at: 'T',
    command: 'npm run smoke',
    output: 'exited 1',
    reason: '`npm run smoke` exited with 1.',
  });
  const gates = async (): Promise<Verification> => ({ mode: 'gates', passed: true, at: 'T' });

  const verify = (smoke: () => Promise<Verification>) => ({ gates, smoke }) as unknown as ActDeps['verify'];

  // F-001 → P-001, P-002. P-001 → E-001 (blocked). Two stories, so "all of them" can be told from "one of
  // them", and a blocked grandchild so `blockedUnder` has something to find two levels down.
  const feature = { ...CARD('F-001', 'features'), columnSlug: 'in-progress', links: ['P-001', 'P-002'] };
  const story = { ...CARD('P-001', 'product'), columnSlug: 'done', links: ['E-001'] };
  const story2 = { ...CARD('P-002', 'product'), columnSlug: 'done', links: [] };
  const task = { ...CARD('E-001', 'engineering'), columnSlug: 'blocked' };

  const FEATURE_CHECKUP: TickAction = {
    kind: 'dispatch',
    phase: 'feature-checkup',
    skill: 'checkup-feature',
    card: feature,
  };
  // THE STORY'S JUDGEMENT is told what is under its card exactly as the checkup it absorbed was — it reads
  // the same `CHECKUP_PHASES` list — but it takes the gates-first path, so it carries the run its verdict
  // lands on.
  const STORY_REVIEW: TickAction = {
    kind: 'dispatch',
    phase: 'story-review',
    skill: 'review-story',
    card: story,
    previous: 'WORK-1',
  };

  const board = () => [feature, story, story2, task];

  it('runs the smoke command before dispatching checkup-feature, and hands the result over', async () => {
    const order: string[] = [];
    const r = recorder({ boardCards: board() });
    const original = r.client.dispatch;
    r.client.dispatch = async (input) => {
      order.push('dispatch');
      return original(input);
    };
    await performAction(
      deps(r.client, {
        verify: {
          gates,
          smoke: async () => {
            order.push('smoke');
            return await smokePass();
          },
        } as unknown as ActDeps['verify'],
      }),
      FEATURE_CHECKUP,
      context,
    );
    expect(order).toEqual(['smoke', 'dispatch']);
    expect(r.requests[0]?.checkup?.smoke).toMatchObject({ mode: 'smoke', passed: true });
  });

  it('does not run the smoke command for a story judgement', async () => {
    // A story has no end-to-end command of its own; the one `foundation/TESTING.md` declares is the feature's.
    let ran = 0;
    const r = recorder({ boardCards: board() });
    await performAction(
      deps(r.client, {
        verify: {
          gates,
          smoke: async () => {
            ran += 1;
            return await smokePass();
          },
        } as unknown as ActDeps['verify'],
      }),
      STORY_REVIEW,
      context,
    );
    expect(ran).toBe(0);
    expect(r.requests[0]?.checkup?.smoke).toBeUndefined();
  });

  // WHICH CHECKUP THIS IS, sent by the LOOP rather than worked out by the prompt. Ruling 66's second fix
  // asks the feature checkup a question no other run is asked, and this is the flag that decides it.
  //
  // TESTED HERE AND NOT ONLY IN THE PROMPT, because the prompt's own tests cannot see this: replacing the
  // phase check with `smoke.smoke ? …` left all 4,627 of them passing, since a prompt handed the flag
  // renders correctly however the flag was decided. The wrong decision is invisible one layer up.
  it('marks the FEATURE checkup, so the prompt can ask it the question no gate can', async () => {
    const r = recorder({ boardCards: board() });
    await performAction(deps(r.client, { verify: verify(smokePass) }), FEATURE_CHECKUP, context);
    expect(r.requests[0]?.checkup?.feature).toBe(true);
  });

  it('does not mark a story judgement', async () => {
    const r = recorder({ boardCards: board() });
    await performAction(deps(r.client, { verify: verify(smokePass) }), STORY_REVIEW, context);
    expect(r.requests[0]?.checkup?.feature).toBeUndefined();
  });

  // NOT KEYED ON THE SMOKE RESULT. A failed smoke command is the case that matters most — the feature
  // demonstrably does not run — so it is the case where the question must certainly still be asked.
  //
  // The stronger claim, that inferring from `smoke` would be WRONG, was checked and is false for every
  // input that exists today: `verifySmoke` always answers a `Verification`, a failed one when nothing is
  // declared. The reason the phase is read instead is written where the code is, and it is about what the
  // two DEPEND on rather than what they currently answer. No test can distinguish them, and pretending one
  // does would be worse than saying so.
  it('marks it even when the smoke command failed', async () => {
    const r = recorder({ boardCards: board() });
    await performAction(deps(r.client, { verify: verify(smokeFail) }), FEATURE_CHECKUP, context);
    expect(r.requests[0]?.checkup?.smoke).toMatchObject({ passed: false });
    expect(r.requests[0]?.checkup?.feature).toBe(true);
  });

  it('dispatches the checkup even when the smoke command failed', async () => {
    // EVIDENCE, NOT A GATE (ruling 55). A feature whose smoke command fails is exactly what a person needs
    // told about, and blocking there would stop the project instead of reporting it.
    const r = recorder({ boardCards: board() });
    await performAction(deps(r.client, { verify: verify(smokeFail) }), FEATURE_CHECKUP, context);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0]?.checkup?.smoke).toMatchObject({ passed: false, command: 'npm run smoke' });
  });

  it('assembles the children and the blocked list from the board it already read', async () => {
    const r = recorder({ boardCards: board() });
    await performAction(deps(r.client, { verify: verify(smokePass) }), FEATURE_CHECKUP, context);
    const evidence = r.requests[0]?.checkup;
    // A feature's children are its STORIES, one board down — not its tasks.
    expect(evidence?.children.map((c) => c.id)).toEqual(['P-001', 'P-002']);
    // And the blocked list reaches through as many levels as there are: E-001 is under P-001, which is done,
    // so a one-level walk would call this feature clean.
    expect(evidence?.blocked).toEqual(['E-001']);
  });

  it('names each child’s column and how its last run ended', async () => {
    const r = recorder({ boardCards: board() });
    // A run on P-001, which is the fact `GET /api/runs` would otherwise have been asked for.
    r.client.runs = async () => ({
      ok: true as const,
      value: {
        runs: [record({ card: 'P-001', board: 'product', skill: 'break-down', status: 'attention' })],
      },
    });
    await performAction(deps(r.client, { verify: verify(smokePass) }), FEATURE_CHECKUP, context);
    const children = r.requests[0]?.checkup?.children ?? [];
    expect(children.find((c) => c.id === 'P-001')).toMatchObject({ column: 'done', outcome: 'attention' });
    // Absent rather than invented for a child nothing has run on yet.
    expect(children.find((c) => c.id === 'P-002')?.outcome).toBeUndefined();
  });

  // A REVIEW'S STATUS IS NOT THE CHILD'S OUTCOME, and with one run per child no fixture could tell the two
  // apart — the question only exists once there are two runs. A review that ran perfectly and sent the work
  // back is `status: success` with `verdict: sent-back`, so reading the latest run of any kind described a
  // task the reviewer had rejected as having succeeded.
  it('names the child’s own work, not the review that judged it', async () => {
    const task = { ...CARD('E-001', 'engineering'), columnSlug: 'in-progress' };
    const story = { ...CARD('P-001', 'product'), columnSlug: 'in-progress', links: ['E-001'] };
    const r = recorder({ boardCards: [story, task] });
    r.client.runs = async () => ({
      ok: true as const,
      value: {
        runs: [
          // The work, which ended saying it could not finish.
          record({ card: 'E-001', skill: 'implement', status: 'attention', started: '2026-08-06T10:00:00Z' }),
          // And the review AFTER it, whose own turn went perfectly while it sent the work back.
          record({
            card: 'P-001',
            board: 'product',
            skill: 'review-story',
            status: 'success',
            verdict: 'sent-back',
            started: '2026-08-06T10:30:00Z',
          }),
        ],
      },
    });
    await performAction(
      deps(r.client, { verify: verify(smokePass) }),
      { kind: 'dispatch', phase: 'story-review', skill: 'review-story', card: story, previous: 'W-1' },
      context,
    );
    expect(r.requests[0]?.checkup?.children).toEqual([
      { id: 'E-001', column: 'in-progress', outcome: 'attention', blocked: false },
    ]);
  });

  it('marks a blocked child as blocked, so the prompt need not know which slug means it', async () => {
    const r = recorder({ boardCards: board() });
    await performAction(deps(r.client, { verify: verify(smokePass) }), STORY_REVIEW, context);
    expect(r.requests[0]?.checkup?.children).toEqual([{ id: 'E-001', column: 'blocked', blocked: true }]);
  });

  it('fetches the suggestions with its OWN service credential, not the checkup’s', async () => {
    // `GET /api/suggestions` is open to `service` (auth.ts), which the loop holds and a `work` run does not.
    const r = recorder({
      boardCards: board(),
      suggestions: [{ id: 'S-1', title: 'the config loader has no tests' }],
    });
    await performAction(deps(r.client, { verify: verify(smokePass) }), FEATURE_CHECKUP, context);
    expect(r.calls).toContain('suggestions');
    expect(r.requests[0]?.checkup?.suggestions).toEqual([
      { id: 'S-1', title: 'the config loader has no tests' },
    ]);
  });

  it('dispatches with an empty suggestion list rather than none when that read failed', async () => {
    // A failed read must not become "there is nothing outstanding": that is how a checkup concludes a project
    // is clean. It is dispatched anyway, because the checkup's own subject is the cards.
    const r = recorder({ boardCards: board() });
    r.client.suggestions = (async () => ({
      ok: false as const,
      reason: 'refused with 500',
      fatal: false,
    })) as unknown as typeof r.client.suggestions;
    await performAction(deps(r.client, { verify: verify(smokePass) }), FEATURE_CHECKUP, context);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0]?.checkup?.suggestions).toEqual([]);
  });

  // THE GATE-DOCUMENT REFUSAL IN FRONT OF THE SMOKE COMMAND TOO (decision 51). `foundation/TESTING.md` carries
  // `smoke:` and is in the same EXECUTED set as `foundation/CODE-QUALITY.md`; both run through `/bin/sh`
  // unsandboxed as the server's user. Guarded only on the gates, the hole stayed open one document over.
  it('runs no smoke command and dispatches nothing while a gate document is unread', async () => {
    let ran = 0;
    const r = recorder({ boardCards: board() });
    const result = await performAction(
      deps(r.client, {
        state: async () => ({ unreviewedGates: ['TESTING.md'] }),
        verify: {
          gates,
          smoke: async () => {
            ran += 1;
            return await smokePass();
          },
        } as unknown as ActDeps['verify'],
      }),
      FEATURE_CHECKUP,
      context,
    );
    expect(ran).toBe(0);
    expect(r.dispatched).toEqual([]);
    expect(r.moves).toEqual([]);
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('will not run a gate command');
    expect(result.stop?.detail).toContain('foundation/TESTING.md');
  });

  // AND IN FRONT OF THE STORY'S JUDGEMENT, which is a CHANGE decision 80 brings rather than a rule restated.
  // The story checkup this absorbed spawned nothing, so refusing it would have cost the project for a risk
  // that was not there; the judgement runs the gate commands itself, in this process, so the refusal that
  // stands in front of every spawn stands in front of this one too.
  it('runs no gate command for a story judgement while a gate document is unread', async () => {
    let ran = 0;
    const r = recorder({ boardCards: board() });
    const result = await performAction(
      deps(r.client, {
        state: async () => ({ unreviewedGates: ['TESTING.md'] }),
        verify: {
          gates: async () => {
            ran += 1;
            return await gates();
          },
          smoke: smokePass,
        } as unknown as ActDeps['verify'],
      }),
      STORY_REVIEW,
      context,
    );
    expect(ran).toBe(0);
    expect(r.dispatched).toEqual([]);
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('will not run a gate command');
  });

  it('sends no checkup evidence with any other phase', async () => {
    const r = recorder({ boardBefore: [], boardCards: [CARD('P-001', 'product')] });
    await performAction(deps(r.client), BREAKDOWN(), context);
    expect(r.requests[0]?.checkup).toBeUndefined();
  });
});
