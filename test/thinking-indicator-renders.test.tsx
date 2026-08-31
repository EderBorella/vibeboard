// @vitest-environment jsdom
//
// DOES THE INDICATOR ACTUALLY APPEAR? Nothing asserted that until the owner sent a message and saw
// nothing happen. `test/thinking-indicator.test.ts` covers the two timers as pure functions, which is
// the logic — but "the panel renders it while a turn is running" is a WIRING claim, and a pure
// function test cannot reach it. This is the gap that let a broken feature look finished.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  getModelStatus: vi.fn(),
}));
vi.mock('../web/src/lib/api.js', () => api);
vi.mock('../web/src/lib/api', () => api);

const { CopilotPanel } = await import('../web/src/organisms/copilot/CopilotPanel.js');

afterEach(cleanup);
beforeEach(() => {
  // jsdom implements no scrolling. The panel scrolls its transcript to the bottom on every change,
  // and without this the effect throws before a single assertion runs — an environment gap, not a
  // defect in the component.
  Element.prototype.scrollTo = vi.fn();
  api.listModels.mockResolvedValue([]);
  api.getModelStatus.mockResolvedValue(null);
});

// The hook's shape, with only what the panel reads. `sentAt`/`lastEventAt`/`sawText` are refs in the
// real hook — plain objects with a `current` are the same contract and let a test place the clock.
function copilotStub(over: Record<string, unknown> = {}) {
  return {
    items: [{ id: 1, kind: 'user' as const, text: 'check the animation' }],
    running: true,
    stats: { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 },
    chats: [],
    currentChatId: null,
    send: vi.fn(),
    compact: vi.fn(),
    newSession: vi.fn(),
    openChat: vi.fn(),
    deleteChat: vi.fn(),
    cancel: vi.fn(),
    authorised: false,
    setCopilotAuthority: vi.fn(),
    sessionId: undefined,
    model: undefined,
    sentAt: { current: Date.now() },
    lastEventAt: { current: Date.now() },
    sawText: { current: false },
    ...over,
  };
}

function panel(over: Record<string, unknown> = {}) {
  const copilot = copilotStub(over) as never;
  return render(
    <CopilotPanel
      copilot={copilot}
      backend="opencode"
      mode={'build' as never}
      model="some/model"
      effort={'high' as never}
      contextBudget={200_000}
      overridden={false}
      onMode={vi.fn()}
      onModel={vi.fn()}
      onEffort={vi.fn()}
      onBackend={vi.fn()}
      onReset={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('the thinking indicator in the panel', () => {
  it('appears while a turn is running and no answer has begun', () => {
    panel();
    expect(screen.getByTestId('thinking')).toBeTruthy();
    expect(screen.getByText('Thinking')).toBeTruthy();
  });

  // The negatives, and they are what stop the assertion above passing on a component that renders
  // unconditionally — which would be indistinguishable from a working one in the test above alone.
  it('does not appear when no turn is running', () => {
    panel({ running: false });
    expect(screen.queryByTestId('thinking')).toBeNull();
  });

  it('yields to the bubble once the answer has begun', () => {
    panel({ sawText: { current: true } });
    expect(screen.queryByTestId('thinking')).toBeNull();
  });

  // THE STATE THE OWNER WOULD HAVE SEEN at 62 seconds. Placed by moving the clock back rather than by
  // waiting: the thresholds are read from `Date.now()` on every render, so a `sentAt` in the past is
  // the same input a real slow turn produces, with no timer to flush.
  it('says the model is slow once the send clock passes the threshold', () => {
    panel({ sentAt: { current: Date.now() - 40_000 }, lastEventAt: { current: Date.now() - 1_000 } });
    expect(screen.getByText('The model is taking longer than usual')).toBeTruthy();
  });

  it('offers Stop once nothing has arrived for the stall threshold', () => {
    const at = Date.now() - 120_000;
    panel({ sentAt: { current: at }, lastEventAt: { current: at } });
    expect(screen.getByText(/^No response for/)).toBeTruthy();
    // SCOPED TO THE INDICATOR. The composer carries its own Stop for the whole turn, so an unscoped
    // query matches two buttons and passes on the wrong one — which is how a test claims to prove a
    // stall control that was never rendered.
    const { getByRole } = within(screen.getByTestId('thinking'));
    expect(getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
});
