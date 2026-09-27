// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotConfig, Card } from '../web/src/lib/shared.js';

// THE REVIEW GATE'S SCREEN — decision 74. Auto-pilot derives every feature from the README in one shot and
// then builds everything else on top of that list, so the loop stops here and this is what a person meets.
//
// WHAT THESE ASSERT is the rule the component owns: WHEN it is offered. The bar renders it unconditionally
// and this decides its own visibility, the same arrangement `ForgiveDerivation` uses beside it — offered on
// the wrong stop, it would invite somebody to restart a project that stopped for a reason nobody has read.

const { ReviewFeatures } = await import('../web/src/organisms/autopilot/ReviewFeatures.js');

afterEach(cleanup);

// A WHOLE `Card`, with no cast. The first version asserted one through `as Card` and the compiler refused
// it for three missing fields — which is the check doing its job: a fixture thin enough to need a cast is a
// fixture that stops resembling what the component is handed.
const feature = (id: string, title = `Feature ${id}`): Card => ({
  id,
  title,
  board: 'features',
  columnSlug: 'backlog',
  order: 10,
  tags: [],
  links: [],
  created: '2026-09-18',
  body: '',
  filePath: `/tmp/p/.vibeboard/boards/features/backlog/${id}.md`,
});

// NO CAST HERE EITHER, for the reason written on the card fixture above — a cast is what would hide a
// missing required field from the check that comment is celebrating. Pointed out in review: the first
// version practised the rule on one fixture and broke it on the one directly beneath.
const config = (over: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  maxIterations: 100,
  budgetUsd: 10,
  runTimeoutMs: 1000,
  attemptCap: 3,
  mode: 'standard',
  idleMinutes: 10,
  blockedColumn: 'blocked',
  terminal: { features: ['done'], product: ['done'], engineering: ['done'] },
  ...over,
});

function show(over: Partial<Parameters<typeof ReviewFeatures>[0]> = {}) {
  const onConfirm = vi.fn(async () => {});
  const onFocus = vi.fn();
  render(
    <ReviewFeatures
      reason="review"
      config={config()}
      features={[feature('F-001'), feature('F-002')]}
      onFocus={onFocus}
      onConfirm={onConfirm}
      {...over}
    />,
  );
  return { onConfirm, onFocus };
}

describe('the review gate', () => {
  it('is offered only on a `review` stop', () => {
    // EVERY OTHER REASON, not just one. A control that appears beside "work remains and nothing can move it"
    // reads as the way out of it, and pressing it would start a loop into the same wall.
    for (const reason of [
      'stalled',
      'complete',
      'capped',
      'exhausted',
      'no-op',
      'infrastructure',
      undefined,
    ]) {
      cleanup();
      show({ reason });
      expect(screen.queryByTestId('ap-review')).toBeNull();
    }
    cleanup();
    show({ reason: 'review' });
    expect(screen.getByTestId('ap-review')).toBeTruthy();
  });

  // ONE COUNT PER SCREEN, and this replaces two tests that asserted the second one.
  //
  // The first version counted the `features` prop here — the BOARD, which includes the canned smoke-harness
  // card — while the stop sentence rendered directly above counts only what was DERIVED and names the
  // harness separately, on the argument recorded beside it. So the screen said "derived 2 features" and
  // "3 features are on the board" about one list. Caught in review. The component states no number at all
  // now, which is the only version that cannot drift from the sentence.
  it('states no count of its own, so it cannot contradict the sentence above it', () => {
    show({ features: [feature('F-001'), feature('F-002'), feature('F-003')] });
    expect(screen.getByTestId('ap-review').textContent).not.toMatch(/\d+\s+features/);
  });

  // The other half of the same review finding: the copy used to say "edit and delete cards first". Deleting
  // the first feature here strands the project forever — `setup: true` is stamped once and `hasSetupFeature`
  // guards it over the board and the archive, so no later derivation re-awards it.
  it('does not invite deleting cards', () => {
    show();
    expect(screen.getByTestId('ap-review').textContent).not.toContain('delete');
  });

  it('confirms without requiring a focus, because the whole board is an answer', async () => {
    // The button is not gated on the picker. Leaving it at "The whole board" is a decision, and a Confirm
    // that refused until somebody chose would turn an optional question into a required one.
    const { onConfirm, onFocus } = show();
    fireEvent.click(screen.getByTestId('ap-review-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('offers the focus picker in express, and not in standard', () => {
    // Not this component's rule — `FocusPicker` renders only in express and carries the reasoning — but the
    // pairing is what this screen is FOR (decision 73's choice can first be made here), so it is pinned at
    // the one place both are true at once.
    show({ config: config({ mode: 'express' }) });
    expect(screen.getByLabelText('The feature auto-pilot works on')).toBeTruthy();
    cleanup();
    show({ config: config({ mode: 'standard' }) });
    expect(screen.queryByLabelText('The feature auto-pilot works on')).toBeNull();
  });

  it('does not start twice while the first start is still going', async () => {
    // A double click on Confirm is one press as far as the person is concerned, and two `POST /start` calls
    // race the state file the second one reads.
    let release = (): void => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    render(
      <ReviewFeatures
        reason="review"
        config={config()}
        features={[feature('F-001')]}
        onFocus={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const button = screen.getByTestId('ap-review-confirm');
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    release();
  });
});
