import { describe, expect, it } from 'vitest';
import { HARNESS_FEATURE } from '../src/core/harness-feature.js';
import type { Card } from '../src/core/types.js';
import { performAction } from '../src/service/act.js';
import { BOOTSTRAP, BREAKDOWN, CARD, context, deps, projectRun, recorder } from './service-act-fixtures.js';

// THE BOOTSTRAP AND ITS TAIL: the one dispatch about the project rather than about a card, and the two board
// writes that close it — the scaffolding flag and the smoke-harness feature.

// THE BOOTSTRAP: the one dispatch about the PROJECT rather than about a card, and therefore the one with no
// stamps and no verdict.
describe('deriving an empty board', () => {
  it('dispatches with no card at all, and says so rather than naming one', async () => {
    // The whole point: `card` and `board` absent, `project` true. A request that named a card would be the
    // trigger-card workaround this replaces, and the run record would land beside a card that does not exist.
    const r = recorder({ settle: [projectRun()] });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.dispatches).toBe(1);
    expect(r.requests).toEqual([{ project: true, skill: 'derive-features' }]);
  });

  it('carries a project run out with no stamps at all', async () => {
    const r = recorder({ settle: [projectRun()] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.moves).toEqual([]);
    expect(r.verdicts).toEqual([]);
  });

  it('commits before it dispatches, exactly as a card dispatch does', async () => {
    // Rule 1 is not about cards: from the moment the agent starts writing, a commit first is what makes any of
    // it one command from gone.
    const order: string[] = [];
    const r = recorder({ settle: [projectRun()] });
    const original = r.client.dispatch;
    r.client.dispatch = async (input) => {
      order.push('dispatch');
      return original(input);
    };
    await performAction(
      deps(r.client, {
        commit: async () => {
          order.push('commit');
          return { committed: true };
        },
      }),
      BOOTSTRAP,
      context,
    );
    expect(order).toEqual(['commit', 'dispatch']);
  });

  it('stops the loop when that commit fails', async () => {
    const r = recorder({ settle: [projectRun()] });
    const result = await performAction(
      deps(r.client, { commit: async () => ({ committed: false, reason: 'the tree is dirty' }) }),
      BOOTSTRAP,
      context,
    );
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('the tree is dirty');
    expect(r.requests).toEqual([]);
  });

  it('watches the PROJECT list for its ending, not a card route', async () => {
    // A project run has no card in its path, so `GET /runs/:board/:card` cannot find it. Asserted through the
    // calls rather than by mocking one away: pointed at the card route the run never settles and the loop
    // reports a timeout, which reads as a broken agent rather than as looking in the wrong place.
    const r = recorder({ settle: [projectRun()] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.calls).toContain('runs');
    expect(r.calls).not.toContain('cardRuns');
  });

  it('reports what the board holds afterwards, which is the only evidence there is', async () => {
    // NOT the run's own outcome (decision 40), and not files changed: cards are created through the API, so a
    // bootstrap that worked perfectly changes nothing on disk.
    const r = recorder({
      settle: [projectRun({ summary: 'Derived four features' })],
      boardCards: [CARD('F-001', 'features'), CARD('F-002', 'features')],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    const line = r.diary.find((d) => d.kind === 'run')?.text ?? '';
    expect(line).toContain('the board now has 2 cards');
    expect(line).toContain('Derived four features');
  });

  it('says the board is still empty when nothing was created, and does not stop the loop', async () => {
    // The attempt is burned by the record itself and `decideTick` counts it — one cap, in one place. A stop
    // here would be a second opinion about when to give up.
    const r = recorder({ settle: [projectRun({ status: 'attention' })] });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.diary.find((d) => d.kind === 'run')?.text).toContain('the board is still empty');
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
  });

  it('does not claim the board is empty when it could not be read', async () => {
    // "Created no cards" is a verdict; a failed read is not evidence for it.
    const r = recorder({
      settle: [projectRun()],
      board: { ok: false, reason: 'could not reach the board', fatal: false },
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    const line = r.diary.find((d) => d.kind === 'run')?.text ?? '';
    expect(line).toContain('unknown');
    expect(line).not.toContain('still empty');
  });

  it('stops when the derivation never finishes', async () => {
    const r = recorder({ settle: [projectRun({ status: 'running' })] });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('did not finish');
  });

  it('reports a refused dispatch rather than pretending it ran', async () => {
    const r = recorder({ dispatch: { ok: false, reason: 'refused with 403', fatal: false } });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.dispatches).toBe(0);
    expect(r.diary.some((d) => d.kind === 'note' && d.text.includes('403'))).toBe(true);
  });
});

// THE BOOTSTRAP'S EXIT (decision 44, corrected). `setup: true` fires here and at NO other time.
//
// The first draft made it a board predicate — "cards exist and none is flagged" — which would stamp it on any
// project whose first feature a person added by hand. That was harmless while the flag only ordered work; under
// decision 51 it is what makes an ABSENT GATE SET EXPECTED instead of a failure, so auto-stamping would switch
// off a fail-closed check for a subtree nobody chose.
describe('the scaffolding stamp', () => {
  const feature = (id: string, columnSlug = 'backlog', order = 10): Card => ({
    ...CARD(id, 'features'),
    columnSlug,
    order,
  });

  it('stamps setup on the first backlog feature after a bootstrap run', async () => {
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-001'), feature('F-002', 'backlog', 20)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags).toEqual([{ board: 'features', card: 'F-001', body: { setup: true } }]);
    // And it says which card it chose, because a flag nobody recorded is a rule nobody can check afterwards.
    expect(r.diary.some((d) => d.kind === 'lifecycle' && d.text.includes('F-001'))).toBe(true);
  });

  it('picks the first feature by the endpoint-assigned order, not by the run’s created list', async () => {
    // FINDING F: the run reports `created: ['F-005']`, the board says F-001 is first. `RunRecord.created` is
    // frontmatter the agent wrote about itself; `order` is what the endpoint assigned.
    const r = recorder({
      settle: [projectRun({ created: ['F-005', 'F-001'] })],
      boardBefore: [],
      boardCards: [feature('F-005', 'backlog', 50), feature('F-001', 'backlog', 10)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags[0]?.card).toBe('F-001');
  });

  it('breaks an equal order by id, so the choice is at least deterministic', async () => {
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-005', 'backlog', 10), feature('F-002', 'backlog', 10)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags[0]?.card).toBe('F-002');
  });

  it('ignores a feature that is not in backlog', async () => {
    // The derivation puts every feature in `features/backlog`; anything elsewhere was moved by a person, and
    // the scaffolding is the first of what this run produced.
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-000', 'in-progress', 5), feature('F-001', 'backlog', 10)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags[0]?.card).toBe('F-001');
  });

  it('stamps nothing when the bootstrap created no card', async () => {
    const r = recorder({ settle: [projectRun()], boardBefore: [], boardCards: [] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags).toEqual([]);
  });

  it('stamps nothing when a card already carries setup', async () => {
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [{ ...feature('F-001'), setup: true }, feature('F-002', 'backlog', 20)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags).toEqual([]);
  });

  it('stamps nothing when the only flagged feature has been ARCHIVED', async () => {
    // "Once" is a board fact (decision 50), and an archived card is still a fact about this board. The live
    // board alone cannot answer it, which is why the archive is read.
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-009')],
      archive: [{ ...feature('F-001', 'archive'), setup: true, archived: '2026-08-13T00:00:00Z' }],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags).toEqual([]);
  });

  it('never stamps outside a bootstrap exit', async () => {
    // THE CORRECTION. A break-down exit on a board of unflagged features must not acquire the flag.
    const r = recorder({ boardBefore: [], boardCards: [feature('F-001'), CARD('P-001', 'product')] });
    await performAction(deps(r.client), BREAKDOWN(), context);
    expect(r.flags).toEqual([]);
  });

  it('stamps the flag BEFORE it creates the harness feature, so the harness cannot be flagged', async () => {
    // The order is the rule: `stampSetup` takes the first feature in `features/backlog`, and the harness is
    // created after the derivation so that it sorts LAST. Created first it would be a candidate for a flag
    // that means the opposite — the scaffolding is built first, the harness last.
    const r = recorder({ settle: [projectRun()], boardBefore: [], boardCards: [feature('F-001')] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    const flagged = r.calls.indexOf('flags:F-001');
    const made = r.calls.indexOf('create:features/backlog');
    expect(flagged).toBeGreaterThan(-1);
    expect(made).toBeGreaterThan(flagged);
  });

  it('carries on when the flag could not be written, rather than stopping the loop', async () => {
    // The stamp is the exit of a run that has already happened. Losing it costs an ordering fact; stopping
    // costs the project.
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-001')],
      flags: { ok: false, reason: 'refused with 409', fatal: false },
    });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
  });
});

// RULING 66's FIRST HALF, and the point of it being HERE rather than in a prompt: the run that produced the
// ruling has direct evidence of `derive-features` not following its instructions reliably, so a mandatory
// feature that depends on an agent remembering is one that will sometimes be missing.
describe('the smoke-harness feature', () => {
  const feature = (id: string, columnSlug = 'backlog', order = 10): Card => ({
    ...CARD(id, 'features'),
    columnSlug,
    order,
  });

  it('creates one features card at the bootstrap’s exit, and says what it is in the diary', async () => {
    const r = recorder({ settle: [projectRun()], boardBefore: [], boardCards: [feature('F-001')] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.created).toEqual([
      { board: 'features', columnSlug: 'backlog', title: HARNESS_FEATURE.title, body: HARNESS_FEATURE.body },
    ]);
    // NAMED, and by the id the endpoint assigned rather than one the loop chose. A card nobody recorded is a
    // rule nobody can check afterwards, which is the argument the scaffolding flag's line already makes.
    expect(
      r.diary.some((d) => d.kind === 'lifecycle' && d.text.includes('F-099') && d.text.includes('smoke')),
    ).toBe(true);
  });

  it('asks for no technology, because that is the break-down’s decision from the README', async () => {
    // The requirement is generic; the HOW is not. A driver, an extractor or a spawned process are answers to
    // "used the way the README describes", and choosing one here chooses it before anyone has read the project.
    const body = HARNESS_FEATURE.body.toLowerCase();
    for (const named of [
      'playwright',
      'pdftotext',
      'curl',
      'npm ',
      'node ',
      'python',
      'docker',
      'selenium',
    ]) {
      expect(body, named).not.toContain(named);
    }
    // What it DOES say: the file the command is declared in, and that it is not one of the gates.
    expect(HARNESS_FEATURE.body).toContain('foundation/TESTING.md');
    expect(HARNESS_FEATURE.body).toContain('must not be one of the gate commands');
  });

  it('creates nothing when the bootstrap created no card', async () => {
    // Nothing was derived, so there is no product for a harness to exercise and no derivation to attach it to.
    // Same condition as the flag above, and read from the BOARD rather than from the run's own report.
    const r = recorder({ settle: [projectRun()], boardBefore: [], boardCards: [] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.created).toEqual([]);
  });

  it('never creates one outside a bootstrap exit', async () => {
    const r = recorder({ boardBefore: [], boardCards: [feature('F-001'), CARD('P-001', 'product')] });
    await performAction(deps(r.client), BREAKDOWN(), context);
    expect(r.created).toEqual([]);
  });

  it('carries on when the create was refused, rather than stopping the loop', async () => {
    // The exit of a run that has already happened: stopping here would cost the project the whole derivation.
    // What a lost harness costs instead is bounded — `complete` refuses while the smoke command is still one of
    // the gates, so the project says why it will not report itself finished rather than quietly doing so.
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-001')],
      create: { ok: false, reason: 'refused with 409', fatal: false },
    });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
    // And no diary line claiming a card that was never made.
    expect(r.diary.some((d) => d.text.includes('smoke harness'))).toBe(false);
  });
});
