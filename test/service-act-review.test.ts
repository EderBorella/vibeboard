import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../src/core/runs.js';
import type { Verification } from '../src/core/verify.js';
import { type ActDeps, performAction, reviewStory } from '../src/service/act.js';
import { CARD, context, deps, REVIEW, record, recorder, STORY } from './service-act-fixtures.js';

// THE STORY'S JUDGEMENT: deterministic first (decision 51), at the story since decision 80. The loop runs
// the gates in its OWN process, once per story, and a model is dispatched only for what a command's exit
// code cannot express — does this do what the card asked, and do the tasks under it compose.
//
// A gate is a command with an exit code, which is the most deterministic thing in this design; handing it to
// an agent would make a settled fact a judgement. Running it here also removes the coin-flip measured over
// 219 dispatches, where 41 of 77 reviews re-ran the gates unprompted and 36 did not.
describe('the story judgement', () => {
  const gatesPass = async (): Promise<Verification> => ({ mode: 'gates', passed: true, at: 'T' });
  const gatesFail = async (): Promise<Verification> => ({
    mode: 'gates',
    passed: false,
    at: 'T',
    command: 'npm test',
    output: 'Tests  1 failed | 40 passed',
    reason: '`npm test` exited with 1.',
  });
  // NO COMMAND, because none was run: an absent, empty or unparseable gate set (core/verify.ts). That is the
  // shape the setup exception recognises, and the only shape it recognises.
  const noGates = async (): Promise<Verification> => ({
    mode: 'gates',
    passed: false,
    at: 'T',
    reason: 'foundation/CODE-QUALITY.md declares no gates.',
  });

  const smoke = async (): Promise<Verification> => ({ mode: 'smoke', passed: true, at: 'T' });

  // Records whether a gate command was even attempted. `ran` empty is a different claim from "the gates
  // failed", and it is the claim the security refusal makes.
  const watching = (gates: () => Promise<Verification>, ran: string[]) => ({
    gates: async (...args: unknown[]) => {
      ran.push('gates');
      void args;
      return await gates();
    },
    smoke,
  });

  const reviewRun = (over: Partial<RunRecord> = {}): RunRecord =>
    record({
      run: 'REV-1',
      card: 'P-001',
      board: 'product',
      skill: 'review-story',
      status: 'success',
      outcome: 'success',
      ...over,
    });

  // THE SECURITY GATE, first because it is the one that must never regress. Running the gates BEFORE a
  // dispatch takes `POST /api/runs`'s refusal out from in front of them, and that refusal was the only thing
  // between an agent-rewritten gate document and its commands running unsandboxed as the server's user.
  it('runs NO gate command while a gate document is unreviewed, and stops saying so', async () => {
    const ran: string[] = [];
    const r = recorder();
    const result = await reviewStory(
      deps(r.client, {
        state: async () => ({ unreviewedGates: ['CODE-QUALITY.md'] }),
        verify: watching(gatesPass, ran) as unknown as ActDeps['verify'],
      }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    // NOT "it failed" — it never ran.
    expect(ran).toEqual([]);
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('I have read the gate commands');
    expect(r.requests).toHaveLength(0);
    expect(r.moves).toEqual([]);
    expect(r.verdicts).toEqual([]);
  });

  it('runs the gates when nothing is unreviewed', async () => {
    const ran: string[] = [];
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    const result = await reviewStory(
      deps(r.client, { verify: watching(gatesPass, ran) as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    expect(ran).toEqual(['gates']);
    expect(result.stop).toBeUndefined();
  });

  it('sends a story back with the command’s own output when a gate fails, dispatching nothing', async () => {
    const r = recorder();
    const result = await reviewStory(
      deps(r.client, { verify: { gates: gatesFail, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    // No model, no tokens, no iteration.
    expect(r.requests).toHaveLength(0);
    expect(result.dispatches).toBe(0);
    expect(r.verdicts[0]).toMatchObject({ run: 'WORK-1', mode: 'gates', passed: false, command: 'npm test' });
    expect(r.verdicts[0]?.output).toContain('1 failed');
    // AND NO MOVE: `in-progress` is where a story stands while it is judged, so a send-back's destination is
    // where it already is. A stamp here would be a write for nothing and a diary line about a non-event.
    expect(r.moves).toEqual([]);
    // And the diary carries the command, so a person reads why without opening a run record.
    expect(r.diary.find((d) => d.kind === 'run')?.text).toContain('npm test');
  });

  it('dispatches a review run only when the gates pass', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    await reviewStory(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    // NO `previous` ON THE DISPATCH: that field renders the "you are judging ONE run" contract, which is the
    // frame decision 80 removes. The run the verdict is WRITTEN onto is a separate question.
    expect(r.requests[0]).toMatchObject({ skill: 'review-story', card: 'P-001' });
    expect(r.requests[0]?.previous).toBeUndefined();
  });

  // FAIL CLOSED (decision 3). Seven of the design review's findings were this one bug, and every one ended
  // with auto-pilot reporting success over work that never happened.
  it('fails a story whose project declares no gates', async () => {
    const r = recorder();
    await reviewStory(
      deps(r.client, { verify: { gates: noGates, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    expect(r.verdicts[0]).toMatchObject({ mode: 'gates', passed: false });
    expect(r.requests).toHaveLength(0);
  });

  // THE ONE NARROW EXCEPTION, narrow in two ways at once: only in the setup subtree, and only for a gate set
  // that is ABSENT. Installing the test runner is what that card is for.
  it('judges a setup-subtree card whose gate set is absent, by reading', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    await reviewStory(
      deps(r.client, { verify: { gates: noGates, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      { setupSubtree: true },
      context,
    );
    expect(r.requests[0]).toMatchObject({ skill: 'review-story' });
    expect(r.verdicts[0]).toMatchObject({ mode: 'review' });
  });

  it('still sends a setup-subtree card back when a gate EXISTS and fails', async () => {
    // Absent is expected; failing is not. A runner that is installed and red is a different fact.
    const r = recorder();
    await reviewStory(
      deps(r.client, { verify: { gates: gatesFail, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      { setupSubtree: true },
      context,
    );
    expect(r.requests).toHaveLength(0);
    expect(r.verdicts[0]).toMatchObject({ mode: 'gates', passed: false });
  });

  it('passes the gate result and the setup subtree through to the prompt', async () => {
    // Task 11's field, and this is its producer. Read off the dispatch the client received, because that is
    // the only carrier there is.
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    await reviewStory(
      deps(r.client, { verify: { gates: noGates, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      { setupSubtree: true },
      context,
    );
    expect(r.requests[0]?.review).toEqual({ gatesPassed: true, setupSubtree: true });
  });

  it('writes the review verdict onto the run it judged rather than onto the review run', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'done', summary: 'does what the card asked' })] });
    await reviewStory(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]).toMatchObject({ run: 'WORK-1', mode: 'review', passed: true, by: 'REV-1' });
    // The findings travel with the verdict: a `fix` run is handed this, not told to go and look.
    expect(r.verdicts[0]?.reason).toContain('does what the card asked');
    expect(r.moves).toEqual([{ card: 'P-001', to: 'done' }]);
  });

  // THE SAME ACTION WITH NOTHING TO WRITE ONTO. A story that skipped its break-down because it arrived
  // carrying tasks (decision 50) has no work run of its own, so the tick names none.
  const noWorkRun = (): ReturnType<typeof REVIEW> => ({
    kind: 'dispatch',
    phase: 'story-review',
    skill: 'review-story',
    card: STORY(),
  });

  // AND THEN THE REVIEW'S OWN RECORD IS WHERE IT GOES (decision 81). Writing it nowhere is what made the
  // send-back invisible: the next tick saw no verdict, judged again, and the story never reached `story-fix`
  // — four paid reviews and then a stop that blamed this server for a write it had never been asked to make.
  it('writes the verdict onto the review run itself when the story has no work run', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'sent-back', summary: 'the flag is not parsed' })] });
    await reviewStory(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      noWorkRun(),
      STORY(),
      {},
      context,
    );
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]).toMatchObject({ run: 'REV-1', mode: 'review', passed: false, by: 'REV-1' });
    expect(r.verdicts[0]?.reason).toContain('the flag is not parsed');
    // Still no move: `in-progress` is where a story stands while it is judged.
    expect(r.moves).toEqual([]);
  });

  it('closes a story with no work run on a verdict recorded the same way', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'done', summary: 'does what the card asked' })] });
    await reviewStory(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      noWorkRun(),
      STORY(),
      {},
      context,
    );
    expect(r.verdicts[0]).toMatchObject({ run: 'REV-1', passed: true });
    expect(r.moves).toEqual([{ card: 'P-001', to: 'done' }]);
  });

  it('sends a story back on a sent-back verdict', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'sent-back', summary: 'the flag is not parsed' })] });
    await reviewStory(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    expect(r.verdicts[0]).toMatchObject({ mode: 'review', passed: false, by: 'REV-1' });
    // The verdict IS the send-back: the story is already standing where a refusal leaves it, and the next
    // tick reads the failed verdict off its latest work run and dispatches the fix.
    expect(r.moves).toEqual([]);
  });

  // RULE 2 (act.ts): `outcome` is what the agent said about its own turn. A review whose turn went perfectly
  // and which decided nothing has not passed anything.
  it('advances a story only on the verdict, never on the review run’s own outcome', async () => {
    const r = recorder({ settle: [reviewRun({ outcome: 'success', verdict: undefined })] });
    const result = await reviewStory(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    expect(r.verdicts).toEqual([]);
    expect(r.moves).toEqual([]);
    // The dispatch still counts, and the tick's own bound over inconclusive reviews is what gives up.
    expect(result.dispatches).toBe(1);
  });

  it('counts the review dispatch against the caps', async () => {
    // Decision 8: everything a model does counts. A boolean here let every judged card cost one iteration
    // instead of two.
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    const result = await reviewStory(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    expect(result.dispatches).toBe(1);
  });

  it('leaves the story open and burns no move when the review run does not settle', async () => {
    const r = recorder({ settle: [reviewRun({ status: 'running' })] });
    const result = await reviewStory(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      STORY(),
      {},
      context,
    );
    expect(result.stop?.reason).toBe('stalled');
    expect(r.moves).toEqual([]);
    expect(r.verdicts).toEqual([]);
  });

  // THE WIRING, through the executor rather than the function: a `story-review` dispatch must not go down
  // the ordinary path, which would spend a model before anything deterministic had run.
  it('carries a story-review action out through the gates, not through an ordinary dispatch', async () => {
    const ran: string[] = [];
    const r = recorder();
    const result = await performAction(
      deps(r.client, { verify: watching(gatesFail, ran) as unknown as ActDeps['verify'] }),
      REVIEW(),
      context,
    );
    expect(ran).toEqual(['gates']);
    expect(r.requests).toHaveLength(0);
    expect(result.dispatches).toBe(0);
  });

  // WHO DECIDES the setup subtree: the loop, off the board it can already read. A `work` credential could not
  // be asked for it, and being told by the card would make the exception something a card could claim.
  it('reads the setup subtree off the board rather than being told', async () => {
    const feature = { ...CARD('F-001', 'features'), setup: true, links: ['P-001'] };
    const r = recorder({
      settle: [reviewRun({ verdict: 'done' })],
      boardCards: [feature, { ...STORY(), links: ['E-001'] }, CARD()],
    });
    await performAction(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      context,
    );
    expect(r.requests[0]?.review).toEqual({ gatesPassed: true, setupSubtree: true });
  });

  it('treats a board it could not read as outside the setup subtree, which fails closed', async () => {
    // Being wrong the other way excuses an absent gate set for a card nobody chose.
    const r = recorder({
      settle: [reviewRun({ verdict: 'done' })],
      board: { ok: false, reason: 'could not reach the board', fatal: false },
    });
    await performAction(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      context,
    );
    expect(r.requests[0]?.review).toEqual({ gatesPassed: true, setupSubtree: false });
  });
});
