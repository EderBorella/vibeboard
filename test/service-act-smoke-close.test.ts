import { describe, expect, it } from 'vitest';
import type { TickAction } from '../src/core/actions.js';
import type { Verification } from '../src/core/verify.js';
import { performAction } from '../src/service/act.js';
import { CARD, context, deps, recorder } from './service-act-fixtures.js';

// DECISION 69: A FEATURE CANNOT CLOSE WHILE ITS SMOKE COMMAND FAILED, and the machine is what refuses it.
//
// Ruling 55 made the smoke result evidence rather than a gate so a failure could not stall a project, and the
// consequence was a feature closing over a product that does not run. What changed is that the objection now
// has another answer: `creatingRoundStop` stops a feature whose created work nobody finished, and the
// `checkup-feature` attempt cap ends it otherwise, so the refusal here cannot loop for ever. Two bounds and
// not one since decision 86 — the creating round re-opens once the work it asked for is done, so a feature
// whose smoke keeps failing over work that keeps landing is stopped by the cap.
//
// The reason it is the MACHINE and not the prompt is measured. Asked what a failed smoke meant, models read the
// output and reasoned their way to "environmental" twice in one afternoon — once correctly, and once by quoting
// a document that was already out of date. A command that did not pass is a fact.

const feature = CARD('F-001', 'features');

const CHECKUP: TickAction = {
  kind: 'dispatch',
  phase: 'feature-checkup',
  card: feature,
  skill: 'checkup-feature',
};

// The two shapes `verifySmoke` really answers, and telling them apart is the whole of this file's care.
// `commandVerification` sets `command` for a command that ran and failed; `failedVerification` sets none,
// and is what a project with no declared smoke command gets.
const ranAndFailed: Verification = {
  mode: 'smoke',
  passed: false,
  at: 'T',
  command: 'npm run smoke',
  output: 'Expected: "56." Received: "3."',
  reason: 'the command exited 1',
};
const neverRan: Verification = {
  mode: 'smoke',
  passed: false,
  at: 'T',
  reason: 'foundation/TESTING.md declares no command.',
};
const passed: Verification = { mode: 'smoke', passed: true, at: 'T' };

// BOTH MEMBERS, because `verify` is one object and the type says so. Only `smoke` differs per test; `gates` is
// never reached on this path, and supplying a passing one keeps that true without making it the subject.
const verifying = (smoke: Verification) => ({
  verify: {
    smoke: async () => smoke,
    gates: async (): Promise<Verification> => ({ mode: 'gates', passed: true, at: 'T' }),
  },
});

// A feature checkup whose run completed and created nothing — the shape that closes the feature in the
// ordinary case, so any refusal below is the smoke result and nothing else.
const ordinary = () => recorder({ boardBefore: [feature], boardCards: [feature] });

describe('a feature checkup whose smoke command failed', () => {
  it('does not close the feature, whatever the run concluded', async () => {
    const r = ordinary();
    const result = await performAction(deps(r.client, verifying(ranAndFailed)), CHECKUP, context);
    expect(r.moves).toEqual([]);
    // The dispatch still counts: it happened, and a cap that is not told about a real agent run re-picks the
    // same card next tick.
    expect(result.dispatches).toBe(1);
  });

  it('says in the diary that the smoke command is why, not the checkup', async () => {
    const r = ordinary();
    await performAction(deps(r.client, verifying(ranAndFailed)), CHECKUP, context);
    const line = r.diary.map((d) => d.text).join('\n');
    expect(line).toMatch(/the smoke command did not pass/i);
    // The sentence a person acts on: it says the feature stayed open REGARDLESS of the run's own conclusion,
    // so nobody reads the report, sees `success`, and thinks the board is wrong.
    expect(line).toMatch(/stays open whatever the checkup concluded/i);
  });

  it('still closes the feature when the smoke command PASSED', async () => {
    const r = ordinary();
    await performAction(deps(r.client, verifying(passed)), CHECKUP, context);
    expect(r.moves).toEqual([{ card: 'F-001', to: 'done' }]);
  });

  // THE NARROWING, AND IT IS NOT A DETAIL. `verifySmoke` answers a failed verification for two unrelated
  // situations: a command ran and did not pass, and there is no command to run at all. Refusing on `passed`
  // alone would hold every feature in a project that has not declared a smoke command yet — a stall on a
  // project that has done nothing wrong, which is the exact outcome ruling 55 existed to prevent.
  it('closes the feature when no smoke command is declared at all', async () => {
    const r = ordinary();
    await performAction(deps(r.client, verifying(neverRan)), CHECKUP, context);
    expect(r.moves).toEqual([{ card: 'F-001', to: 'done' }]);
  });
});

// THE SCOPE OF THE REFUSAL, added after watching a real greenfield project stall three times on it.
//
// The smoke command proves the ASSEMBLED product runs. F-002 was "Temperature conversion", its own ten
// cards were done and its unit tests passed — and it could not close, because `npm run smoke` spawns
// `node src/index.js`, which F-004 owned and had not built yet. Three features stalled that way before
// any product code existed; the moment the CLI landed, four features closed with no person at all.
//
// So the refusal now asks a question it did not ask: is this the LAST feature? `bootstrap.ts` already
// states the rule — "there is nothing to smoke test before the product exists" — which is why the
// harness feature is created last by construction. The gate simply had not inherited it.
describe('the smoke refusal applies only to the last open feature', () => {
  const other = (id: string, columnSlug: string) =>
    ({ ...CARD(id, 'features'), id, columnSlug }) as typeof feature;

  it('does not refuse the close while another feature is still to come', async () => {
    const r = recorder({
      boardBefore: [feature, other('F-004', 'backlog')],
      boardCards: [feature, other('F-004', 'backlog')],
    });
    await performAction(deps(r.client, verifying(ranAndFailed)), CHECKUP, context);
    // F-002's own work is done; the command it cannot pass belongs to F-004.
    expect(r.moves).toEqual([{ card: 'F-001', to: 'done' }]);
  });

  it('still refuses when every other feature is done', async () => {
    const r = recorder({
      boardBefore: [feature, other('F-004', 'done')],
      boardCards: [feature, other('F-004', 'done')],
    });
    await performAction(deps(r.client, verifying(ranAndFailed)), CHECKUP, context);
    expect(r.moves).toEqual([]);
  });
});
